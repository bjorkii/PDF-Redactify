import type { PdfDocumentInfo } from "../store/appStore";
import type { SidecarDocument } from "../types/generated/SidecarDocument";

/**
 * STATE-05(§4.4): 바이트 해시가 아니라 page_count + page_dimensions[](1차, 빠른
 * 판정) + 텍스트 레이어 해시(2차, 주석 추가에는 무반응)로 sidecar와 현재 PDF의
 * 동일성을 판정한다.
 */
export function isSameSource(document: PdfDocumentInfo, sidecar: SidecarDocument): boolean {
  if (document.pageCount !== sidecar.source.page_count) return false;
  if (document.pageDimensions.length !== sidecar.page_dimensions.length) return false;

  for (let i = 0; i < document.pageDimensions.length; i++) {
    const a = document.pageDimensions[i];
    const b = sidecar.page_dimensions[i];
    if (
      a.pageNumber !== b.page_number ||
      a.pageWidth !== b.page_width ||
      a.pageHeight !== b.page_height ||
      a.textLayerStatus !== b.text_layer_status
    ) {
      return false;
    }
  }

  return document.textFingerprint === sidecar.source.text_fingerprint;
}
