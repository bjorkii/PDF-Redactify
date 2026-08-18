import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/appStore";
import {
  bboxEquals,
  computeMovedBbox,
  computeResizedBbox,
  isDragRectSignificant,
  type DragPoint,
  type ResizeHandle,
  type ResizeHandle8,
} from "../utils/dragRect";
import { computeGroupMovedBboxes, computeGroupResizedBboxes, groupBoundingBox } from "../utils/marqueeSelect";
import { toggleId } from "../utils/reviewItemSelection";
import type { ReviewItem } from "../types/generated/ReviewItem";
import type { BoxColorPair } from "../types/generated/BoxColorPair";
import { hexToRgba } from "../utils/color";
import { EMPTY_MARGINS, marginsToDragBounds, bboxTouchesExclusion } from "../utils/exclusionZone";
import { extractTextInBbox } from "../services/pdfService";
import "./RedactionOverlay.css";

interface RedactionOverlayProps {
  pageIndex: number;
}

const RESIZE_HANDLES: ResizeHandle[] = ["nw", "ne", "sw", "se"];
// EDIT-15(B-1): 그룹 프레임 8방향 핸들(4모서리 + 4변).
const GROUP_RESIZE_HANDLES: ResizeHandle8[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// EDIT-13: 그룹 이동 시, 이 정도(페이지 상대좌표) 미만으로만 움직였으면
// "제자리 클릭"으로 보고 그룹을 이동하지 않는다 — 클릭엔 대개 1~2px의 미세
// 이동이 섞여, 이 여유가 없으면 단일 선택으로 접으려던 클릭이 그룹을 살짝
// 옮겨버린다(사용자 재현: "전체선택 후 눌러도 선택이 안 바뀜").
const GROUP_CLICK_THRESHOLD = 0.005;

type EditDrag =
  | { kind: "move"; item: ReviewItem; start: DragPoint }
  | { kind: "resize"; item: ReviewItem; handle: ResizeHandle }
  // EDIT-13: 다중선택 그룹을 통째로 이동. items는 드래그 시작 시점 스냅샷.
  // clickedId는 실제로 누른 항목 — 드래그 없이(제자리 클릭) 끝나면 그 항목
  // 하나만 선택으로 접기 위해 기억한다.
  | { kind: "groupMove"; items: ReviewItem[]; start: DragPoint; clickedId: string }
  // EDIT-15(B-1): 다중선택 그룹을 감싸는 프레임의 8방향 핸들로 함께 리사이즈.
  // items는 시작 시점 스냅샷(원본 bbox)이라 current만으로 비율 스케일이 정해진다.
  | { kind: "groupResize"; items: ReviewItem[]; handle: ResizeHandle8 };

/**
 * LIST-02/EDIT-02/EDIT-04/COLOR-02(§6.3.3, §6.5, §8.1, §7.3): 뷰어에 렌더된
 * 페이지 위에 그 페이지의 블랙마킹 후보 bbox를 표시한다. bbox는 페이지
 * 상대좌표(0~1)라 렌더된 이미지 크기와 무관하게 퍼센트로 위치를 잡을 수
 * 있다 — 부모(래퍼)가 이미지와 정확히 같은 크기여야 한다. 색상은 검출
 * 출처(자동검출/사용자 추가)×선택 여부에 따라 colorSettings에서 가져온다
 * (원문 색상 때문에 안 보일 수 있어 사용자가 배경·테두리를 모두 정할 수
 * 있게 함). 모서리 핸들로 리사이즈하거나 안쪽을 끌어 이동할 수 있다(원래
 * 좌표 original_bbox는 최초 1회만 보존, modified: true, undo 가능). 클릭하면
 * 목록 선택(selectedItemId)에도 반영되어 목록↔뷰어 양방향 연동이 된다.
 * F1로 전체를 표시/숨김한다.
 */
export function RedactionOverlay({ pageIndex }: RedactionOverlayProps) {
  const reviewItems = useAppStore((s) => s.reviewItems);
  const categoryFilter = useAppStore((s) => s.reviewListFilter.categories);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const selectedItemIds = useAppStore((s) => s.selectedItemIds);
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId);
  const setSelection = useAppStore((s) => s.setSelection);
  const bboxVisible = useAppStore((s) => s.bboxVisible);
  const recordHistoryChange = useAppStore((s) => s.recordHistoryChange);
  const colorSettings = useAppStore((s) => s.colorSettings);
  const clearPositionUncertain = useAppStore((s) => s.clearPositionUncertain);
  const exclusionZones = useAppStore((s) => s.exclusionZones);

  const overlayRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<EditDrag | null>(null);
  const [dragCurrent, setDragCurrent] = useState<DragPoint | null>(null);

  // DET-07: 이 페이지에 탐지 제외영역이 있으면, 기존 bbox를 이동·리사이즈
  // 할 때도 그 영역 안으로는 들어가지 못하게 한다(사용자 요청 — 새로
  // 그리기와 동일한 제약, PaginatedView.tsx 참고).
  const pageMargins = exclusionZones.find((z) => z.pageIndex === pageIndex)?.margins ?? EMPTY_MARGINS;
  const dragBounds = marginsToDragBounds(pageMargins);

  function toRelativePoint(clientX: number, clientY: number): DragPoint {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  }

  useEffect(() => {
    if (!drag) return;

    function handleMove(event: MouseEvent) {
      const current = toRelativePoint(event.clientX, event.clientY);
      setDragCurrent(current);
      // EDIT-14: 이동/리사이즈 중 bbox가 제외영역 경계에 닿으면 그 페이지 바를 표시.
      const activeDrag = drag!;
      let touching: boolean;
      if (activeDrag.kind === "groupMove") {
        touching = [...computeGroupMovedBboxes(activeDrag.items, activeDrag.start, current, dragBounds).values()].some(
          (b) => bboxTouchesExclusion(b, pageMargins),
        );
      } else if (activeDrag.kind === "groupResize") {
        touching = [...computeGroupResizedBboxes(activeDrag.items, activeDrag.handle, current, dragBounds).values()].some(
          (b) => bboxTouchesExclusion(b, pageMargins),
        );
      } else {
        touching = bboxTouchesExclusion(
          activeDrag.kind === "move"
            ? computeMovedBbox(activeDrag.item.bbox, activeDrag.start, current, dragBounds)
            : computeResizedBbox(activeDrag.item.bbox, activeDrag.handle, current, dragBounds),
          pageMargins,
        );
      }
      useAppStore.getState().setExclusionContactPage(touching ? pageIndex : null);
    }

    async function handleUp(event: MouseEvent) {
      const current = toRelativePoint(event.clientX, event.clientY);
      const activeDrag = drag!;
      setDrag(null);
      setDragCurrent(null);
      useAppStore.getState().setExclusionContactPage(null); // EDIT-14: 드래그 끝 → 접촉표시 해제

      // EDIT-13: 그룹 이동 — 같은 group_id로 묶어 각 항목의 bbox를 갱신한다
      // (undo 한 번에 전부 복원). 자동검출 content 재추출(EDIT-10)은 단건
      // 이동/리사이즈에만 적용하고 그룹 이동에는 넣지 않는다(대량 재추출 회피).
      if (activeDrag.kind === "groupMove") {
        const dist = Math.hypot(current.x - activeDrag.start.x, current.y - activeDrag.start.y);
        // 사실상 제자리 클릭 → 그룹선택을 접고 누른 항목 하나만 선택(이동 안 함).
        if (dist < GROUP_CLICK_THRESHOLD) {
          setSelectedItemId(activeDrag.clickedId);
          return;
        }
        const moved = computeGroupMovedBboxes(activeDrag.items, activeDrag.start, current, dragBounds);
        const now = new Date().toISOString();
        const groupId = `groupmove-${crypto.randomUUID()}`;
        for (const item of activeDrag.items) {
          const newBbox = moved.get(item.id);
          if (!newBbox || bboxEquals(newBbox, item.bbox)) continue;
          const after: ReviewItem = {
            ...item,
            bbox: newBbox,
            original_bbox: item.original_bbox ?? item.bbox,
            modified: true,
            updated_at: now,
          };
          recordHistoryChange("move", item.id, item, after, groupId);
          clearPositionUncertain(item.id);
        }
        return;
      }

      // EDIT-15(B-1): 그룹 8방향 리사이즈 — 각 멤버를 비율대로 스케일하고 같은
      // group_id로 묶는다(undo 한 번에 전부 복원). content 재추출(EDIT-10)은
      // 그룹 이동과 마찬가지로 넣지 않는다(대량 재추출 회피 — 저장은 bbox 기준).
      if (activeDrag.kind === "groupResize") {
        const resized = computeGroupResizedBboxes(activeDrag.items, activeDrag.handle, current, dragBounds);
        const now = new Date().toISOString();
        const groupId = `groupresize-${crypto.randomUUID()}`;
        for (const item of activeDrag.items) {
          const newBbox = resized.get(item.id);
          if (!newBbox || bboxEquals(newBbox, item.bbox) || !isDragRectSignificant(newBbox)) continue;
          const after: ReviewItem = {
            ...item,
            bbox: newBbox,
            original_bbox: item.original_bbox ?? item.bbox,
            modified: true,
            updated_at: now,
          };
          recordHistoryChange("move", item.id, item, after, groupId);
          clearPositionUncertain(item.id);
        }
        return;
      }

      const { item } = activeDrag;
      const newBbox =
        activeDrag.kind === "move"
          ? computeMovedBbox(item.bbox, activeDrag.start, current, dragBounds)
          : computeResizedBbox(item.bbox, activeDrag.handle, current, dragBounds);

      if (bboxEquals(newBbox, item.bbox) || !isDragRectSignificant(newBbox)) return;

      // EDIT-10: 자동검출 항목은 새 bbox가 실제로 덮는 텍스트를 재추출해 content를
      // 함께 갱신한다 — 사용자가 리사이즈로 영역을 맞춘 뒤 최종 검출 텍스트를
      // 확인할 수 있고, 블랙마킹 적용 후 searchable 잔존을 사전에 잡을 수 있다.
      // 사용자 지정 항목의 content는 사용자가 붙인 값이라 건드리지 않는다.
      // (bbox+content를 한 번의 history 항목으로 묶어 undo 한 번에 되돌린다.)
      let content = item.content;
      if (item.origin === "detected") {
        const extracted = await extractTextInBbox(item.page, newBbox);
        if (extracted) content = extracted;
      }

      const now = new Date().toISOString();
      const after: ReviewItem = {
        ...item,
        bbox: newBbox,
        content,
        // 여러 번 고쳐도 최초(가장 처음) 좌표만 보존한다.
        original_bbox: item.original_bbox ?? item.bbox,
        modified: true,
        updated_at: now,
      };
      recordHistoryChange("move", item.id, item, after);
      // IO-03: 사용자가 직접 위치를 고쳤으니 더는 "위치확인 필요"가 아니다.
      clearPositionUncertain(item.id);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      useAppStore.getState().setExclusionContactPage(null);
    };
  }, [drag, dragBounds, pageMargins, pageIndex]);

  // 목록에서 항목을 선택했는데 확대 상태거나 창이 작아서 그 bbox가 뷰어의
  // 스크롤 영역 밖에 있으면 아무것도 안 보여 "선택했는데 안 보인다"고
  // 느껴진다(사용자 재현 보고). 선택된 bbox가 이 페이지에 있으면, 이미
  // 화면에 완전히 보이는 경우엔 그대로 두고(매 클릭마다 재중앙정렬되면
  // 오히려 산만하다) 그렇지 않을 때만 스크롤해서 보이게 한다. 페이지
  // 자체가 다르면 RedactionList.tsx가 이미 goToPage로 이동시키고, 그
  // 페이지의 RedactionOverlay가 새로 마운트되면서 이 effect가 다시 돈다.
  useEffect(() => {
    if (!selectedItemId) return;
    const hasSelectedOnThisPage = reviewItems.some(
      (item) => item.id === selectedItemId && item.page === pageIndex,
    );
    if (!hasSelectedOnThisPage) return;

    let cancelled = false;
    let raf = 0;

    function frameInSelectedBox() {
      if (cancelled) return;
      const box = overlayRef.current?.querySelector<HTMLElement>(".redaction-overlay-box.active");
      const scrollContainer = box?.closest<HTMLElement>(".paginated-view, .scroll-view");
      if (!box || !scrollContainer) return;

      const boxRect = box.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const isFullyVisible =
        boxRect.top >= containerRect.top &&
        boxRect.bottom <= containerRect.bottom &&
        boxRect.left >= containerRect.left &&
        boxRect.right <= containerRect.right;

      if (!isFullyVisible) {
        box.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      }
    }

    // 레이아웃이 확정된 다음 프레임에 잰다 — 특히 다른 페이지로 이동한 직후엔
    // 페이지 이미지가 아직 로드/레이아웃 전이라, 즉시 재면 rect가 어긋나
    // "안 보이는데 보인다"고 오판하거나 엉뚱한 위치로 스크롤됐다(사용자 재현
    // "선택했는데 뷰어에서 프레임아웃"). 이미지가 로드 전이면 로드 후에 잰다.
    function scheduleFrameIn() {
      if (cancelled) return;
      raf = requestAnimationFrame(frameInSelectedBox);
    }

    const pageImg = overlayRef.current?.parentElement?.querySelector<HTMLImageElement>("img");
    if (pageImg && !pageImg.complete) {
      pageImg.addEventListener("load", scheduleFrameIn, { once: true });
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        pageImg.removeEventListener("load", scheduleFrameIn);
      };
    }

    scheduleFrameIn();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [selectedItemId, reviewItems, pageIndex]);

  if (!bboxVisible) return null;

  // LIST-14: '구분' 필터로 숨긴 카테고리는 뷰어에서도 bbox를 감춘다(목록·뷰어
  // 표시 일관). 페이지 필터는 뷰어와 무관하므로 카테고리 필터만 반영한다.
  const itemsOnPage = reviewItems.filter(
    (item) =>
      item.page === pageIndex && (categoryFilter === null || categoryFilter.includes(item.category)),
  );
  if (itemsOnPage.length === 0) return null;

  // PaginatedView.tsx의 handleMouseDown과 동일한 이유 — mousedown의 기본
  // 동작(포커스 이동)을 preventDefault로 같이 막아버리므로, 여기서 직접
  // 뷰어 스크롤 컨테이너로 포커스를 옮겨준다(다른 곳에 포커스가 있는 채로
  // 이미 선택된 bbox를 곧바로 드래그하는 경우를 위함).
  function focusScrollContainer(event: React.MouseEvent) {
    (event.target as HTMLElement).closest<HTMLElement>(".paginated-view, .scroll-view")?.focus();
  }

  function startMove(item: ReviewItem, event: React.MouseEvent) {
    // EDIT-13: alt-drag은 러버밴드 그룹선택 — bbox 위에서 시작해도 가로채지
    // 말고(stopPropagation 안 함) 뷰어(PaginatedView) 마퀴 핸들러로 흘려보낸다.
    // cmd/ctrl은 클릭 토글(다중선택)이므로 이동 드래그를 시작하지 않는다 —
    // onClick의 토글이 처리하도록 여기서 빠진다.
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    event.stopPropagation();
    // 선택 전이면 클릭만으로 선택되게 둔다(이동은 이미 선택된 항목에서만 시작).
    const inSelection = selectedItemIds.has(item.id) || item.id === selectedItemId;
    if (!inSelection) return;
    event.preventDefault();
    focusScrollContainer(event);
    const start = toRelativePoint(event.clientX, event.clientY);

    // EDIT-13: 다중선택(그룹) 상태에서 그 멤버를 끌면 그룹 전체를 함께 옮긴다.
    // 그룹 대상은 "이 페이지에서 선택됐고 구분 필터로 보이는" 항목들.
    const groupItems = reviewItems.filter(
      (i) =>
        i.page === pageIndex &&
        (selectedItemIds.has(i.id) || i.id === selectedItemId) &&
        (categoryFilter === null || categoryFilter.includes(i.category)),
    );
    if (groupItems.length > 1) {
      setDrag({ kind: "groupMove", items: groupItems, start, clickedId: item.id });
    } else {
      setDrag({ kind: "move", item, start });
    }
  }

  function startResize(item: ReviewItem, handle: ResizeHandle, event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    focusScrollContainer(event);
    setDrag({ kind: "resize", item, handle });
  }

  // EDIT-15(B-1): 그룹 프레임 8방향 핸들 드래그 시작 — 이 페이지에서 선택됐고
  // 구분 필터로 보이는 항목들을 스냅샷해 함께 리사이즈한다.
  function startGroupResize(items: ReviewItem[], handle: ResizeHandle8, event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    focusScrollContainer(event);
    setDrag({ kind: "groupResize", items, handle });
  }

  // 드래그 중이면 미리보기로 조정된 bbox를 보여준다.
  function previewBbox(item: ReviewItem): ReviewItem["bbox"] {
    if (!drag || !dragCurrent) return item.bbox;
    if (drag.kind === "groupMove") {
      if (!drag.items.some((i) => i.id === item.id)) return item.bbox;
      return (
        computeGroupMovedBboxes(drag.items, drag.start, dragCurrent, dragBounds).get(item.id) ?? item.bbox
      );
    }
    if (drag.kind === "groupResize") {
      if (!drag.items.some((i) => i.id === item.id)) return item.bbox;
      return (
        computeGroupResizedBboxes(drag.items, drag.handle, dragCurrent, dragBounds).get(item.id) ?? item.bbox
      );
    }
    if (drag.item.id !== item.id) return item.bbox;
    return drag.kind === "move"
      ? computeMovedBbox(item.bbox, drag.start, dragCurrent, dragBounds)
      : computeResizedBbox(item.bbox, drag.handle, dragCurrent, dragBounds);
  }

  // COLOR-02(§7.3): 자동검출/사용자 추가(+ 가져오기는 사용자 추가와 동일 취급)
  // × 선택 여부에 따라 배경·테두리를 고른다.
  function resolveColors(item: ReviewItem, isSelected: boolean): BoxColorPair {
    const scheme = item.origin === "detected" ? colorSettings.detected : colorSettings.manual;
    return isSelected ? scheme.selected : scheme.unselected;
  }

  // EDIT-15(B-1): 다중선택(≥2)이면 이 페이지의 선택 멤버를 감싸는 그룹 프레임에
  // 8방향 핸들을 띄워 한 번에 리사이즈한다. 프레임 사각형은 멤버의 미리보기
  // bbox로부터 계산해 드래그 중 스케일을 그대로 따라간다.
  const groupMembers = itemsOnPage.filter((item) => selectedItemIds.has(item.id));
  const groupFrame =
    selectedItemIds.size > 1 && groupMembers.length > 1
      ? groupBoundingBox(groupMembers.map((item) => ({ id: item.id, bbox: previewBbox(item) })))
      : null;

  return (
    <div className="redaction-overlay" ref={overlayRef}>
      {itemsOnPage.map((item) => {
        // EDIT-13: 다중선택(러버밴드/목록)의 멤버도 모두 선택색으로 강조한다.
        const isSelected = selectedItemIds.has(item.id) || item.id === selectedItemId;
        // 리사이즈 핸들은 단일 선택일 때만(그룹 상태에선 이동만, 핸들로 어수선해지지 않게).
        const showHandles = isSelected && selectedItemIds.size <= 1;
        const bbox = previewBbox(item);
        const colors = resolveColors(item, isSelected);

        return (
          <div
            key={item.id}
            className={`redaction-overlay-box${isSelected ? " active" : ""}`}
            style={{
              left: `${bbox.x * 100}%`,
              top: `${bbox.y * 100}%`,
              width: `${bbox.width * 100}%`,
              height: `${bbox.height * 100}%`,
              backgroundColor: hexToRgba(colors.background, isSelected ? 0.25 : 0.2),
              borderColor: colors.border,
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (event.metaKey || event.ctrlKey) {
                // EDIT-13: cmd/ctrl-click = 다중선택 토글(이미 선택돼 있으면 해제).
                // 목록의 cmd-click(RedactionList.handlePointerSelect)과 동일 규칙.
                const ids = toggleId(selectedItemIds, item.id);
                const active = ids.has(item.id)
                  ? item.id
                  : ids.size > 0
                    ? Array.from(ids)[ids.size - 1]
                    : null;
                setSelection(active, ids, item.id);
              } else {
                // 일반 클릭은 그 항목 하나만 선택(그룹 선택이 있었다면 단일로 접힘).
                setSelectedItemId(item.id);
              }
            }}
            onMouseDown={(event) => startMove(item, event)}
          >
            {showHandles &&
              RESIZE_HANDLES.map((handle) => (
                <div
                  key={handle}
                  className={`redaction-overlay-handle redaction-overlay-handle-${handle}`}
                  onMouseDown={(event) => startResize(item, handle, event)}
                />
              ))}
          </div>
        );
      })}

      {groupFrame && (
        <div
          className="redaction-group-frame"
          style={{
            left: `${groupFrame.x * 100}%`,
            top: `${groupFrame.y * 100}%`,
            width: `${groupFrame.width * 100}%`,
            height: `${groupFrame.height * 100}%`,
          }}
        >
          {GROUP_RESIZE_HANDLES.map((handle) => (
            <div
              key={handle}
              className={`redaction-overlay-handle redaction-overlay-handle-${handle}`}
              onMouseDown={(event) => startGroupResize(groupMembers, handle, event)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
