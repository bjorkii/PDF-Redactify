import type { RelativeBBox } from "../types/generated/RelativeBBox";

/**
 * EDIT-12: 클립보드에 담기는 bbox 1건 — **기하(크기·상대위치)만** 옮긴다.
 * 붙여넣기 시 구분·내용은 복사하지 않고 '내용 없는 사용자 추가' 항목으로
 * 새로 만든다(사용자 요청).
 */
export interface CopiedBBox {
  bbox: RelativeBBox;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * EDIT-12(§6.3.2 인접): 복사한 bbox들을 현재 마우스 위치에 붙여넣을 때의 새
 * 좌표를 계산한다. 붙여넣기 기준은 "그룹 좌상단이 마우스 위치(anchor)".
 *
 * - 1건: 그 bbox의 좌상단이 정확히 anchor에 오고 크기는 원본 유지.
 * - 여러 건: 서로의 상대 위치를 유지한 채 그룹의 좌상단(min x, min y)이
 *   anchor에 오도록 통째로 평행이동한다.
 *
 * 그룹 전체가 페이지(0~1) 안에 머물도록 anchor를 clamp한다 — 상대 배치는
 * 유지되므로 개별 clamp로 모양이 찌그러지지 않는다. 그룹이 페이지보다 크면
 * 좌상단을 0에 맞춘다.
 */
export function computePastedBBoxes(
  copied: CopiedBBox[],
  anchor: { x: number; y: number },
): RelativeBBox[] {
  if (copied.length === 0) return [];

  const minX = Math.min(...copied.map((c) => c.bbox.x));
  const minY = Math.min(...copied.map((c) => c.bbox.y));
  const maxX = Math.max(...copied.map((c) => c.bbox.x + c.bbox.width));
  const maxY = Math.max(...copied.map((c) => c.bbox.y + c.bbox.height));
  const groupWidth = maxX - minX;
  const groupHeight = maxY - minY;

  const anchorX = clamp(anchor.x, 0, Math.max(0, 1 - groupWidth));
  const anchorY = clamp(anchor.y, 0, Math.max(0, 1 - groupHeight));

  return copied.map((c) => ({
    x: anchorX + (c.bbox.x - minX),
    y: anchorY + (c.bbox.y - minY),
    width: c.bbox.width,
    height: c.bbox.height,
  }));
}
