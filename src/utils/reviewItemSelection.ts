import type { ReviewItem } from "../types/generated/ReviewItem";

/**
 * LIST-10(다중선택): 정렬·필터가 적용된 **화면 순서**(`items`) 기준의 순수 선택
 * 연산 모음. 실제 store 반영은 호출부(RedactionList)가 하고, 여기서는 "어떤
 * id들이 선택되어야 하는가"만 계산한다.
 */

/** anchor~target 사이(양끝 포함)의 항목 id 집합. 한쪽을 못 찾으면 찾은 쪽만 담는다. */
export function rangeIds(items: ReviewItem[], anchorId: string | null, targetId: string): Set<string> {
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) return new Set();

  const anchorIndex = anchorId ? items.findIndex((item) => item.id === anchorId) : -1;
  if (anchorIndex === -1) return new Set([targetId]);

  const lo = Math.min(anchorIndex, targetIndex);
  const hi = Math.max(anchorIndex, targetIndex);
  return new Set(items.slice(lo, hi + 1).map((item) => item.id));
}

/** cmd/ctrl-click: 집합에서 id를 토글한 **새** 집합을 돌려준다. */
export function toggleId(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * shift+↑/↓: 앵커를 고정한 채 활성 항목을 한 칸 이동하고, 앵커~새활성 범위를
 * 선택한다. 앵커가 없으면 현재 활성을 앵커로 삼는다. 경계에선 이동하지 않는다.
 */
export function extendSelection(
  items: ReviewItem[],
  anchorId: string | null,
  activeId: string | null,
  direction: 1 | -1,
): { activeId: string; anchorId: string; ids: Set<string> } | null {
  if (items.length === 0) return null;

  const anchor = anchorId ?? activeId;
  const activeIndex = activeId ? items.findIndex((item) => item.id === activeId) : -1;
  const nextIndex = Math.max(0, Math.min(items.length - 1, activeIndex + direction));
  const nextActive = items[nextIndex].id;
  const effectiveAnchor = anchor ?? nextActive;

  return {
    activeId: nextActive,
    anchorId: effectiveAnchor,
    ids: rangeIds(items, effectiveAnchor, nextActive),
  };
}

/**
 * 삭제 후 다음 선택 항목(§ 사용자 요청): 삭제된 것 중 **가장 아래**(화면 순서상
 * 최대 인덱스) 항목의 바로 다음 생존 항목을 고른다. 아래에 남은 게 없으면 그 위의
 * 가장 가까운 생존 항목, 그것도 없으면(모두 삭제) null.
 */
export function computeSelectionAfterDelete(
  items: ReviewItem[],
  deletedIds: Set<string>,
): string | null {
  let bottomIndex = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (deletedIds.has(items[i].id)) bottomIndex = i;
  }
  if (bottomIndex === -1) return null;

  for (let i = bottomIndex + 1; i < items.length; i += 1) {
    if (!deletedIds.has(items[i].id)) return items[i].id;
  }
  for (let i = bottomIndex - 1; i >= 0; i -= 1) {
    if (!deletedIds.has(items[i].id)) return items[i].id;
  }
  return null;
}
