export interface DragPoint {
  x: number;
  y: number;
}

export interface RelativeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * DET-07: bbox 생성/이동/리사이즈가 벗어날 수 없는 한계 사각형(페이지
 * 상대좌표 0~1). 기본은 페이지 전체([0,1]×[0,1])지만, 탐지 제외영역이
 * 설정된 페이지에서는 그 제외 마진을 뺀 "허용 영역"으로 좁혀 넘긴다
 * (exclusionZone.ts의 marginsToDragBounds) — 사용자 bbox가 제외영역 안으로
 * 들어가지 못하게 한다(사용자 요청).
 */
export interface DragBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const FULL_PAGE_BOUNDS: DragBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };

function clampToBounds(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * EDIT-01(§6.3.2): 드래그 시작점과 현재점(둘 다 페이지 상대좌표 0~1, 어느
 * 방향으로 끌든 상관없음)으로부터 좌상단 원점 사각형을 만든다. 페이지 밖
 * (또는 bounds로 좁혀진 제외영역 경계) 밖으로 벗어난 좌표는 그 경계로
 * clamp한다 — 시작·끝 두 점이 모두 제외영역 안에서만 움직이면 같은
 * 경계로 clamp돼 크기가 0이 되고, isDragRectSignificant가 걸러 생성 자체가
 * 안 된다.
 */
export function computeDragRect(start: DragPoint, current: DragPoint, bounds: DragBounds = FULL_PAGE_BOUNDS): RelativeRect {
  const sx = clampToBounds(start.x, bounds.minX, bounds.maxX);
  const sy = clampToBounds(start.y, bounds.minY, bounds.maxY);
  const cx = clampToBounds(current.x, bounds.minX, bounds.maxX);
  const cy = clampToBounds(current.y, bounds.minY, bounds.maxY);

  return {
    x: Math.min(sx, cx),
    y: Math.min(sy, cy),
    width: Math.abs(cx - sx),
    height: Math.abs(cy - sy),
  };
}

/** 실수로 살짝 클릭한 것과 실제로 그리려는 드래그를 구분하는 최소 크기. */
const MIN_DRAG_SIZE = 0.01;

export function isDragRectSignificant(rect: RelativeRect): boolean {
  return rect.width >= MIN_DRAG_SIZE && rect.height >= MIN_DRAG_SIZE;
}

export function bboxEquals(a: RelativeRect, b: RelativeRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** EDIT-02: bbox의 어느 모서리를 잡고 리사이즈하는지. */
export type ResizeHandle = "nw" | "ne" | "sw" | "se";

/** EDIT-15(B-1): 그룹 8방향 리사이즈 핸들 — 4모서리 + 4변. */
export type ResizeHandle8 = ResizeHandle | "n" | "s" | "e" | "w";

/**
 * EDIT-15(B-1)/SIDE-10: 8방향 핸들로 사각형을 리사이즈한다 — 잡은 핸들이
 * 가리키는 변(모서리는 두 변)만 current를 따라가고 나머지 변은 고정. 결과는
 * bounds 안으로 clamp하고, 미는 변이 반대 변을 넘어(뒤집혀) minSize보다 작아지지
 * 않게 막는다. computeEdgeResizedBbox의 여러-변 버전이자 computeResizedBbox의
 * 변 포함 확장이다.
 */
export function computeHandleResizedRect(
  rect: RelativeRect,
  handle: ResizeHandle8,
  current: DragPoint,
  bounds: DragBounds = FULL_PAGE_BOUNDS,
  minSize = MIN_DRAG_SIZE,
): RelativeRect {
  let minX = rect.x;
  let minY = rect.y;
  let maxX = rect.x + rect.width;
  let maxY = rect.y + rect.height;

  const west = handle === "nw" || handle === "sw" || handle === "w";
  const east = handle === "ne" || handle === "se" || handle === "e";
  const north = handle === "nw" || handle === "ne" || handle === "n";
  const south = handle === "sw" || handle === "se" || handle === "s";

  if (west) minX = clampToBounds(current.x, bounds.minX, maxX - minSize);
  if (east) maxX = clampToBounds(current.x, minX + minSize, bounds.maxX);
  if (north) minY = clampToBounds(current.y, bounds.minY, maxY - minSize);
  if (south) maxY = clampToBounds(current.y, minY + minSize, bounds.maxY);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 각 핸들을 끌 때 고정된 채로 있어야 하는 반대쪽 모서리. */
function fixedOppositeCorner(rect: RelativeRect, handle: ResizeHandle): DragPoint {
  switch (handle) {
    case "nw":
      return { x: rect.x + rect.width, y: rect.y + rect.height };
    case "ne":
      return { x: rect.x, y: rect.y + rect.height };
    case "sw":
      return { x: rect.x + rect.width, y: rect.y };
    case "se":
      return { x: rect.x, y: rect.y };
  }
}

/**
 * EDIT-02(§6.3.3, §6.5): 모서리 핸들 드래그로 리사이즈. 반대쪽 모서리는
 * 고정된 채, 잡은 모서리만 현재 마우스 위치를 따라간다 — computeDragRect와
 * 수학적으로 동일해 그대로 재사용한다.
 */
export function computeResizedBbox(
  original: RelativeRect,
  handle: ResizeHandle,
  current: DragPoint,
  bounds: DragBounds = FULL_PAGE_BOUNDS,
): RelativeRect {
  return computeDragRect(fixedOppositeCorner(original, handle), current, bounds);
}

/** EDIT-17(B-6/B-7): 키보드 리사이즈가 미는 bbox의 한 변. */
export type BoxEdge = "left" | "right" | "top" | "bottom";

/**
 * B-6/B-7(EDIT-17): 한 변만 delta만큼 밀어 리사이즈한다(반대 변 고정) —
 * a+←/→ 왼쪽 변, f+←/→ 오른쪽 변, s+↑/↓ 윗변, d+↑/↓ 아랫변. delta 부호는
 * 좌표축 방향(+x=오른쪽, +y=아래). 결과는 bounds(페이지·제외영역) 안으로
 * clamp하고, 미는 변이 반대 변을 넘어(뒤집혀) 크기가 minSize보다 작아지지
 * 않도록 막는다 — EDIT-02의 모서리 리사이즈와 같은 좌상단 원점 규약을 쓴다.
 */
export function computeEdgeResizedBbox(
  rect: RelativeRect,
  edge: BoxEdge,
  delta: number,
  bounds: DragBounds = FULL_PAGE_BOUNDS,
  minSize = MIN_DRAG_SIZE,
): RelativeRect {
  let { x, y, width, height } = rect;
  switch (edge) {
    case "left": {
      const nx = clampToBounds(x + delta, bounds.minX, x + width - minSize);
      width = x + width - nx;
      x = nx;
      break;
    }
    case "right": {
      const right = clampToBounds(x + width + delta, x + minSize, bounds.maxX);
      width = right - x;
      break;
    }
    case "top": {
      const ny = clampToBounds(y + delta, bounds.minY, y + height - minSize);
      height = y + height - ny;
      y = ny;
      break;
    }
    case "bottom": {
      const bottom = clampToBounds(y + height + delta, y + minSize, bounds.maxY);
      height = bottom - y;
      break;
    }
  }
  return { x, y, width, height };
}

/**
 * EDIT-02: bbox 내부를 드래그해 위치만 옮긴다(크기는 그대로). 페이지 밖
 * (또는 bounds로 좁혀진 제외영역 경계) 밖으로 나가지 않도록 x/y를
 * [bounds.min, bounds.max-크기] 범위로 clamp한다. bbox 자체가 허용 영역보다
 * 크면(허용 영역 쪽이 좁아 완전히는 못 들어가면) 최소한 min 경계는 지킨다.
 */
export function computeMovedBbox(
  original: RelativeRect,
  start: DragPoint,
  current: DragPoint,
  bounds: DragBounds = FULL_PAGE_BOUNDS,
): RelativeRect {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const maxX = Math.max(bounds.minX, bounds.maxX - original.width);
  const maxY = Math.max(bounds.minY, bounds.maxY - original.height);

  return {
    x: Math.max(bounds.minX, Math.min(maxX, original.x + dx)),
    y: Math.max(bounds.minY, Math.min(maxY, original.y + dy)),
    width: original.width,
    height: original.height,
  };
}
