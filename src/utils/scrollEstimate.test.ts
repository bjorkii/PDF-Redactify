import { describe, expect, it } from "vitest";
import { estimatePageThumbSize, findMostVisiblePageIndex } from "./scrollEstimate";
import type { PageDimensionsEntry } from "../store/appStore";

function makeEntry(overrides: Partial<PageDimensionsEntry> = {}): PageDimensionsEntry {
  return {
    pageNumber: 1,
    pageWidth: 595,
    pageHeight: 842,
    textLayerStatus: "HasText",
    ...overrides,
  };
}

describe("estimatePageThumbSize (연속 스크롤 초기 크기 추정)", () => {
  it("pageDimensions가 없으면 A4 근사 기본값을 scale만큼 키워 쓴다", () => {
    const result = estimatePageThumbSize(undefined, 0, 1);
    expect(result.width).toBe(800);
    expect(result.height).toBe(Math.round(800 * Math.SQRT2));
  });

  it("해당 인덱스의 실제 pt 크기에 scale을 곱한다", () => {
    const dims = [makeEntry({ pageWidth: 595, pageHeight: 842 })];
    const result = estimatePageThumbSize(dims, 0, 1);
    expect(result.width).toBe(595);
    expect(result.height).toBe(842);
  });

  it("scale이 커지면 폭·높이 모두 그만큼 커진다(zoomScale이 실제 표시 크기를 결정)", () => {
    const dims = [makeEntry({ pageWidth: 595, pageHeight: 842 })];
    const result = estimatePageThumbSize(dims, 0, 2);
    expect(result.width).toBe(1190);
    expect(result.height).toBe(1684);
  });

  it("책등처럼 폭이 좁은 페이지는 그 페이지만의 실제 폭으로 추정한다(다른 페이지와 다름, 강제로 안 늘어남)", () => {
    const dims = [
      makeEntry({ pageWidth: 595, pageHeight: 842 }),
      makeEntry({ pageWidth: 60, pageHeight: 842 }), // 책등: 매우 좁고 긴 페이지
    ];

    const normalPage = estimatePageThumbSize(dims, 0, 1);
    const spinePage = estimatePageThumbSize(dims, 1, 1);

    expect(spinePage.width).not.toBe(normalPage.width);
    expect(spinePage.width).toBe(60);
    expect(spinePage.height).toBe(842);
  });

  it("범위를 벗어난 인덱스는 기본값으로 대체한다", () => {
    const dims = [makeEntry()];
    const result = estimatePageThumbSize(dims, 5, 1);
    expect(result.width).toBe(800);
  });

  it("폭·높이가 0 이하인 손상된 항목은 기본값으로 대체한다", () => {
    const dims = [makeEntry({ pageWidth: 0, pageHeight: 842 })];
    const result = estimatePageThumbSize(dims, 0, 1);
    expect(result.width).toBe(800);
  });

  it("scale이 0 이하면 1배로 대체한다", () => {
    const dims = [makeEntry({ pageWidth: 595, pageHeight: 842 })];
    const result = estimatePageThumbSize(dims, 0, 0);
    expect(result.width).toBe(595);
    expect(result.height).toBe(842);
  });
});

describe("findMostVisiblePageIndex (PDF-04 연속 스크롤 전체보기 기준 페이지)", () => {
  it("뷰포트와 겹치는 길이가 가장 긴 항목을 고른다", () => {
    // 뷰포트 [100, 500). 0번은 [0,150)=50 겹침, 1번은 [150,550)=350 겹침.
    const items = [
      { index: 0, start: 0, size: 150 },
      { index: 1, start: 150, size: 400 },
    ];
    expect(findMostVisiblePageIndex(items, 100, 400)).toBe(1);
  });

  it("맨 위에 살짝만 걸친 페이지보다 대부분 보이는 다음 페이지를 우선한다", () => {
    // 뷰포트 [800, 1600). 0번은 [0,820)=20만 겹침, 1번은 [820,1620)=780 겹침.
    const items = [
      { index: 0, start: 0, size: 820 },
      { index: 1, start: 820, size: 800 },
    ];
    expect(findMostVisiblePageIndex(items, 800, 800)).toBe(1);
  });

  it("겹치는 항목이 없으면 null을 반환한다", () => {
    const items = [{ index: 0, start: 0, size: 100 }];
    expect(findMostVisiblePageIndex(items, 500, 200)).toBeNull();
  });

  it("항목이 하나도 없으면 null을 반환한다", () => {
    expect(findMostVisiblePageIndex([], 0, 500)).toBeNull();
  });
});
