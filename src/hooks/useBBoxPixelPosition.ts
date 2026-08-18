import { useAppStore } from "../store/appStore";
import { relativeToPixel, type PixelBBox, type RelativeBBox } from "../utils/coordinates";

/**
 * PDF-04: bbox 좌표 재계산 훅. 줌/재렌더로 renderedPage의 픽셀 크기가 바뀔 때마다
 * 상대좌표(§4.2) 기준 bbox를 현재 비트맵에 맞는 픽셀좌표로 다시 계산한다.
 * 아직 렌더된 페이지가 없으면 null(오버레이를 그리지 않음).
 */
export function computeBBoxPixelPosition(
  bbox: RelativeBBox,
  pageSize: { width: number; height: number } | null,
): PixelBBox | null {
  if (!pageSize) return null;
  return relativeToPixel(bbox, pageSize);
}

export function useBBoxPixelPosition(bbox: RelativeBBox): PixelBBox | null {
  const renderedPage = useAppStore((s) => s.renderedPage);
  return computeBBoxPixelPosition(
    bbox,
    renderedPage ? { width: renderedPage.width, height: renderedPage.height } : null,
  );
}
