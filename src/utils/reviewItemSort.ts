import type { ReviewItem } from "../types/generated/ReviewItem";
import type { SortState } from "../store/appStore";
import { categoryLabel } from "./reviewItemCategory";

/** §5.2: 정렬 기준(기본) — bbox 위치 순서(page → y → x). */
function compareByPosition(a: ReviewItem, b: ReviewItem): number {
  if (a.page !== b.page) return a.page - b.page;
  if (a.bbox.y !== b.bbox.y) return a.bbox.y - b.bbox.y;
  return a.bbox.x - b.bbox.x;
}

/** LIST-05(§6.4): 헤더 클릭으로 고를 수 있는 정렬 컬럼. */
export type SortColumn = "position" | "category" | "content" | "page";

function compareByColumn(a: ReviewItem, b: ReviewItem, column: string): number {
  switch (column) {
    case "category":
      // 사용자가 보는 값(한국어 표시명) 기준으로 정렬한다.
      return categoryLabel(a.category).localeCompare(categoryLabel(b.category), "ko");
    case "content":
      return a.content.localeCompare(b.content, "ko");
    case "page":
      return a.page - b.page;
    case "position":
    default:
      return compareByPosition(a, b);
  }
}

/**
 * LIST-01/05(§6.4): 목록 정렬. 기본(position)은 위치 순서(page→y→x), 헤더를
 * 클릭하면 구분/내용/위치 컬럼으로 바꿀 수 있다(nextSortState로 계산).
 */
export function sortReviewItems(items: ReviewItem[], sort: SortState): ReviewItem[] {
  const sorted = [...items].sort((a, b) => compareByColumn(a, b, sort.column));
  return sort.direction === "desc" ? sorted.reverse() : sorted;
}

/**
 * LIST-05(§6.4): 헤더 클릭 시 다음 정렬 상태. 다른 컬럼을 클릭하면 그 컬럼
 * 오름차순으로, 이미 그 컬럼이면 오름/내림을 토글한다.
 */
export function nextSortState(current: SortState, column: SortColumn): SortState {
  if (current.column !== column) return { column, direction: "asc" };
  return { column, direction: current.direction === "asc" ? "desc" : "asc" };
}
