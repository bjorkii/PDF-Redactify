/**
 * BM-02: 선택된 항목이 스크롤 컨테이너 밖에 있을 때만 세로 중앙으로 슬라이딩한다
 * (§6.2 "화면밖이면 사이드바 수직 중심으로 슬라이딩"). 이미 보이는 항목은
 * 스크롤을 흔들지 않도록 null을 반환한다.
 */
export function computeAutoScrollTop(
  itemOffsetTop: number,
  itemHeight: number,
  containerScrollTop: number,
  containerClientHeight: number,
): number | null {
  const itemBottom = itemOffsetTop + itemHeight;
  const visibleTop = containerScrollTop;
  const visibleBottom = containerScrollTop + containerClientHeight;
  const isFullyVisible = itemOffsetTop >= visibleTop && itemBottom <= visibleBottom;

  if (isFullyVisible) return null;

  const centered = itemOffsetTop + itemHeight / 2 - containerClientHeight / 2;
  return Math.max(0, centered);
}
