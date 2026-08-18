import { describe, expect, it } from "vitest";
import { excludeDetectedOverlappingUserItems } from "./reviewItemMerge";
import type { ReviewItem } from "../types/generated/ReviewItem";

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "r-0",
    origin: "detected",
    page: 0,
    bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
    original_bbox: null,
    category: "PhoneNumber",
    content: "010-1234-5678",
    pattern_type: "PhoneNumber",
    confidence: 0.7,
    validation: "ChecksumNotApplicable",
    modified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("excludeDetectedOverlappingUserItems (DET-05 재검출 시 사용자 항목 보존)", () => {
  it("겹치는 사용자 항목이 없으면 후보를 그대로 둔다", () => {
    const candidate = makeItem({ id: "d-1" });
    const userItem = makeItem({ id: "m-1", origin: "manual", page: 1, bbox: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 } });

    expect(excludeDetectedOverlappingUserItems([candidate], [userItem])).toEqual([candidate]);
  });

  it("같은 페이지에서 bbox가 겹치는 후보는 제외한다(manual)", () => {
    const candidate = makeItem({ id: "d-1", page: 0, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 } });
    const userItem = makeItem({
      id: "m-1",
      origin: "manual",
      page: 0,
      bbox: { x: 0.15, y: 0.12, width: 0.2, height: 0.05 }, // 후보와 겹침
    });

    expect(excludeDetectedOverlappingUserItems([candidate], [userItem])).toEqual([]);
  });

  it("imported 항목도 manual과 동일하게 겹치면 제외한다", () => {
    const candidate = makeItem({ id: "d-1", page: 0, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 } });
    const userItem = makeItem({
      id: "i-1",
      origin: "imported",
      page: 0,
      bbox: { x: 0.15, y: 0.12, width: 0.2, height: 0.05 },
    });

    expect(excludeDetectedOverlappingUserItems([candidate], [userItem])).toEqual([]);
  });

  it("bbox가 겹쳐도 페이지가 다르면 제외하지 않는다", () => {
    const candidate = makeItem({ id: "d-1", page: 0, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 } });
    const userItem = makeItem({ id: "m-1", origin: "manual", page: 1, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 } });

    expect(excludeDetectedOverlappingUserItems([candidate], [userItem])).toEqual([candidate]);
  });

  it("bbox가 살짝 스치기만 해도(겹침) 제외하고, 완전히 떨어지면 제외하지 않는다", () => {
    const candidate = makeItem({ id: "d-1", page: 0, bbox: { x: 0, y: 0, width: 0.1, height: 0.1 } });
    const touching = makeItem({ id: "m-1", origin: "manual", page: 0, bbox: { x: 0.05, y: 0.05, width: 0.1, height: 0.1 } });
    const separate = makeItem({ id: "m-2", origin: "manual", page: 0, bbox: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 } });

    expect(excludeDetectedOverlappingUserItems([candidate], [touching])).toEqual([]);
    expect(excludeDetectedOverlappingUserItems([candidate], [separate])).toEqual([candidate]);
  });
});
