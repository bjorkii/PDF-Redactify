// SPEC §4.2: bbox는 페이지 상대좌표(0~1), 좌상단 원점으로 저장한다.
// 뷰어에 렌더된 비트맵(픽셀) 위에 bbox를 표시·편집하려면 상대좌표 ↔ 픽셀좌표를
// 왕복 변환해야 한다(둘 다 좌상단 원점이므로 스케일링만 필요).

export interface RelativeBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelSize {
  width: number;
  height: number;
}

export function relativeToPixel(bbox: RelativeBBox, pageSize: PixelSize): PixelBBox {
  return {
    x: bbox.x * pageSize.width,
    y: bbox.y * pageSize.height,
    width: bbox.width * pageSize.width,
    height: bbox.height * pageSize.height,
  };
}

export function pixelToRelative(bbox: PixelBBox, pageSize: PixelSize): RelativeBBox {
  return {
    x: bbox.x / pageSize.width,
    y: bbox.y / pageSize.height,
    width: bbox.width / pageSize.width,
    height: bbox.height / pageSize.height,
  };
}
