import type { ReviewItem } from "../types/generated/ReviewItem";
import type { RelativeBBox } from "../types/generated/RelativeBBox";

export interface ReanchorOutcome {
  items: ReviewItem[];
  positionUncertainItemIds: Set<string>;
}

/**
 * IO-03(§5.4): 재탐색 결과를 가져온 항목에 반영한다. 찾았으면(Some) 그
 * bbox로 갈아끼우고, 못 찾았으면(None) 기존 bbox($bbox 파싱값)를 그대로
 * 두고 '위치확인 필요'로 표시한다. `reanchored[i]`는 `items[i]`에 대응한다.
 */
export function applyReanchorResults(
  items: ReviewItem[],
  reanchored: Array<RelativeBBox | null>,
): ReanchorOutcome {
  const positionUncertainItemIds = new Set<string>();

  const result = items.map((item, index) => {
    const found = reanchored[index];
    if (found) return { ...item, bbox: found };
    positionUncertainItemIds.add(item.id);
    return item;
  });

  return { items: result, positionUncertainItemIds };
}
