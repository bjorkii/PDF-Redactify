export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * SIDE-10: 리사이즈 방향. 수평 성분(w/e)과 수직 성분(n/s)의 조합으로
 * 4변(n/s/e/w) + 4모서리(ne/nw/se/sw)를 모두 표현한다. 각 방향은 붙잡은
 * 변/모서리를 움직이고, 그 반대편 변은 고정된다(자연스러운 리사이즈).
 */
export type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const MIN_FLOATING_WIDTH = 240;
export const MIN_FLOATING_HEIGHT = 200;

/**
 * SIDE-04(버그): 플로팅 패널을 이리저리 옮기다 **상단 헤더 행(제목·도킹/핸들
 * 아이콘)이 뷰포트 밖으로 완전히 나가면 다시 붙잡아 도킹할 수 없는 상태**가 된다.
 * 이동/리사이즈 결과를 뷰포트 안으로 clamp해, 헤더 행이 항상 보이게 한다 — 가로는
 * 패널 전체를 뷰포트 안에(너비가 더 크면 좌측 0), 세로는 top을 [0, 뷰포트높이 −
 * 헤더높이]로 제한한다(아래로는 헤더만 남고 본문이 넘쳐도 무방).
 */
export function clampToViewport(
  rect: FloatingRect,
  viewportWidth: number,
  viewportHeight: number,
  headerHeight = 36,
): FloatingRect {
  const maxX = Math.max(0, viewportWidth - rect.width);
  const maxY = Math.max(0, viewportHeight - headerHeight);
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, 0), maxX),
    y: Math.min(Math.max(rect.y, 0), maxY),
  };
}

/** SIDE-04: 플로팅 패널 제목표시줄 드래그 — 시작 시점 좌표 대비 이동량만큼 위치를 옮긴다. */
export function computeMovedRect(
  rect: FloatingRect,
  startClientX: number,
  startClientY: number,
  clientX: number,
  clientY: number,
): FloatingRect {
  return {
    ...rect,
    x: rect.x + (clientX - startClientX),
    y: rect.y + (clientY - startClientY),
  };
}

/**
 * SIDE-10: 방향별 플로팅 패널 리사이즈. 붙잡은 변/모서리를 커서 이동량만큼
 * 움직이고 반대편 변은 고정한다. 최소 크기 아래로 줄어들면 위치가 어긋나지
 * 않도록, 고정된 반대편 변을 기준으로 위치를 다시 계산한다.
 *
 * - e: 오른쪽 변 이동(x 고정), w: 왼쪽 변 이동(오른쪽 변 고정)
 * - s: 아래 변 이동(y 고정), n: 위 변 이동(아래 변 고정)
 */
export function computeDirectionalResizedRect(
  rect: FloatingRect,
  direction: ResizeDirection,
  startClientX: number,
  startClientY: number,
  clientX: number,
  clientY: number,
  minWidth: number = MIN_FLOATING_WIDTH,
  minHeight: number = MIN_FLOATING_HEIGHT,
): FloatingRect {
  const dx = clientX - startClientX;
  const dy = clientY - startClientY;

  let { x, y, width, height } = rect;

  if (direction.includes("e")) {
    width = Math.max(minWidth, rect.width + dx);
  } else if (direction.includes("w")) {
    const right = rect.x + rect.width;
    width = Math.max(minWidth, rect.width - dx);
    x = right - width;
  }

  if (direction.includes("s")) {
    height = Math.max(minHeight, rect.height + dy);
  } else if (direction.includes("n")) {
    const bottom = rect.y + rect.height;
    height = Math.max(minHeight, rect.height - dy);
    y = bottom - height;
  }

  return { x, y, width, height };
}

/**
 * SIDE-04: 우하단(se) 대각선 리사이즈 — 위치는 그대로 두고 크기만 키운다.
 * SIDE-10의 방향별 리사이즈 중 se 케이스와 동치이므로 이를 위임한다.
 */
export function computeResizedRect(
  rect: FloatingRect,
  startClientX: number,
  startClientY: number,
  clientX: number,
  clientY: number,
  minWidth: number = MIN_FLOATING_WIDTH,
  minHeight: number = MIN_FLOATING_HEIGHT,
): FloatingRect {
  return computeDirectionalResizedRect(
    rect,
    "se",
    startClientX,
    startClientY,
    clientX,
    clientY,
    minWidth,
    minHeight,
  );
}
