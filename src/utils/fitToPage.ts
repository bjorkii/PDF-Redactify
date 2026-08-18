/**
 * pdfium은 계산된 배율로 렌더링한 뒤 최종 비트맵 픽셀 크기를 반올림한다
 * (src-tauri/src/pdfium.rs render_page — PdfRenderConfig::scale_page_by_factor
 * 내부에서 반올림). 배율을 뷰포트 크기에 "정확히" 맞추면, 이 반올림 때문에
 * 실제 렌더 결과가 이상적인 값보다 최대 1px가량 더 커질 수 있어 뷰어
 * 영역을 살짝 넘치는 것으로 보였다(사용자 재현: "약간 뷰어영역 밖 내용이
 * 있음"). 뷰포트 양쪽에서 이 여유만큼 미리 빼 절대 넘치지 않게 한다.
 */
const FIT_TO_PAGE_SAFETY_MARGIN_PX = 2;

/**
 * PDF-04(§6.1): 전체보기(fit-to-page) 배율 계산 — 페이지(pt 단위)가 주어진
 * 뷰포트(px) 안에 가로/세로 모두 넘치지 않고 들어가도록, 두 축 중 더
 * 제약이 큰 쪽에 맞춘다. render_page의 scale(포인트→픽셀 배율)로 그대로 쓴다.
 */
export function computeFitToPageScale(
  pageWidthPt: number,
  pageHeightPt: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): number {
  if (pageWidthPt <= 0 || pageHeightPt <= 0 || viewportWidthPx <= 0 || viewportHeightPx <= 0) return 1;
  const safeWidthPx = Math.max(1, viewportWidthPx - FIT_TO_PAGE_SAFETY_MARGIN_PX);
  const safeHeightPx = Math.max(1, viewportHeightPx - FIT_TO_PAGE_SAFETY_MARGIN_PX);
  return Math.min(safeWidthPx / pageWidthPt, safeHeightPx / pageHeightPt);
}
