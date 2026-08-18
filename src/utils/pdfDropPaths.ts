/**
 * UX 편의(드래그 앤 드롭 열기): 드롭된 여러 경로 중 처음 등장하는 PDF 하나를
 * 고른다. 확장자 비교는 대소문자를 가리지 않는다(.PDF도 인정). PDF가 하나도
 * 없으면 null — 호출부가 "PDF 파일만 열 수 있습니다" 같은 안내를 띄운다.
 */
export function pickPdfPath(paths: string[]): string | null {
  return paths.find((path) => path.toLowerCase().endsWith(".pdf")) ?? null;
}
