import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/appStore";
import { goToNextPage, goToPreviousPage, renderCurrentPage } from "../services/pdfService";
import { createManualReviewItem } from "../services/reviewItemActions";
import { computeDragRect, isDragRectSignificant, type DragPoint } from "../utils/dragRect";
import { collectItemsFullyInside } from "../utils/marqueeSelect";
import { accumulateBoundaryScroll } from "../utils/wheelPageTurn";
import { handleViewerNavigationKeyDown } from "../utils/viewerNavigation";
import { EMPTY_MARGINS, marginsToDragBounds, bboxTouchesExclusion } from "../utils/exclusionZone";
import { RedactionOverlay } from "./RedactionOverlay";
import { ExclusionZoneOverlay } from "./ExclusionZoneOverlay";
import "./Viewer.css";

// 트랙패드 관성 스크롤(운동량)은 손가락을 뗀 뒤에도 한동안 wheel 이벤트가
// 계속 들어온다 — 그래서 한 번의 물리적 스와이프가 누적 임계값을 여러 번
// 넘겨서 페이지가 여러 장 연속으로 넘어가 버릴 수 있다(사용자 재현: 20페이지
// 문서에서 한 번 밀었더니 1페이지/20페이지로 곧장 이동). macOS 미리보기처럼
// "한 번 밀면 딱 한 페이지만" 넘어가게 하려면, 전환이 일어난 뒤 잠깐(관성이
// 잦아들 때까지) 같은 제스처의 나머지 이벤트를 무시해야 한다.
const PAGE_TURN_COOLDOWN_MS = 600;

// SPEC §6.1 페이지네이션 보기 모드: 현재 페이지 1장만 표시.
// EDIT-01(§6.3.2): 페이지 위를 드래그하면 새 bbox를 만든다(연속 스크롤
// 모드는 여러 페이지가 동시에 마운트되어 좌표 처리가 더 복잡하므로 범위 밖).
export function PaginatedView() {
  const document = useAppStore((s) => s.document)!;
  const renderedPage = useAppStore((s) => s.renderedPage);
  const exclusionZoneEditMode = useAppStore((s) => s.exclusionZoneEditMode);
  const exclusionZones = useAppStore((s) => s.exclusionZones);
  const exclusionContactPage = useAppStore((s) => s.exclusionContactPage);

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<DragPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<DragPoint | null>(null);
  // EDIT-13: alt-drag 러버밴드(그룹선택) 상태 — 새 bbox 생성 드래그와 별개.
  const [marquee, setMarquee] = useState<{ start: DragPoint; current: DragPoint } | null>(null);

  // PDF-04(사용자 버그): 스크롤 모드에서는 currentPageIndex만 갱신되고 renderedPage
  // (표시 비트맵)는 다시 렌더되지 않는다. 그래서 페이지 모드로 돌아오면 스크롤에서
  // 보던 페이지가 아니라 마지막으로 렌더된(진입) 페이지가 그대로 보였다. 페이지
  // 모드로 진입할 때 renderedPage가 currentPageIndex와 다르면 현재 페이지를 렌더한다.
  useEffect(() => {
    const { document: doc, currentPageIndex, renderedPage: current } = useAppStore.getState();
    if (doc && current?.pageIndex !== currentPageIndex) {
      void renderCurrentPage(doc.path, currentPageIndex);
    }
  }, []);

  // DET-07: 이 페이지에 탐지 제외영역이 설정돼 있으면, 새 bbox를 드래그로
  // 만들 때 그 영역 안으로는 들어가지 못하게 한다(사용자 요청) — 편집
  // 모드(exclusionZoneEditMode)와 무관하게, 제외영역이 설정된 페이지라면
  // 항상 적용한다(검출에서 제외되는 것과 같은 조건).
  const pageMargins = exclusionZones.find((z) => z.pageIndex === renderedPage?.pageIndex)?.margins ?? EMPTY_MARGINS;
  const dragBounds = marginsToDragBounds(pageMargins);

  function toRelativePoint(clientX: number, clientY: number): DragPoint {
    const rect = wrapperRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  }

  function handleMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    // DET-07: 제외 영역 편집 중에도 bbox 생성 등 기존 페이지 인터랙션이
    // 그대로 동작해야 한다(사용자 요청 — 편집모드는 가이드/음영을 보여줄
    // 뿐, 다른 조작을 막지 않는다). 가이드 바 자체의 pointerdown은
    // ExclusionZoneOverlay에서 이미 preventDefault + stopPropagation하므로,
    // 가이드를 드래그할 때는 이 mousedown이 애초에 발생하지 않는다(Pointer
    // Events 스펙 — pointerdown에서 preventDefault하면 합성 mousedown이
    // 억제된다) — 그래서 여기서 exclusionZoneEditMode를 따로 검사할 필요가 없다.
    // EDIT-13: alt를 누른 채 드래그하면 새 bbox를 그리는 게 아니라 러버밴드로
    // 그룹선택한다 — 빈 곳/기존 bbox 위 어디서 시작하든 alt면 항상 마퀴로 간다.
    if (event.altKey) {
      event.preventDefault();
      containerRef.current?.focus();
      const point = toRelativePoint(event.clientX, event.clientY);
      setMarquee({ start: point, current: point });
      return;
    }
    // EDIT-13: cmd/ctrl은 bbox 다중선택 토글용 modifier다(RedactionOverlay
    // onClick이 처리) — 빈 곳에서 cmd-클릭/드래그하더라도 새 bbox를 그리기
    // 시작하지 않는다.
    if (event.metaKey || event.ctrlKey) return;
    // 기존 bbox를 클릭한 것이면(선택용) 새로 그리기 시작하지 않는다.
    if ((event.target as HTMLElement).closest(".redaction-overlay-box")) return;
    // preventDefault 없이는 브라우저의 기본 드래그-선택(텍스트/이미지 선택)이
    // 이 커스텀 드래그와 동시에 시작돼, 페이지 주변 텍스트가 파랗게 선택되며
    // bbox 실시간 미리보기(.redaction-drag-guide)를 가리거나 헷갈리게 만든다.
    // 다만 mousedown의 기본 동작에는 포커스 이동도 포함돼 있어서, 이걸
    // 막으면 부작용으로 "북마크 사이드바 등 다른 곳에 포커스가 있는 채로
    // 뷰어를 클릭해도 포커스가 안 넘어온다"는 문제가 같이 생긴다(사용자
    // 재현) — 우리가 막은 그 포커스 이동을 여기서 직접 대신 해준다.
    event.preventDefault();
    containerRef.current?.focus();
    const point = toRelativePoint(event.clientX, event.clientY);
    setDragStart(point);
    setDragCurrent(point);
  }

  // mousemove/mouseup은 window에 붙인다 — 빠르게 드래그하면 커서가 뷰어 밖으로
  // 나갈 수 있는데, 그래도 가이드 갱신과 완료 처리가 이어져야 한다.
  useEffect(() => {
    if (!dragStart) return;

    function handleMove(event: MouseEvent) {
      const current = toRelativePoint(event.clientX, event.clientY);
      setDragCurrent(current);
      // EDIT-14: 그리는 중 사각형이 제외영역 경계에 닿으면 그 페이지 바를 잠깐 보여준다.
      const rect = computeDragRect(dragStart!, current, dragBounds);
      const touching = renderedPage != null && bboxTouchesExclusion(rect, pageMargins);
      useAppStore.getState().setExclusionContactPage(touching ? renderedPage!.pageIndex : null);
    }

    function handleUp(event: MouseEvent) {
      const current = toRelativePoint(event.clientX, event.clientY);
      const rect = computeDragRect(dragStart!, current, dragBounds);
      setDragStart(null);
      setDragCurrent(null);
      useAppStore.getState().setExclusionContactPage(null);

      if (!isDragRectSignificant(rect) || !renderedPage) return;
      createManualReviewItem(renderedPage.pageIndex, rect);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      useAppStore.getState().setExclusionContactPage(null);
    };
  }, [dragStart, renderedPage, dragBounds, pageMargins]);

  // EDIT-13: 러버밴드 드래그 갱신·확정. 마우스업 시점에 마퀴에 온전히 들어온
  // (그 페이지의, 구분 필터로 보이는) 항목을 그룹선택한다. 아무 것도 안 들어오면
  // 선택을 비운다(빈 곳 alt-drag = 전체 선택 해제, 데스크톱 마퀴 관례).
  useEffect(() => {
    if (!marquee) return;

    function handleMove(event: MouseEvent) {
      setMarquee((prev) => (prev ? { ...prev, current: toRelativePoint(event.clientX, event.clientY) } : prev));
    }

    function handleUp(event: MouseEvent) {
      const current = toRelativePoint(event.clientX, event.clientY);
      const rect = computeDragRect(marquee!.start, current);
      setMarquee(null);
      if (!renderedPage) return;

      const { reviewItems, reviewListFilter, setSelection } = useAppStore.getState();
      const categoryFilter = reviewListFilter.categories;
      const onPage = reviewItems.filter(
        (item) =>
          item.page === renderedPage.pageIndex &&
          (categoryFilter === null || categoryFilter.includes(item.category)),
      );
      const ids = isDragRectSignificant(rect) ? collectItemsFullyInside(rect, onPage) : [];
      const primary = ids[0] ?? null;
      setSelection(primary, new Set(ids), primary);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [marquee, renderedPage]);

  // §8.1 $패닝(트랙패드): 두 손가락으로 페이지 상/하 경계까지 스크롤한 뒤
  // 같은 방향으로 계속 밀면 "덜컹"하는 느낌 이후 다음/이전 페이지로 넘어간다
  // (accumulateBoundaryScroll 참고). ctrl/meta+wheel(확대·§8.1 $확대/축소)은
  // Viewer.tsx가 처리하므로 여기서는 건드리지 않고 그대로 넘긴다. React의
  // onWheel은 기본 passive라 preventDefault가 안 먹으므로 네이티브 리스너를
  // 직접 붙인다.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let accumulated = 0;
    let cooldownUntil = 0;

    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey) return;

      if (performance.now() < cooldownUntil) {
        // 방금 전환한 같은 제스처의 관성 꼬리 — 다음 페이지에서 또 전환이
        // 일어나지 않게 무시하되, 그 사이 네이티브 스크롤/제스처로 새지
        // 않게 막는다.
        event.preventDefault();
        return;
      }

      const atTop = container!.scrollTop <= 0;
      const atBottom = container!.scrollTop + container!.clientHeight >= container!.scrollHeight;
      const result = accumulateBoundaryScroll(accumulated, event.deltaY, atTop, atBottom);
      accumulated = result.remaining;

      if (result.turn !== 0) {
        // 실제로 페이지를 넘기는 이벤트만 막는다 — 그 사이 웹뷰가 이미
        // 보여주고 있었을 러버밴드 바운스와 겹쳐 어색해지지 않게, 전환이
        // 확정된 순간에만 preventDefault한다.
        event.preventDefault();
        accumulated = 0;
        cooldownUntil = performance.now() + PAGE_TURN_COOLDOWN_MS;
        void (result.turn === 1 ? goToNextPage() : goToPreviousPage());
      }
      // 임계값 전(경계를 살짝 미는 중)에는 일부러 preventDefault하지 않는다
      // — 컨테이너 자신의 네이티브 오버스크롤(러버밴드) 바운스가 그대로
      // 보이도록 둬서, 그게 "밀리는 저항감" 피드백이 되게 한다(사용자 요청
      // — 경계에서 곧장 넘어가지 말고 약간 bounce 후 threshold를 넘어야
      // 전환). .paginated-view의 overscroll-behavior: contain(Viewer.css)이
      // 이 바운스가 상위 요소로 새는 것만 막는다.
    }

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  if (!renderedPage) return null;

  const dragRect = dragStart && dragCurrent ? computeDragRect(dragStart, dragCurrent, dragBounds) : null;
  // EDIT-13: 러버밴드는 제외영역과 무관하게 페이지 전체를 훑을 수 있다(선택용).
  const marqueeRect = marquee ? computeDragRect(marquee.start, marquee.current) : null;

  return (
    <div
      className="paginated-view"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleViewerNavigationKeyDown}
    >
      <div
        className="viewer-page-wrapper"
        ref={wrapperRef}
        data-page-wrapper
        data-page-index={renderedPage.pageIndex}
        onMouseDown={handleMouseDown}
      >
        <img
          className="viewer-page"
          src={`data:image/png;base64,${renderedPage.pngBase64}`}
          alt={`${document.filename} ${renderedPage.pageIndex + 1}페이지`}
          // B-3(DIST-05): 페이지 이미지 드래그→스냅샷 드래그 방지(뷰어 wrapper의
          // onDragStart·CSS -webkit-user-drag와 이중 방어).
          draggable={false}
          // CSS aspect-ratio를 강제하지 않는다 — width/height가 모두 auto인
          // 상태에서는 이미지 자체의 실제 픽셀 비율(natural size)이 이미
          // 정확하고, 여기에 (반올림으로 미세하게 어긋날 수 있는) 비율을
          // 또 강제하면 object-fit 기본값(fill)이 비트맵을 그 비율에 맞춰
          // 늘려버릴 수 있다. auto 크기만으로 충분히 왜곡 없이 표시된다
          // (max-width/max-height는 안 건다 — Viewer.css 주석 참고, 확대
          // 시 실제 크기로 넘쳐서 스크롤돼야 한다).
        />
        <RedactionOverlay pageIndex={renderedPage.pageIndex} />
        {exclusionZoneEditMode && <ExclusionZoneOverlay pageIndex={renderedPage.pageIndex} />}
        {/* EDIT-14: 편집모드가 아니어도, bbox 드래그가 제외영역에 닿는 동안엔
            읽기전용 바를 잠깐 보여 한계를 알린다. */}
        {!exclusionZoneEditMode && exclusionContactPage === renderedPage.pageIndex && (
          <ExclusionZoneOverlay pageIndex={renderedPage.pageIndex} readOnly />
        )}
        {dragRect && (
          <div
            className="redaction-drag-guide"
            style={{
              left: `${dragRect.x * 100}%`,
              top: `${dragRect.y * 100}%`,
              width: `${dragRect.width * 100}%`,
              height: `${dragRect.height * 100}%`,
            }}
          />
        )}
        {marqueeRect && (
          <div
            className="redaction-marquee"
            style={{
              left: `${marqueeRect.x * 100}%`,
              top: `${marqueeRect.y * 100}%`,
              width: `${marqueeRect.width * 100}%`,
              height: `${marqueeRect.height * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
