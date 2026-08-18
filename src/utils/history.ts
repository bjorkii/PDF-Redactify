import type { ReviewItem } from "../types/generated/ReviewItem";
import type { HistoryEntry } from "../types/generated/HistoryEntry";
import type { HistoryState } from "../types/generated/HistoryState";
import type { HistoryAction } from "../types/generated/HistoryAction";

export interface HistoryApplyResult {
  items: ReviewItem[];
  history: HistoryState;
}

/**
 * STATE-06(§5.2): id가 일치하는 항목을 스냅샷으로 교체한다. 스냅샷이 null이면
 * (add의 before, delete의 after) 그 항목을 제거한다. action 종류(add/edit/
 * move/include 등)와 무관하게 "이 시점의 항목 스냅샷으로 되돌린다"는 동작은
 * 항상 같으므로, action별 분기 없이 이 하나로 undo/redo를 모두 표현한다.
 */
export function applySnapshot(
  items: ReviewItem[],
  itemId: string,
  snapshot: ReviewItem | null,
): ReviewItem[] {
  if (snapshot === null) return items.filter((item) => item.id !== itemId);

  const index = items.findIndex((item) => item.id === itemId);
  if (index === -1) return [...items, snapshot];

  const next = items.slice();
  next[index] = snapshot;
  return next;
}

/**
 * 새 변경을 기록하고 즉시 반영한다(§5.2 history.entries). cursor 이후 남아있던
 * (redo 가능했던) entries는 표준 undo 스택 동작대로 버린다 — 새 변경이 생기면
 * 그 갈래의 redo 경로는 더 이상 유효하지 않다.
 */
export function recordChange(
  items: ReviewItem[],
  history: HistoryState,
  action: HistoryAction,
  itemId: string,
  before: ReviewItem | null,
  after: ReviewItem | null,
  groupId?: string,
): HistoryApplyResult {
  const truncated = history.entries.slice(0, history.cursor);
  const entry: HistoryEntry = {
    seq: truncated.length + 1,
    timestamp: new Date().toISOString(),
    action,
    item_id: itemId,
    before,
    after,
    // 같은 사용자 동작(전체삭제 등)으로 묶인 entry는 같은 group_id를 갖는다 —
    // undo/redo가 이 그룹을 한 번에 처리한다. 단일 변경은 undefined.
    group_id: groupId,
  };
  const entries = [...truncated, entry];

  return {
    items: applySnapshot(items, itemId, after),
    history: { cursor: entries.length, entries },
  };
}

/**
 * cursor가 0이면(더 되돌릴 것이 없으면) 아무 것도 하지 않는다. cursor 바로 앞
 * entry가 group_id를 가지면, 같은 group_id로 연속된 entry들을 **한 번에** 되돌린다
 * (전체삭제를 한 번의 undo로 복원). group_id가 없으면 종전대로 한 개만.
 */
export function undo(items: ReviewItem[], history: HistoryState): HistoryApplyResult {
  if (history.cursor <= 0) return { items, history };

  const { entries } = history;
  const group = entries[history.cursor - 1].group_id;

  // 되돌릴 구간 [lo, cursor). 그룹이면 같은 group_id로 연속된 앞쪽까지 넓힌다.
  let lo = history.cursor - 1;
  if (group != null) {
    while (lo > 0 && entries[lo - 1].group_id === group) lo -= 1;
  }

  // before 스냅샷을 **오름차순**으로 적용해 원래 삽입 순서를 보존한다.
  let next = items;
  for (let i = lo; i < history.cursor; i += 1) {
    next = applySnapshot(next, entries[i].item_id, entries[i].before);
  }

  return { items: next, history: { cursor: lo, entries } };
}

/**
 * cursor가 entries 끝이면(더 다시실행할 것이 없으면) 아무 것도 하지 않는다.
 * cursor 위치 entry가 group_id를 가지면 같은 그룹을 한 번에 다시 실행한다.
 */
export function redo(items: ReviewItem[], history: HistoryState): HistoryApplyResult {
  if (history.cursor >= history.entries.length) return { items, history };

  const { entries } = history;
  const group = entries[history.cursor].group_id;

  // 다시 실행할 구간 [cursor, hi). 그룹이면 같은 group_id로 연속된 뒤쪽까지 넓힌다.
  let hi = history.cursor + 1;
  if (group != null) {
    while (hi < entries.length && entries[hi].group_id === group) hi += 1;
  }

  let next = items;
  for (let i = history.cursor; i < hi; i += 1) {
    next = applySnapshot(next, entries[i].item_id, entries[i].after);
  }

  return { items: next, history: { cursor: hi, entries } };
}

export function canUndo(history: HistoryState): boolean {
  return history.cursor > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.cursor < history.entries.length;
}
