import { describe, expect, it } from "vitest";
import { computeNextSelectedItem } from "./reviewItemNav";
import type { ReviewItem } from "../types/generated/ReviewItem";

function makeItem(id: string): ReviewItem {
  return {
    id,
    origin: "detected",
    page: 0,
    bbox: { x: 0, y: 0, width: 0.1, height: 0.02 },
    original_bbox: null,
    category: "PhoneNumber",
    content: "010-1234-5678",
    pattern_type: "PhoneNumber",
    confidence: 0.5,
    validation: "ChecksumNotApplicable",
    modified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeNextSelectedItem (LIST-06, §8.3 ↑/↓)", () => {
  const items = [makeItem("a"), makeItem("b"), makeItem("c")];

  it("선택된 항목이 없으면 방향과 무관하게 첫 항목을 고른다", () => {
    expect(computeNextSelectedItem(items, null, 1)?.id).toBe("a");
    expect(computeNextSelectedItem(items, null, -1)?.id).toBe("a");
  });

  it("다음(아래) 방향으로 이동한다", () => {
    expect(computeNextSelectedItem(items, "a", 1)?.id).toBe("b");
  });

  it("이전(위) 방향으로 이동한다", () => {
    expect(computeNextSelectedItem(items, "b", -1)?.id).toBe("a");
  });

  it("마지막 항목에서 더 아래로 가면 그대로 머문다(순환하지 않음)", () => {
    expect(computeNextSelectedItem(items, "c", 1)?.id).toBe("c");
  });

  it("첫 항목에서 더 위로 가면 그대로 머문다", () => {
    expect(computeNextSelectedItem(items, "a", -1)?.id).toBe("a");
  });

  it("목록이 비어 있으면 null", () => {
    expect(computeNextSelectedItem([], null, 1)).toBeNull();
  });
});
