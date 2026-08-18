import { useAppStore } from "../store/appStore";
import { buildNewManualReviewItem } from "../utils/reviewItemCreate";
import { sortReviewItems } from "../utils/reviewItemSort";
import { filterReviewItems } from "../utils/reviewItemFilter";
import { computeNextSelectedItem } from "../utils/reviewItemNav";
import { computeSelectionAfterDelete } from "../utils/reviewItemSelection";
import { collectItemsFullyInside } from "../utils/marqueeSelect";
import { goToPage } from "./pdfService";
import type { RelativeBBox } from "../types/generated/RelativeBBox";
import type { ReviewItem } from "../types/generated/ReviewItem";

/**
 * EDIT-01/03(§6.3.2, §7.1): 새 사용자 지정 항목을 만들고 선택 + 즉시 내용
 * 편집모드(pendingEditItemId, RedactionListRow가 소비)로 이어간다. 드래그로
 * 만들 때(PaginatedView)와 툴바 버튼으로 만들 때가 이 함수를 공유한다.
 *
 * 사용자 요청: 새 사용자 추가 영역에 **완전포함**되는 같은 페이지의 **기존 bbox
 * 전부**(자동검출·사용자 추가 무관)는 이 영역이 대체하므로 함께 삭제한다(상태바
 * 안내). 조금이라도 영역 밖으로 삐져나온 bbox는 보존한다(collectItemsFullyInside가
 * 완전포함만 반환). add와 흡수 삭제는 하나의 group으로 묶어 undo 한 번에 되돌린다.
 */
export function createManualReviewItem(page: number, bbox: RelativeBBox): void {
  const { recordHistoryChange, setSelectedItemId, setPendingEditItemId, reviewItems, setStatusMessage } =
    useAppStore.getState();

  const id = `m-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const item = buildNewManualReviewItem(id, page, bbox, now);

  // 이 영역에 완전히 들어오는 같은 페이지 항목 전부(origin 무관)가 흡수 대상.
  const onPage = reviewItems.filter((it) => it.page === page);
  const absorbedIds = collectItemsFullyInside(bbox, onPage);
  const groupId = absorbedIds.length > 0 ? `absorb-${crypto.randomUUID()}` : undefined;

  recordHistoryChange("add", id, null, item, groupId);
  for (const victimId of absorbedIds) {
    const victim = reviewItems.find((it) => it.id === victimId);
    if (victim) recordHistoryChange("delete", victimId, victim, null, groupId);
  }
  if (absorbedIds.length > 0) {
    setStatusMessage("새 영역에 완전히 포함된 기존 블랙마킹은 이 영역으로 대체됩니다.");
  }

  setSelectedItemId(id);
  setPendingEditItemId(id);
}

/** 드래그 없이도 추가할 수 있도록, 현재 페이지 중앙에 적당한 기본 크기로 놓는다. */
const DEFAULT_BBOX: RelativeBBox = { x: 0.35, y: 0.475, width: 0.3, height: 0.05 };

/** EDIT-03(§7.1): 툴바 "블랙마킹 추가" — 현재 페이지 중앙에 새 항목을 만든다. */
export function addReviewItemAtDefaultPosition(): void {
  const { document, currentPageIndex } = useAppStore.getState();
  if (!document) return;
  createManualReviewItem(currentPageIndex, DEFAULT_BBOX);
}

/**
 * EDIT-03(§7.1)/LIST-09/LIST-10(§8): 블랙마킹 목록 헤더 "삭제"(Del) — **선택된
 * 항목(다중선택이면 전부)** 을 지운다(항목마다 개별 history entry → undo 가능).
 * 삭제 후에는 §사용자 요청대로 "가장 아래 삭제 항목의 바로 다음 생존 항목"을
 * 화면(정렬·필터) 순서 기준으로 선택하고, 그 id를 반환한다(호출부가 스크롤에 사용).
 */
export function deleteSelectedReviewItem(): string | null {
  const { reviewItems, selectedItemIds, selectedItemId, reviewListFilter, sort, recordHistoryChange, setSelectedItemId } =
    useAppStore.getState();

  // 다중선택 집합이 우선. 비어 있으면 활성 항목 하나로 폴백.
  const deletedIds =
    selectedItemIds.size > 0 ? selectedItemIds : selectedItemId ? new Set([selectedItemId]) : new Set<string>();
  if (deletedIds.size === 0) return null;

  // 다음 선택 계산은 화면에 보이는 순서(정렬·필터 적용) 기준.
  const visible = sortReviewItems(filterReviewItems(reviewItems, reviewListFilter), sort);
  const nextId = computeSelectionAfterDelete(visible, deletedIds);

  for (const item of reviewItems) {
    if (deletedIds.has(item.id)) recordHistoryChange("delete", item.id, item, null);
  }

  setSelectedItemId(nextId);
  // 다음 선택 항목을 뷰어에도 보여준다 — 삭제 후 자동선택된 항목이 뷰어에서
  // 프레임아웃돼 있던 문제(사용자 재현) 대응. 목록 스크롤은 RedactionList의
  // effect가 맡는다.
  if (nextId) {
    const nextItem = visible.find((item) => item.id === nextId);
    if (nextItem) void goToPage(nextItem.page);
  }
  return nextId;
}

/**
 * LIST-10(안전): 현재 선택된 항목 중 **하나라도 블랙마킹 목록 뷰포트에 실제로
 * 보이는지**. 키보드 Delete는 이게 true일 때만 실행해, 스크롤로 화면 밖에 있는
 * 선택을 실수로 지우는 것을 막는다(사용자 요청). DOM을 읽으므로 순수
 * deleteSelectedReviewItem에는 넣지 않고 호출부(App.tsx)에서 게이트로 쓴다.
 */
export function isAnySelectedItemVisibleInList(): boolean {
  const { selectedItemIds, selectedItemId } = useAppStore.getState();
  const ids =
    selectedItemIds.size > 0 ? selectedItemIds : selectedItemId ? new Set([selectedItemId]) : new Set<string>();
  if (ids.size === 0) return false;

  const scroll = document.querySelector<HTMLElement>("[data-redaction-scroll]");
  if (!scroll) return false;
  const viewport = scroll.getBoundingClientRect();

  for (const row of Array.from(scroll.querySelectorAll<HTMLElement>("[data-review-item-id]"))) {
    const id = row.dataset.reviewItemId;
    if (!id || !ids.has(id)) continue;
    const rect = row.getBoundingClientRect();
    if (rect.bottom > viewport.top && rect.top < viewport.bottom) return true;
  }
  return false;
}

/** LIST-09(§8): 블랙마킹 목록 헤더 "모두삭제"(Option/Alt+Del) — 전체 항목을
 * 지운다. 항목마다 history entry를 남기되 **같은 group_id로 묶어**, undo 한 번에
 * 전체가 복원되도록 한다(사용자 요청 — history.ts의 그룹 undo/redo 참고). */
export function deleteAllReviewItems(): void {
  const { reviewItems, recordHistoryChange, setSelectedItemId } = useAppStore.getState();
  if (reviewItems.length === 0) return;

  const groupId = `del-all-${crypto.randomUUID()}`;
  // 스냅샷을 먼저 떠 둔다 — recordHistoryChange가 reviewItems를 즉시 줄여, 루프
  // 도중 store를 다시 읽으면 이미 지워진 항목을 놓치기 때문.
  const snapshot = [...reviewItems];
  for (const item of snapshot) {
    recordHistoryChange("delete", item.id, item, null, groupId);
  }
  setSelectedItemId(null);
}

/**
 * EDIT-13(전체선택): 블랙마킹 목록에 포커스가 있을 때 alt-a — 문서 전체(현재
 * 필터로 목록에 보이는) 항목을 모두 선택한다. 활성(primary)은 정렬 순서상
 * 첫 항목. 보이는 항목이 없으면 아무 것도 하지 않는다.
 */
export function selectAllReviewItemsInList(): void {
  const { reviewItems, reviewListFilter, sort, setSelection, setStatusMessage } = useAppStore.getState();
  const visible = sortReviewItems(filterReviewItems(reviewItems, reviewListFilter), sort);
  if (visible.length === 0) return;
  setSelection(visible[0].id, new Set(visible.map((item) => item.id)), visible[0].id);
  setStatusMessage("이 문서 전체의 대상 정보가 모두 선택됐습니다.");
}

/**
 * EDIT-13(전체선택): 뷰어에 포커스가 있을 때 alt-a — **해당 페이지**의 bbox를
 * 모두 선택한다. 뷰어에 실제로 보이는 것과 맞추기 위해 구분(category) 필터만
 * 반영한다(목록의 페이지 필터는 뷰어 표시와 무관, RedactionOverlay와 동일 규칙).
 */
export function selectAllReviewItemsOnPage(pageIndex: number): void {
  const { reviewItems, reviewListFilter, setSelection, setStatusMessage } = useAppStore.getState();
  const categoryFilter = reviewListFilter.categories;
  const onPage = reviewItems.filter(
    (item) =>
      item.page === pageIndex &&
      (categoryFilter === null || categoryFilter.includes(item.category)),
  );
  if (onPage.length === 0) return;
  setSelection(onPage[0].id, new Set(onPage.map((item) => item.id)), onPage[0].id);
  setStatusMessage("이 쪽의 대상 정보가 모두 선택됐습니다.");
}

/**
 * LIST-06/KEY-01(§8.1/§8.3 ↑/↓): 정렬된 목록 기준 이전(-1)/다음(1) 항목을
 * 선택하고 뷰어를 그 페이지로 이동시킨다(§8.1 "뷰어 자동 스크롤"). 뷰어
 * 포커스(§8.1)와 블랙마킹 사이드바 포커스(§8.3)가 이 로직을 공유한다 —
 * 사이드바 쪽은 여기에 추가로 가상 목록 스크롤만 얹는다(RedactionList).
 * 다음 항목이 없으면(목록이 비었거나 이미 끝) 아무 것도 하지 않는다.
 */
export function selectAdjacentReviewItem(direction: 1 | -1): ReviewItem | null {
  const { reviewItems, sort, reviewListFilter, selectedItemId, selectedItemIds, setSelection } =
    useAppStore.getState();
  // 화면에 **보이는(필터 적용)** 목록 순서로만 이동한다 — 안 그러면 필터로 숨겨진
  // 항목으로 선택이 넘어가 하이라이트가 사라지고 이동이 멈춘 것처럼 보인다
  // (사용자 재현). filterReviewItems로 걸러 뷰와 동일한 순서를 쓴다.
  const items = sortReviewItems(filterReviewItems(reviewItems, reviewListFilter), sort);
  const next = computeNextSelectedItem(items, selectedItemId, direction);
  if (!next) return null;

  // 커서만 옮기고 Space로 마킹해 둔 다중선택 집합(selectedItemIds)은 지우지
  // 않는다(사용자 요청 — 화살표로 옮겨다니며 Space로 누적/해제). 마크가 없으면
  // 집합은 계속 비어 있어(커서 폴백) 단일 탐색과 동일하게 동작한다.
  setSelection(next.id, selectedItemIds, next.id);
  void goToPage(next.page);
  return next;
}
