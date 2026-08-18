import { describe, expect, it } from "vitest";
import { sortReviewItems, nextSortState } from "./reviewItemSort";
import type { ReviewItem } from "../types/generated/ReviewItem";

function makeItem(
  id: string,
  page: number,
  y: number,
  x: number,
  overrides: Partial<ReviewItem> = {},
): ReviewItem {
  return {
    id,
    origin: "detected",
    page,
    bbox: { x, y, width: 0.1, height: 0.02 },
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

describe("sortReviewItems (LIST-01, §5.2 기본 정렬 page→y→x)", () => {
  it("페이지 순으로 먼저 정렬한다", () => {
    const items = [makeItem("b", 2, 0, 0), makeItem("a", 0, 0.9, 0.9), makeItem("c", 1, 0, 0)];

    const sorted = sortReviewItems(items, { column: "position", direction: "asc" });

    expect(sorted.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("같은 페이지면 y 좌표(위→아래)로 정렬한다", () => {
    const items = [makeItem("bottom", 0, 0.8, 0), makeItem("top", 0, 0.1, 0)];

    const sorted = sortReviewItems(items, { column: "position", direction: "asc" });

    expect(sorted.map((i) => i.id)).toEqual(["top", "bottom"]);
  });

  it("같은 페이지·y면 x 좌표(왼쪽→오른쪽)로 정렬한다", () => {
    const items = [makeItem("right", 0, 0.5, 0.8), makeItem("left", 0, 0.5, 0.1)];

    const sorted = sortReviewItems(items, { column: "position", direction: "asc" });

    expect(sorted.map((i) => i.id)).toEqual(["left", "right"]);
  });

  it("direction이 desc면 순서를 뒤집는다", () => {
    const items = [makeItem("a", 0, 0, 0), makeItem("b", 1, 0, 0)];

    const sorted = sortReviewItems(items, { column: "position", direction: "desc" });

    expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("원본 배열을 변경하지 않는다", () => {
    const items = [makeItem("b", 1, 0, 0), makeItem("a", 0, 0, 0)];
    const original = [...items];

    sortReviewItems(items, { column: "position", direction: "asc" });

    expect(items).toEqual(original);
  });
});

describe("sortReviewItems (LIST-05, 컬럼별 정렬)", () => {
  it("category 컬럼은 한국어 표시명 기준으로 정렬한다", () => {
    const items = [
      makeItem("phone", 0, 0, 0, { category: "PhoneNumber" }), // 전화번호
      makeItem("rrn", 0, 0, 0, { category: "RRN" }), // 주민등록번호
      makeItem("account", 0, 0, 0, { category: "BankAccount" }), // 계좌번호
    ];

    const sorted = sortReviewItems(items, { column: "category", direction: "asc" });

    expect(sorted.map((i) => i.id)).toEqual(["account", "phone", "rrn"]);
  });

  it("content 컬럼은 문자열 정렬한다", () => {
    const items = [
      makeItem("b", 0, 0, 0, { content: "나" }),
      makeItem("a", 0, 0, 0, { content: "가" }),
    ];

    const sorted = sortReviewItems(items, { column: "content", direction: "asc" });

    expect(sorted.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("page 컬럼은 페이지 번호만으로 정렬한다(y/x 무시)", () => {
    const items = [makeItem("b", 1, 0, 0), makeItem("a", 0, 0.9, 0.9)];

    const sorted = sortReviewItems(items, { column: "page", direction: "asc" });

    expect(sorted.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("nextSortState (LIST-05, §6.4 헤더 클릭)", () => {
  it("다른 컬럼을 클릭하면 그 컬럼 오름차순으로 바뀐다", () => {
    const current = { column: "position", direction: "asc" as const };
    expect(nextSortState(current, "category")).toEqual({ column: "category", direction: "asc" });
  });

  it("같은 컬럼을 다시 클릭하면 오름↔내림을 토글한다", () => {
    const asc = { column: "content", direction: "asc" as const };
    expect(nextSortState(asc, "content")).toEqual({ column: "content", direction: "desc" });

    const desc = { column: "content", direction: "desc" as const };
    expect(nextSortState(desc, "content")).toEqual({ column: "content", direction: "asc" });
  });
});
