import { describe, expect, it } from "vitest";
import type { ReviewItem } from "../types/generated/ReviewItem";
import {
  computeSelectionAfterDelete,
  extendSelection,
  rangeIds,
  toggleId,
} from "./reviewItemSelection";

function item(id: string): ReviewItem {
  return {
    id,
    origin: "detected",
    page: 0,
    bbox: { x: 0, y: 0, width: 0.1, height: 0.1 },
    original_bbox: null,
    category: "RRN",
    content: id,
    pattern_type: "RRN",
    confidence: null,
    validation: "NotValidated",
    modified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const items = ["a", "b", "c", "d", "e"].map(item);

describe("rangeIds", () => {
  it("selects the inclusive range between anchor and target regardless of direction", () => {
    expect(rangeIds(items, "b", "d")).toEqual(new Set(["b", "c", "d"]));
    expect(rangeIds(items, "d", "b")).toEqual(new Set(["b", "c", "d"]));
  });

  it("falls back to the target alone when there is no anchor", () => {
    expect(rangeIds(items, null, "c")).toEqual(new Set(["c"]));
  });

  it("returns empty when the target is missing", () => {
    expect(rangeIds(items, "a", "zzz")).toEqual(new Set());
  });
});

describe("toggleId", () => {
  it("adds an absent id and removes a present one, returning a new set", () => {
    const base = new Set(["a"]);
    expect(toggleId(base, "b")).toEqual(new Set(["a", "b"]));
    expect(toggleId(base, "a")).toEqual(new Set());
    expect(base).toEqual(new Set(["a"])); // 원본 불변
  });
});

describe("extendSelection", () => {
  it("grows the range from the anchor as the active item moves", () => {
    const result = extendSelection(items, "b", "b", 1);
    expect(result).toEqual({ activeId: "c", anchorId: "b", ids: new Set(["b", "c"]) });
  });

  it("shrinks back toward the anchor when reversing direction", () => {
    const result = extendSelection(items, "b", "d", -1);
    expect(result).toEqual({ activeId: "c", anchorId: "b", ids: new Set(["b", "c"]) });
  });

  it("adopts the active item as anchor when none is set", () => {
    const result = extendSelection(items, null, "c", 1);
    expect(result).toEqual({ activeId: "d", anchorId: "c", ids: new Set(["c", "d"]) });
  });

  it("does not move past the boundary", () => {
    const result = extendSelection(items, "e", "e", 1);
    expect(result).toEqual({ activeId: "e", anchorId: "e", ids: new Set(["e"]) });
  });
});

describe("computeSelectionAfterDelete", () => {
  it("selects the item right after the bottom-most deleted one", () => {
    expect(computeSelectionAfterDelete(items, new Set(["b", "c"]))).toBe("d");
  });

  it("selects the nearest survivor above when nothing remains below", () => {
    expect(computeSelectionAfterDelete(items, new Set(["d", "e"]))).toBe("c");
  });

  it("uses the bottom-most (not top-most) deleted item as the reference", () => {
    // 불연속 선택 a,d 삭제 → 가장 아래(d) 기준 다음 = e.
    expect(computeSelectionAfterDelete(items, new Set(["a", "d"]))).toBe("e");
  });

  it("returns null when everything is deleted", () => {
    expect(computeSelectionAfterDelete(items, new Set(["a", "b", "c", "d", "e"]))).toBeNull();
  });

  it("returns null when nothing was deleted", () => {
    expect(computeSelectionAfterDelete(items, new Set())).toBeNull();
  });
});
