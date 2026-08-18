import { describe, expect, it } from "vitest";
import { pickPdfPath } from "./pdfDropPaths";

describe("pickPdfPath (드래그 앤 드롭 열기)", () => {
  it("PDF 확장자를 가진 첫 경로를 고른다", () => {
    expect(pickPdfPath(["/a/readme.txt", "/a/doc.pdf", "/a/other.pdf"])).toBe("/a/doc.pdf");
  });

  it("확장자 대소문자를 가리지 않는다", () => {
    expect(pickPdfPath(["/a/DOC.PDF"])).toBe("/a/DOC.PDF");
  });

  it("PDF가 없으면 null을 반환한다", () => {
    expect(pickPdfPath(["/a/readme.txt", "/a/image.png"])).toBeNull();
  });

  it("빈 배열이면 null을 반환한다", () => {
    expect(pickPdfPath([])).toBeNull();
  });
});
