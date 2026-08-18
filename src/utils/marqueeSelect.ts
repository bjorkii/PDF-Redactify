import {
  computeHandleResizedRect,
  FULL_PAGE_BOUNDS,
  type DragBounds,
  type DragPoint,
  type RelativeRect,
  type ResizeHandle8,
} from "./dragRect";

interface HasBbox {
  id: string;
  bbox: RelativeRect;
}

/** 여러 bbox를 감싸는 최소 사각형(그룹 bounding box). 비면 null. */
export function groupBoundingBox(items: HasBbox[]): RelativeRect | null {
  if (items.length === 0) return null;
  const minX = Math.min(...items.map((i) => i.bbox.x));
  const minY = Math.min(...items.map((i) => i.bbox.y));
  const maxX = Math.max(...items.map((i) => i.bbox.x + i.bbox.width));
  const maxY = Math.max(...items.map((i) => i.bbox.y + i.bbox.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 화면 픽셀 사각형(클라이언트 좌표). */
export interface ClientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface PageClientRect {
  pageIndex: number;
  rect: ClientRect;
}

interface PagedBbox {
  id: string;
  page: number;
  bbox: RelativeRect;
}

/**
 * EDIT-13(스크롤 모드 alt 마퀴): 연속 스크롤은 여러 페이지가 동시에 보이고 각
 * 페이지가 자기 상대좌표(0~1)를 가지므로, 마퀴/항목을 **화면 픽셀 좌표**로 환산해
 * 판정한다. 각 페이지 래퍼의 클라이언트 사각형으로 항목 bbox를 픽셀 사각형으로
 * 바꿔, 마퀴에 **온전히 포함**되는 항목 id를 페이지 넘나들며 모은다.
 */
export function collectItemsInClientMarquee(
  marquee: ClientRect,
  pages: PageClientRect[],
  items: PagedBbox[],
): string[] {
  const result: string[] = [];
  for (const item of items) {
    const page = pages.find((p) => p.pageIndex === item.page);
    if (!page) continue;
    const w = page.rect.right - page.rect.left;
    const h = page.rect.bottom - page.rect.top;
    if (w <= 0 || h <= 0) continue;
    const left = page.rect.left + item.bbox.x * w;
    const top = page.rect.top + item.bbox.y * h;
    const right = left + item.bbox.width * w;
    const bottom = top + item.bbox.height * h;
    if (left >= marquee.left && top >= marquee.top && right <= marquee.right && bottom <= marquee.bottom) {
      result.push(item.id);
    }
  }
  return result;
}

/**
 * EDIT-13(§6.3 인접): 러버밴드(marquee) 사각형에 **온전히 포함되는**(경계
 * 걸침 제외) 항목의 id들을 반환한다. 판정은 페이지 상대좌표(0~1) 기준.
 * marquee와 item의 페이지가 같다는 전제(호출부가 같은 페이지 항목만 넘김).
 */
export function collectItemsFullyInside(marquee: RelativeRect, items: HasBbox[]): string[] {
  const right = marquee.x + marquee.width;
  const bottom = marquee.y + marquee.height;
  return items
    .filter((item) => {
      const b = item.bbox;
      return (
        b.x >= marquee.x &&
        b.y >= marquee.y &&
        b.x + b.width <= right &&
        b.y + b.height <= bottom
      );
    })
    .map((item) => item.id);
}

/**
 * EDIT-13: 그룹 이동 — 선택된 여러 bbox를 같은 변위(delta)로 함께 옮긴다.
 * 서로의 상대 배치를 유지하기 위해 개별 clamp가 아니라 **그룹 전체를 한
 * 변위로** 옮기되, 그룹 bounding box가 bounds(페이지/제외영역 허용 경계)를
 * 벗어나지 않도록 delta 자체를 clamp한다. 그룹이 허용 영역보다 크면 최소한
 * min 경계는 지킨다.
 */
export function computeGroupMovedBboxes(
  items: HasBbox[],
  start: DragPoint,
  current: DragPoint,
  bounds: DragBounds = FULL_PAGE_BOUNDS,
): Map<string, RelativeRect> {
  const result = new Map<string, RelativeRect>();
  if (items.length === 0) return result;

  const minX = Math.min(...items.map((i) => i.bbox.x));
  const minY = Math.min(...items.map((i) => i.bbox.y));
  const maxX = Math.max(...items.map((i) => i.bbox.x + i.bbox.width));
  const maxY = Math.max(...items.map((i) => i.bbox.y + i.bbox.height));

  // delta clamp 범위: 왼쪽/위로는 (bounds.min - group.min), 오른쪽/아래로는
  // (bounds.max - group.max). 그룹이 허용 영역보다 크면 min 경계를 우선.
  const dxMin = bounds.minX - minX;
  const dxMax = Math.max(dxMin, bounds.maxX - maxX);
  const dyMin = bounds.minY - minY;
  const dyMax = Math.max(dyMin, bounds.maxY - maxY);

  const dx = Math.max(dxMin, Math.min(dxMax, current.x - start.x));
  const dy = Math.max(dyMin, Math.min(dyMax, current.y - start.y));

  for (const item of items) {
    result.set(item.id, {
      x: item.bbox.x + dx,
      y: item.bbox.y + dy,
      width: item.bbox.width,
      height: item.bbox.height,
    });
  }
  return result;
}

/**
 * EDIT-15(B-1): 그룹 8방향 리사이즈 — 선택된 여러 bbox를 감싸는 그룹 bounding
 * box를 handle로 리사이즈한 뒤, 각 멤버를 그 안에서 **비율대로** 스케일한다
 * (표 과검출을 한 번에 좁히기). 각 멤버의 그룹 내 상대 위치·크기가 유지되며,
 * 그룹 bbox는 bounds(페이지/제외영역)를 벗어나지 않고 최소 크기 아래로
 * 뒤집히지 않는다. 그룹 크기가 0인 축(모든 멤버가 한 점/선)은 스케일하지 않는다.
 */
export function computeGroupResizedBboxes(
  items: HasBbox[],
  handle: ResizeHandle8,
  current: DragPoint,
  bounds: DragBounds = FULL_PAGE_BOUNDS,
): Map<string, RelativeRect> {
  const result = new Map<string, RelativeRect>();
  const old = groupBoundingBox(items);
  if (!old) return result;

  const next = computeHandleResizedRect(old, handle, current, bounds);
  const sx = old.width > 0 ? next.width / old.width : 1;
  const sy = old.height > 0 ? next.height / old.height : 1;

  for (const item of items) {
    result.set(item.id, {
      x: next.x + (item.bbox.x - old.x) * sx,
      y: next.y + (item.bbox.y - old.y) * sy,
      width: item.bbox.width * sx,
      height: item.bbox.height * sy,
    });
  }
  return result;
}
