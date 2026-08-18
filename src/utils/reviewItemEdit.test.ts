import { describe, expect, it } from "vitest";
import { buildEditedReviewItem } from "./reviewItemEdit";
import type { ReviewItem } from "../types/generated/ReviewItem";

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "r-0",
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
    ...overrides,
  };
}

const NOW = "2026-02-02T00:00:00.000Z";

describe("buildEditedReviewItem (LIST-03, §6.3.3)", () => {
  it("category를 바꾸면 modified=true, updated_at 갱신된 스냅샷을 만든다", () => {
    const item = makeItem();
    const result = buildEditedReviewItem(item, "category", "RRN", NOW);

    expect(result).toEqual({ ...item, category: "RRN", modified: true, updated_at: NOW });
  });

  it("content를 바꾸면 앞뒤 공백을 정리한다", () => {
    const item = makeItem();
    const result = buildEditedReviewItem(item, "content", "  010-9999-8888  ", NOW);

    expect(result?.content).toBe("010-9999-8888");
    expect(result?.modified).toBe(true);
  });

  it("값이 그대로면 null(기록할 변경 없음)", () => {
    const item = makeItem();
    expect(buildEditedReviewItem(item, "category", "PhoneNumber", NOW)).toBeNull();
  });

  it("content를 공백만/빈 값으로 편집하면 빈 문자열로 지운다(사용자 요청)", () => {
    // 내용 있던 항목의 내용을 모두 지우고 커밋하면 실제로 비워져야 한다.
    const item = makeItem({ content: "010-1234-5678" });
    const cleared = buildEditedReviewItem(item, "content", "   ", NOW);
    expect(cleared?.content).toBe("");
    expect(cleared?.modified).toBe(true);
  });

  it("이미 빈 content를 다시 빈 값으로 두면 null(변경 없음)", () => {
    const item = makeItem({ content: "" });
    expect(buildEditedReviewItem(item, "content", "   ", NOW)).toBeNull();
  });

  it("category는 빈 값으로 바꿀 수 없다(드롭박스, null)", () => {
    const item = makeItem();
    expect(buildEditedReviewItem(item, "category", "  ", NOW)).toBeNull();
  });

  it("pattern_type 등 다른 필드는 그대로 보존한다", () => {
    const item = makeItem({ pattern_type: "PhoneNumber", confidence: 0.9 });
    const result = buildEditedReviewItem(item, "category", "FaxNumber", NOW);

    expect(result?.pattern_type).toBe("PhoneNumber");
    expect(result?.confidence).toBe(0.9);
  });
});
