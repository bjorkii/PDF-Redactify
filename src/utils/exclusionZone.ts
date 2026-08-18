import type { PageExclusionMargins } from "../store/appStore";
import { FULL_PAGE_BOUNDS, type DragBounds } from "./dragRect";

/** DET-07: 반대편 마진과 역전(합이 1을 넘어 서로 겹쳐 뒤집힘)되지 않도록
 * 최소한으로 남겨두는 여백. 이것만 지키면 각 마진은 사실상 제한 없이(최대
 * 거의 100%까지) 조절할 수 있다(사용자 요청 — 기존 45% 고정 상한 제거). */
const MIN_GAP = 0.02;

/**
 * 마진 값이 유효 범위(0~1)를 벗어났거나, 반대편 마진과 역전돼 있으면
 * (top+bottom 또는 left+right가 1을 넘으면) 양쪽에서 절반씩 줄여 보정한다.
 * 정상 범위 안의 값은 그대로 둔다 — 더는 축마다 고정 상한을 두지 않는다.
 */
export function clampMargins(margins: PageExclusionMargins): PageExclusionMargins {
  let top = Math.max(0, Math.min(1, margins.top));
  let bottom = Math.max(0, Math.min(1, margins.bottom));
  let left = Math.max(0, Math.min(1, margins.left));
  let right = Math.max(0, Math.min(1, margins.right));

  const verticalExcess = top + bottom - (1 - MIN_GAP);
  if (verticalExcess > 0) {
    top -= verticalExcess / 2;
    bottom -= verticalExcess / 2;
  }

  const horizontalExcess = left + right - (1 - MIN_GAP);
  if (horizontalExcess > 0) {
    left -= horizontalExcess / 2;
    right -= horizontalExcess / 2;
  }

  return {
    top: Math.max(0, top),
    bottom: Math.max(0, bottom),
    left: Math.max(0, left),
    right: Math.max(0, right),
  };
}

export type ExclusionEdge = "top" | "bottom" | "left" | "right";

/**
 * 가이드 바 하나를 드래그하는 동안, 현재 커서의 페이지 상대좌표(0~1, 그
 * 가이드가 속한 축 기준)로부터 새 마진 값을 계산한다. 나머지 3개 마진은
 * 그대로 두고, 드래그 중인 축이 반대편 마진을 넘어 역전되지 않도록만
 * 제한한다(그 외에는 사실상 자유롭게 조절 가능 — 사용자 요청).
 */
export function computeDraggedMargins(
  current: PageExclusionMargins,
  edge: ExclusionEdge,
  pointerRelative: number,
): PageExclusionMargins {
  const clamped01 = Math.max(0, Math.min(1, pointerRelative));
  const next = { ...current };

  switch (edge) {
    case "top":
      next.top = Math.min(clamped01, 1 - current.bottom - MIN_GAP);
      break;
    case "bottom":
      next.bottom = Math.min(1 - clamped01, 1 - current.top - MIN_GAP);
      break;
    case "left":
      next.left = Math.min(clamped01, 1 - current.right - MIN_GAP);
      break;
    case "right":
      next.right = Math.min(1 - clamped01, 1 - current.left - MIN_GAP);
      break;
  }

  return clampMargins(next);
}

export const EMPTY_MARGINS: PageExclusionMargins = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * DET-07: 제외영역 마진 → bbox 생성/이동/리사이즈가 못 벗어나는 "허용
 * 영역" 사각형(dragRect.ts의 DragBounds) 변환. 사용자 bbox가 제외영역
 * 안으로는 들어가지 못하게 한다(사용자 요청 — 새로 그리기·이동·리사이즈
 * 모두 이 bounds를 페이지 경계 대신 쓴다). 마진이 전부 0이면(제외영역
 * 없음) 페이지 전체(FULL_PAGE_BOUNDS)와 동일하다.
 */
export function marginsToDragBounds(margins: PageExclusionMargins): DragBounds {
  return {
    minX: margins.left,
    maxX: Math.max(margins.left, 1 - margins.right),
    minY: margins.top,
    maxY: Math.max(margins.top, 1 - margins.bottom),
  };
}

export { FULL_PAGE_BOUNDS };

/**
 * EDIT-14: bbox가 제외영역 경계에 닿았는지. bbox는 제외영역 안으로 못 들어가게
 * 경계에 클램프되므로, 어느 변이든 그쪽 마진(>0)의 경계에 접하면 "닿음"으로 본다.
 * 드래그 중 이게 true면 제외영역 바를 잠깐 보여줘 한계를 시각적으로 알린다.
 */
export function bboxTouchesExclusion(
  bbox: { x: number; y: number; width: number; height: number },
  margins: PageExclusionMargins,
): boolean {
  const EPS = 0.0008;
  const touchesTop = margins.top > 0 && bbox.y <= margins.top + EPS;
  const touchesBottom = margins.bottom > 0 && bbox.y + bbox.height >= 1 - margins.bottom - EPS;
  const touchesLeft = margins.left > 0 && bbox.x <= margins.left + EPS;
  const touchesRight = margins.right > 0 && bbox.x + bbox.width >= 1 - margins.right - EPS;
  return touchesTop || touchesBottom || touchesLeft || touchesRight;
}
