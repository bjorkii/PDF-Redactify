import { describe, expect, it } from "vitest";
import { filterReviewItems, parsePageFilterInput } from "./reviewItemFilter";
import type { ReviewItem } from "../types/generated/ReviewItem";
import type { ReviewListFilter } from "../store/appStore";

function makeItem(id: string, page: number, category: string): ReviewItem {
  return {
    id,
    origin: "detected",
    page,
    bbox: { x: 0, y: 0, width: 0.1, height: 0.02 },
    original_bbox: null,
    category,
    content: "content",
    pattern_type: category,
    confidence: 0.5,
    validation: "ChecksumNotApplicable",
    modified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const NO_FILTER: ReviewListFilter = { categories: null, pages: null };

describe("filterReviewItems (LIST-08)", () => {
  const items = [
    makeItem("phone-p0", 0, "PhoneNumber"),
    makeItem("rrn-p0", 0, "RRN"),
    makeItem("passport-p1", 1, "Passport"),
    makeItem("phone-p2", 2, "PhoneNumber"),
  ];

  it("categories/pages 모두 null이면 전체를 그대로 반환한다", () => {
    expect(filterReviewItems(items, NO_FILTER)).toEqual(items);
  });

  it("categories가 있으면 그 카테고리만 남긴다", () => {
    const result = filterReviewItems(items, { categories: ["PhoneNumber"], pages: null });
    expect(result.map((i) => i.id)).toEqual(["phone-p0", "phone-p2"]);
  });

  it("categories에 여러 값을 넣으면 그 중 하나라도 일치하면 포함한다", () => {
    const result = filterReviewItems(items, { categories: ["PhoneNumber", "Passport"], pages: null });
    expect(result.map((i) => i.id)).toEqual(["phone-p0", "passport-p1", "phone-p2"]);
  });

  it("categories가 빈 배열이면 아무 것도 안 남는다(전체 표시인 null과 다름)", () => {
    const result = filterReviewItems(items, { categories: [], pages: null });
    expect(result).toEqual([]);
  });

  it("pages는 1-indexed 표시 페이지 번호로 필터링한다(item.page는 0-indexed)", () => {
    const result = filterReviewItems(items, { categories: null, pages: [1] }); // 표시 1페이지 = page 0
    expect(result.map((i) => i.id)).toEqual(["phone-p0", "rrn-p0"]);
  });

  it("categories/pages를 동시에 적용하면 둘 다 만족해야 한다", () => {
    const result = filterReviewItems(items, { categories: ["PhoneNumber"], pages: [3] }); // 표시 3페이지 = page 2
    expect(result.map((i) => i.id)).toEqual(["phone-p2"]);
  });
});

describe("parsePageFilterInput (LIST-08 위치 필터 직접 입력)", () => {
  it("콤마로 구분된 페이지 번호를 파싱한다", () => {
    expect(parsePageFilterInput("1,3,5")).toEqual([1, 3, 5]);
  });

  it("공백으로 구분돼도 파싱한다", () => {
    expect(parsePageFilterInput("1 3 5")).toEqual([1, 3, 5]);
  });

  it("콤마와 공백이 섞여도 파싱한다", () => {
    expect(parsePageFilterInput("1, 3,  5")).toEqual([1, 3, 5]);
  });

  it("숫자가 아닌 조각은 무시한다", () => {
    expect(parsePageFilterInput("1, abc, 3")).toEqual([1, 3]);
  });

  it("0 이하 값은 무시한다(페이지는 1부터)", () => {
    expect(parsePageFilterInput("0, -1, 2")).toEqual([2]);
  });

  it("빈 입력은 빈 배열을 반환한다", () => {
    expect(parsePageFilterInput("")).toEqual([]);
    expect(parsePageFilterInput("   ")).toEqual([]);
  });
});
