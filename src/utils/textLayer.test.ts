import { describe, expect, it } from "vitest";
import { hasAnyText } from "./textLayer";
import type { PdfDocumentInfo } from "../store/appStore";

function docWith(statuses: Array<"HasText" | "NoText">): PdfDocumentInfo {
  return {
    path: "/a/b.pdf",
    filename: "b.pdf",
    pageCount: statuses.length,
    pageDimensions: statuses.map((textLayerStatus, i) => ({
      pageNumber: i + 1,
      pageWidth: 612,
      pageHeight: 792,
      textLayerStatus,
    })),
    textFingerprint: "sha256:test",
  };
}

describe("hasAnyText (DET-06, §6.3.4)", () => {
  it("한 페이지라도 HasText면 true", () => {
    expect(hasAnyText(docWith(["NoText", "HasText", "NoText"]))).toBe(true);
  });

  it("모든 페이지가 NoText면 false(스캔본)", () => {
    expect(hasAnyText(docWith(["NoText", "NoText"]))).toBe(false);
  });

  it("페이지가 없으면 false", () => {
    expect(hasAnyText(docWith([]))).toBe(false);
  });
});
