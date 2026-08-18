import { describe, expect, it } from "vitest";
import { applySnapshot, recordChange, undo, redo, canUndo, canRedo } from "./history";
import type { ReviewItem } from "../types/generated/ReviewItem";
import type { HistoryState } from "../types/generated/HistoryState";

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "r-0",
    origin: "manual",
    page: 0,
    bbox: { x: 0, y: 0, width: 0.1, height: 0.1 },
    original_bbox: null,
    category: "Custom",
    content: "테스트",
    pattern_type: null,
    confidence: null,
    validation: "NotValidated",
    modified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const EMPTY_HISTORY: HistoryState = { cursor: 0, entries: [] };

describe("grouped undo/redo (전체삭제 배치)", () => {
  it("같은 group_id로 기록된 여러 삭제를 undo 한 번에 모두 복원한다", () => {
    const a = makeItem({ id: "r-0" });
    const b = makeItem({ id: "r-1" });
    const c = makeItem({ id: "r-2" });
    let items: ReviewItem[] = [a, b, c];
    let history = EMPTY_HISTORY;

    for (const item of [a, b, c]) {
      const res = recordChange(items, history, "delete", item.id, item, null, "g1");
      items = res.items;
      history = res.history;
    }
    expect(items).toEqual([]);
    expect(history.entries).toHaveLength(3);

    const undone = undo(items, history);
    // 한 번의 undo로 셋 다 복원, cursor는 0으로.
    expect(undone.items).toEqual([a, b, c]);
    expect(undone.history.cursor).toBe(0);

    // redo도 한 번에 셋 다 다시 삭제.
    const redone = redo(undone.items, undone.history);
    expect(redone.items).toEqual([]);
    expect(redone.history.cursor).toBe(3);
  });

  it("group_id가 없으면 종전대로 한 개씩 undo한다", () => {
    const a = makeItem({ id: "r-0" });
    const b = makeItem({ id: "r-1" });
    let items: ReviewItem[] = [a, b];
    let history = EMPTY_HISTORY;
    for (const item of [a, b]) {
      const res = recordChange(items, history, "delete", item.id, item, null);
      items = res.items;
      history = res.history;
    }
    const once = undo(items, history);
    expect(once.items).toEqual([b]); // 하나만 복원
    expect(once.history.cursor).toBe(1);
  });
});

describe("applySnapshot", () => {
  it("스냅샷이 null이면 해당 id 항목을 제거한다", () => {
    const items = [makeItem({ id: "r-0" }), makeItem({ id: "r-1" })];
    expect(applySnapshot(items, "r-0", null)).toEqual([makeItem({ id: "r-1" })]);
  });

  it("일치하는 id가 없으면 스냅샷을 새로 추가한다", () => {
    const items = [makeItem({ id: "r-0" })];
    const snapshot = makeItem({ id: "r-1" });
    expect(applySnapshot(items, "r-1", snapshot)).toEqual([makeItem({ id: "r-0" }), snapshot]);
  });

  it("일치하는 id가 있으면 그 항목을 스냅샷으로 교체한다", () => {
    const items = [makeItem({ id: "r-0", content: "old" })];
    const snapshot = makeItem({ id: "r-0", content: "new" });
    expect(applySnapshot(items, "r-0", snapshot)).toEqual([snapshot]);
  });
});

describe("recordChange / undo / redo (STATE-06, §5.2)", () => {
  it("add: before=null, after=item → 항목이 추가되고 cursor가 1 전진한다", () => {
    const item = makeItem({ id: "r-0" });
    const result = recordChange([], EMPTY_HISTORY, "add", "r-0", null, item);

    expect(result.items).toEqual([item]);
    expect(result.history.cursor).toBe(1);
    expect(result.history.entries).toHaveLength(1);
    expect(result.history.entries[0]).toMatchObject({
      seq: 1,
      action: "add",
      item_id: "r-0",
      before: null,
      after: item,
    });
  });

  it("undo 후 add를 되돌리면 항목이 사라지고 cursor가 0으로 돌아간다", () => {
    const item = makeItem({ id: "r-0" });
    const added = recordChange([], EMPTY_HISTORY, "add", "r-0", null, item);

    const undone = undo(added.items, added.history);

    expect(undone.items).toEqual([]);
    expect(undone.history.cursor).toBe(0);
  });

  it("undo 후 redo하면 다시 추가된 상태로 돌아온다", () => {
    const item = makeItem({ id: "r-0" });
    const added = recordChange([], EMPTY_HISTORY, "add", "r-0", null, item);
    const undone = undo(added.items, added.history);

    const redone = redo(undone.items, undone.history);

    expect(redone.items).toEqual([item]);
    expect(redone.history.cursor).toBe(1);
  });

  it("edit: before/after 스냅샷으로 왕복한다", () => {
    const before = makeItem({ id: "r-0", content: "old" });
    const after = makeItem({ id: "r-0", content: "new" });
    const edited = recordChange([before], EMPTY_HISTORY, "edit", "r-0", before, after);

    expect(edited.items).toEqual([after]);

    const undone = undo(edited.items, edited.history);
    expect(undone.items).toEqual([before]);

    const redone = redo(undone.items, undone.history);
    expect(redone.items).toEqual([after]);
  });

  it("delete: after=null → 항목이 사라지고, undo하면 되살아난다", () => {
    const item = makeItem({ id: "r-0" });
    const deleted = recordChange([item], EMPTY_HISTORY, "delete", "r-0", item, null);

    expect(deleted.items).toEqual([]);

    const undone = undo(deleted.items, deleted.history);
    expect(undone.items).toEqual([item]);
  });

  it("cursor가 0일 때 undo는 아무 것도 하지 않는다", () => {
    const items = [makeItem({ id: "r-0" })];
    const result = undo(items, EMPTY_HISTORY);
    expect(result.items).toBe(items);
    expect(result.history).toBe(EMPTY_HISTORY);
  });

  it("cursor가 entries 끝일 때 redo는 아무 것도 하지 않는다", () => {
    const item = makeItem({ id: "r-0" });
    const added = recordChange([], EMPTY_HISTORY, "add", "r-0", null, item);
    const result = redo(added.items, added.history);
    expect(result.items).toBe(added.items);
    expect(result.history).toBe(added.history);
  });

  it("undo 후 새 변경을 기록하면 이후 redo 갈래(entries)가 버려진다", () => {
    const itemA = makeItem({ id: "r-0" });
    const itemB = makeItem({ id: "r-1" });
    const step1 = recordChange([], EMPTY_HISTORY, "add", "r-0", null, itemA);
    const undone = undo(step1.items, step1.history);

    const step2 = recordChange(undone.items, undone.history, "add", "r-1", null, itemB);

    expect(step2.history.entries).toHaveLength(1);
    expect(step2.history.entries[0].item_id).toBe("r-1");
    expect(canRedo(step2.history)).toBe(false);
  });
});

describe("canUndo / canRedo", () => {
  it("cursor > 0이면 canUndo true", () => {
    expect(canUndo({ cursor: 1, entries: [] as HistoryState["entries"] })).toBe(true);
    expect(canUndo(EMPTY_HISTORY)).toBe(false);
  });

  it("cursor < entries.length이면 canRedo true", () => {
    const item = makeItem();
    const added = recordChange([], EMPTY_HISTORY, "add", "r-0", null, item);
    const undone = undo(added.items, added.history);
    expect(canRedo(undone.history)).toBe(true);
    expect(canRedo(added.history)).toBe(false);
  });
});
