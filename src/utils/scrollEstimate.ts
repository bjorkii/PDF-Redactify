import type { PageDimensionsEntry } from "../store/appStore";

/** pageDimensions를 아직 모를 때만 쓰는 대체 기준 폭(px, scale=1 기준). */
const DEFAULT_REFERENCE_WIDTH_PX = 800;
const DEFAULT_ASPECT_RATIO = Math.SQRT2; // pageDimensions를 아직 모를 때 쓰는 A4 근사(세로/가로).

export interface PageThumbSize {
  width: number;
  height: number;
}

/**
 * PDF-05(§6.1) 연속 스크롤: 가상화 목록의 초기 크기 추정치이자, 페이지가
 * 로드되기 전 자리(placeholder) 크기이기도 하다. 페이지마다 실제 pt
 * 크기(§4.2, pageDimensions)에 zoomScale을 곱해 계산한다 — PaginatedView와
 * 동일하게 "포인트→픽셀 배율"이 유일한 크기 결정 권한을 갖는다. 이렇게
 * 폭도 페이지별로 실제 비율을 따르게 하면: (1) 책등처럼 폭이 좁은 페이지가
 * 다른 페이지와 같은 폭으로 강제로 늘어나지 않고, (2) zoomScale이 실제
 * 표시 크기에 반영된다(예전엔 CSS가 폭을 90%/900px로 고정해놔서 zoomScale이
 * 비트맵 해상도만 바꾸고 화면상 크기는 전혀 안 바뀌었다).
 */
export interface ScrollVirtualItemLike {
  index: number;
  /** 스크롤 축 기준 시작 위치(px, 스크롤 컨테이너 콘텐츠 좌표계). */
  start: number;
  /** 스크롤 축 기준 크기(px). */
  size: number;
}

/**
 * PDF-04: 연속 스크롤 모드에서 "전체보기"를 누르면, 현재 뷰포트(스크롤
 * 위치 기준)에 가장 넓게 걸쳐 보이는 페이지를 기준으로 배율을 맞춘다
 * (사용자 요청 — 화면 맨 위에 살짝만 걸친 페이지 대신, 실제로 대부분
 * 보고 있는 페이지 기준이어야 함). 각 아이템과 뷰포트의 겹치는 길이가
 * 가장 큰 항목을 고른다. 겹치는 항목이 하나도 없으면(빈 목록 등) null.
 */
export function findMostVisiblePageIndex(
  items: ScrollVirtualItemLike[],
  viewportStart: number,
  viewportSize: number,
): number | null {
  const viewportEnd = viewportStart + viewportSize;
  let bestIndex: number | null = null;
  let bestOverlap = 0;

  for (const item of items) {
    const itemEnd = item.start + item.size;
    const overlap = Math.min(itemEnd, viewportEnd) - Math.max(item.start, viewportStart);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIndex = item.index;
    }
  }

  return bestIndex;
}

export function estimatePageThumbSize(
  pageDimensions: PageDimensionsEntry[] | undefined,
  index: number,
  scale: number,
): PageThumbSize {
  const safeScale = scale > 0 ? scale : 1;
  const entry = pageDimensions?.[index];
  if (!entry || entry.pageWidth <= 0 || entry.pageHeight <= 0) {
    const width = DEFAULT_REFERENCE_WIDTH_PX * safeScale;
    return { width: Math.round(width), height: Math.round(width * DEFAULT_ASPECT_RATIO) };
  }
  return {
    width: Math.round(entry.pageWidth * safeScale),
    height: Math.round(entry.pageHeight * safeScale),
  };
}
