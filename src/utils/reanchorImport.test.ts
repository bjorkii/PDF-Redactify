import { describe, expect, it } from "vitest";
import { applyReanchorResults } from "./reanchorImport";
import type { ReviewItem } from "../types/generated/ReviewItem";

function makeItem(id: string, bbox: ReviewItem["bbox"]): ReviewItem {
  return {
    id,
    origin: "imported",
    page: 0,
    bbox,
    original_bbox: null,
    category: "Custom",
    content: "내용",
    pattern_type: null,
    confidence: null,
    validation: "NotValidated",
    modified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("applyReanchorResults (IO-03, §5.4)", () => {
  it("찾은 항목은 재탐색된 bbox로 갈아끼운다", () => {
    const items = [makeItem("a", { x: 0, y: 0, width: 0, height: 0 })];
    const found = { x: 0.1, y: 0.2, width: 0.3, height: 0.05 };

    const result = applyReanchorResults(items, [found]);

    expect(result.items[0].bbox).toEqual(found);
    expect(result.positionUncertainItemIds.size).toBe(0);
  });

  it("못 찾은 항목은 기존 bbox를 유지하고 '위치확인 필요'로 표시한다", () => {
    const fallbackBbox = { x: 0.5, y: 0.5, width: 0.1, height: 0.1 };
    const items = [makeItem("a", fallbackBbox)];

    const result = applyReanchorResults(items, [null]);

    expect(result.items[0].bbox).toEqual(fallbackBbox);
    expect(result.positionUncertainItemIds.has("a")).toBe(true);
  });

  it("여러 항목을 인덱스로 정확히 대응시킨다", () => {
    const items = [
      makeItem("a", { x: 0, y: 0, width: 0, height: 0 }),
      makeItem("b", { x: 0, y: 0, width: 0, height: 0 }),
    ];
    const foundForB = { x: 0.9, y: 0.9, width: 0.05, height: 0.05 };

    const result = applyReanchorResults(items, [null, foundForB]);

    expect(result.positionUncertainItemIds.has("a")).toBe(true);
    expect(result.positionUncertainItemIds.has("b")).toBe(false);
    expect(result.items[1].bbox).toEqual(foundForB);
  });
});
