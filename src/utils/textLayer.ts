import type { PdfDocumentInfo } from "../store/appStore";

/** DET-06(§6.3.4): 문서에 텍스트 레이어가 있는 페이지가 하나라도 있는지. */
export function hasAnyText(document: PdfDocumentInfo): boolean {
  return document.pageDimensions.some((page) => page.textLayerStatus === "HasText");
}
