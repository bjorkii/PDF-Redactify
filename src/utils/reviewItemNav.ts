import type { ReviewItem } from "../types/generated/ReviewItem";

/**
 * LIST-06(§8.3 ↑/↓): 정렬된 목록 기준으로 현재 선택 항목의 이전/다음 항목을
 * 찾는다. 선택된 항목이 없으면 방향과 무관하게 첫 항목에서 시작하고, 경계에
 * 도달하면 더 이상 움직이지 않는다(순환하지 않음) — BM-03의 북마크 이동
 * 규칙과 동일하다.
 */
export function computeNextSelectedItem(
  items: ReviewItem[],
  selectedItemId: string | null,
  direction: 1 | -1,
): ReviewItem | null {
  if (items.length === 0) return null;

  const currentIndex = selectedItemId ? items.findIndex((item) => item.id === selectedItemId) : -1;
  const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + direction));

  return items[nextIndex];
}
