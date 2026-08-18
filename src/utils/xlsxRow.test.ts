import { describe, expect, it } from "vitest";
import { buildXlsxRow, parseBboxString, buildReviewItemFromXlsxRow } from "./xlsxRow";
import type { ReviewItem } from "../types/generated/ReviewItem";
import type { XlsxRow } from "../types/generated/XlsxRow";

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "r-0",
    origin: "detected",
    page: 5,
    bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
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

describe("buildXlsxRow (IO-01, §5.4)", () => {
  it("category를 한국어 표시명으로, page를 1-indexed로 바꾼다", () => {
    const row = buildXlsxRow(makeItem(), "test.pdf");

    expect(row.filename).toBe("test.pdf");
    expect(row.category).toBe("전화번호");
    expect(row.content).toBe("010-1234-5678");
    expect(row.page).toBe(6);
    expect(row.bbox).toBe("0.1,0.2,0.3,0.05");
    expect(row.updated_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("부동소수점 오차를 반올림해서 깔끔한 bbox 문자열을 만든다", () => {
    const row = buildXlsxRow(
      makeItem({ bbox: { x: 0.1 + 0.2 - 0.3, y: 0.30000000000000004, width: 0.1, height: 0.1 } }),
      "test.pdf",
    );
    expect(row.bbox).toBe("0,0.3,0.1,0.1");
  });
});

describe("parseBboxString (IO-02, §5.4)", () => {
  it("정상 형식을 파싱한다", () => {
    expect(parseBboxString("0.1,0.2,0.3,0.05")).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.05 });
  });

  it("공백이 섞여 있어도 파싱한다", () => {
    expect(parseBboxString("0.1, 0.2, 0.3, 0.05")).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.05 });
  });

  it("형식이 어긋나면 null", () => {
    expect(parseBboxString("0.1,0.2,0.3")).toBeNull();
    expect(parseBboxString("abc,0.2,0.3,0.05")).toBeNull();
    expect(parseBboxString("")).toBeNull();
  });
});

function makeXlsxRow(overrides: Partial<XlsxRow> = {}): XlsxRow {
  return {
    filename: "test.pdf",
    category: "전화번호",
    content: "010-1234-5678",
    page: 6,
    bbox: "0.1,0.2,0.3,0.05",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildReviewItemFromXlsxRow (IO-02, §5.4)", () => {
  it("origin=imported, page를 0-indexed로 되돌린다", () => {
    const item = buildReviewItemFromXlsxRow(makeXlsxRow(), "i-1");

    expect(item.id).toBe("i-1");
    expect(item.origin).toBe("imported");
    expect(item.page).toBe(5);
    expect(item.bbox).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.05 });
    expect(item.category).toBe("PhoneNumber");
    expect(item.content).toBe("010-1234-5678");
    expect(item.pattern_type).toBeNull();
    expect(item.confidence).toBeNull();
    expect(item.validation).toBe("NotValidated");
    expect(item.modified).toBe(false);
  });

  it("bbox 파싱에 실패하면 0-크기 bbox로 대체한다(IO-03이 재탐색)", () => {
    const item = buildReviewItemFromXlsxRow(makeXlsxRow({ bbox: "broken" }), "i-1");
    expect(item.bbox).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("buildXlsxRow와 왕복한다(카테고리/페이지)", () => {
    const original = { category: "RRN", page: 3 } as const;
    const row = makeXlsxRow({ category: "주민등록번호", page: original.page + 1 });
    const item = buildReviewItemFromXlsxRow(row, "i-1");

    expect(item.category).toBe(original.category);
    expect(item.page).toBe(original.page);
  });
});
