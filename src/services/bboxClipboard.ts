import { useAppStore } from "../store/appStore";
import { computePastedBBoxes, type CopiedBBox } from "../utils/bboxPaste";
import { buildNewManualReviewItem } from "../utils/reviewItemCreate";

/**
 * EDIT-12(§6.3.2 인접): bbox cmd/ctrl-C 복사 · cmd/ctrl-V 붙여넣기.
 * 붙여넣기는 현재 마우스 위치를 그룹 좌상단으로 삼고 크기는 원본을 유지한다.
 * **페이지네이션·연속 스크롤 두 모드 모두 지원**한다 — 마우스가 올라가 있는
 * 페이지(연속 스크롤은 여러 페이지가 보이므로 `[data-page-wrapper]`로 그 아래
 * 페이지를 찾는다)에 붙이고, 마우스가 페이지 밖이면 현재 페이지 중앙에 붙인다.
 *
 * 클립보드는 세션 메모리에만 두고 sidecar에는 저장하지 않는다(§5 자동저장
 * 대상이 아님) — 그래서 store가 아니라 이 모듈의 지역 상태로 관리한다.
 */
let clipboard: CopiedBBox[] = [];
let lastMouse: { clientX: number; clientY: number } | null = null;

/** 붙여넣기 anchor 계산을 위해 뷰어 위 마지막 마우스 위치를 추적한다. */
export function startViewerMouseTracking(): () => void {
  function handleMove(event: MouseEvent) {
    lastMouse = { clientX: event.clientX, clientY: event.clientY };
  }
  window.addEventListener("mousemove", handleMove);
  return () => window.removeEventListener("mousemove", handleMove);
}

export function hasClipboardBBoxes(): boolean {
  return clipboard.length > 0;
}

/** 테스트용: 클립보드/마우스 상태 초기화. */
export function resetBboxClipboard(): void {
  clipboard = [];
  lastMouse = null;
}

/** 테스트용: 마우스 위치 주입. */
export function setLastMouseForTest(pos: { clientX: number; clientY: number } | null): void {
  lastMouse = pos;
}

/**
 * EDIT-12: 현재 선택된 항목(다중선택이면 전부)의 **bbox(크기·상대위치)만**
 * 복사한다(구분·내용은 옮기지 않음). 대상이 없으면 false(호출부가
 * preventDefault를 건너뛰어 OS 기본 복사를 방해하지 않도록).
 */
export function copySelectedBBoxes(): boolean {
  const { reviewItems, selectedItemIds, selectedItemId } = useAppStore.getState();
  const ids =
    selectedItemIds.size > 0
      ? selectedItemIds
      : selectedItemId
        ? new Set([selectedItemId])
        : new Set<string>();
  if (ids.size === 0) return false;

  clipboard = reviewItems
    .filter((item) => ids.has(item.id))
    .map((item) => ({ bbox: { ...item.bbox } }));
  return clipboard.length > 0;
}

/**
 * 붙여넣을 대상 페이지·기준점(0~1)을 정한다. 마우스가 어떤 페이지 위(두 모드
 * 공통으로 `[data-page-wrapper][data-page-index]`)에 있으면 그 페이지의 상대
 * 좌표를, 아니면 `fallbackPage` 중앙에 붙인다. 대상 페이지를 못 정하면 null.
 */
function resolvePasteTarget(fallbackPage: number | null): { pageIndex: number; x: number; y: number } | null {
  if (lastMouse) {
    const wrappers = document.querySelectorAll<HTMLElement>("[data-page-wrapper][data-page-index]");
    for (const wrapper of wrappers) {
      const rect = wrapper.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const x = (lastMouse.clientX - rect.left) / rect.width;
      const y = (lastMouse.clientY - rect.top) / rect.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        const pageIndex = Number(wrapper.dataset.pageIndex);
        if (Number.isInteger(pageIndex)) return { pageIndex, x, y };
      }
    }
  }
  if (fallbackPage == null) return null;
  return { pageIndex: fallbackPage, x: 0.35, y: 0.475 };
}

/**
 * EDIT-12: 클립보드의 bbox를 마우스 아래(또는 현재) 페이지에 **크기만 유지한
 * '내용 없는 사용자 추가' 항목**으로 붙여넣는다. 여러 건은 상대 배치를 유지한
 * 채 그룹으로 붙고, 붙여넣은 항목을 새로 선택한다(다중이면 하나의 group_id로
 * 묶어 undo 한 번에 전부 되돌림). 두 보기 모드 모두 동작. 붙일 수 없으면 false.
 */
export function pasteBBoxes(): boolean {
  if (clipboard.length === 0) return false;
  const { document: doc, viewMode, renderedPage, currentPageIndex, recordHistoryChange, setSelection } =
    useAppStore.getState();
  if (!doc) return false;

  // 마우스가 페이지 밖일 때의 폴백 페이지: 페이지네이션은 현재 렌더된 페이지,
  // 연속 스크롤은 currentPageIndex(스크롤 위치로 추정된 현재 페이지).
  const fallbackPage = viewMode === "paginated" ? renderedPage?.pageIndex ?? null : currentPageIndex;
  const target = resolvePasteTarget(fallbackPage);
  if (!target) return false;

  const bboxes = computePastedBBoxes(clipboard, { x: target.x, y: target.y });
  const now = new Date().toISOString();
  const groupId = bboxes.length > 1 ? `paste-${crypto.randomUUID()}` : undefined;

  const newIds: string[] = [];
  for (const bbox of bboxes) {
    const id = `m-${crypto.randomUUID()}`;
    // 내용 없는 사용자 추가 항목(origin manual, content "", category Custom).
    const item = buildNewManualReviewItem(id, target.pageIndex, bbox, now);
    recordHistoryChange("add", id, null, item, groupId);
    newIds.push(id);
  }

  const primary = newIds[0] ?? null;
  setSelection(primary, new Set(newIds), primary);
  return true;
}
