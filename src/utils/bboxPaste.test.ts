import { describe, expect, it } from "vitest";
import { computePastedBBoxes, type CopiedBBox } from "./bboxPaste";

function copied(bbox: { x: number; y: number; width: number; height: number }): CopiedBBox {
  return { bbox };
}

describe("computePastedBBoxes (EDIT-12 붙여넣기 좌표)", () => {
  it("빈 클립보드는 빈 배열", () => {
    expect(computePastedBBoxes([], { x: 0.5, y: 0.5 })).toEqual([]);
  });

  it("1건: 좌상단이 anchor에 오고 크기는 원본 유지", () => {
    const result = computePastedBBoxes([copied({ x: 0.1, y: 0.2, width: 0.2, height: 0.05 })], {
      x: 0.5,
      y: 0.6,
    });
    expect(result).toEqual([{ x: 0.5, y: 0.6, width: 0.2, height: 0.05 }]);
  });

  it("여러 건: 상대 위치를 유지한 채 그룹 좌상단이 anchor에 온다", () => {
    const items = [
      copied({ x: 0.2, y: 0.2, width: 0.1, height: 0.05 }),
      copied({ x: 0.35, y: 0.3, width: 0.1, height: 0.05 }),
    ];
    // 그룹 min = (0.2, 0.2). anchor=(0.5,0.5) → shift (+0.3, +0.3)
    const result = computePastedBBoxes(items, { x: 0.5, y: 0.5 });
    expect(result[0]).toEqual({ x: 0.5, y: 0.5, width: 0.1, height: 0.05 });
    expect(result[1]).toBeDefined();
    expect(result[1].x).toBeCloseTo(0.65, 10);
    expect(result[1].y).toBeCloseTo(0.6, 10);
  });

  it("페이지 오른쪽/아래로 넘치면 anchor를 clamp해 안에 머문다", () => {
    const result = computePastedBBoxes([copied({ x: 0, y: 0, width: 0.3, height: 0.2 })], {
      x: 0.9,
      y: 0.95,
    });
    // 1-width=0.7, 1-height=0.8 로 clamp
    expect(result[0].x).toBeCloseTo(0.7, 10);
    expect(result[0].y).toBeCloseTo(0.8, 10);
    expect(result[0].x + result[0].width).toBeLessThanOrEqual(1 + 1e-9);
    expect(result[0].y + result[0].height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("음수 anchor는 0으로 clamp", () => {
    const result = computePastedBBoxes([copied({ x: 0.4, y: 0.4, width: 0.1, height: 0.1 })], {
      x: -0.5,
      y: -0.5,
    });
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
  });

  it("그룹이 페이지보다 크면 좌상단을 0에 맞춘다", () => {
    const result = computePastedBBoxes([copied({ x: 0, y: 0, width: 1.5, height: 0.1 })], {
      x: 0.5,
      y: 0.2,
    });
    expect(result[0].x).toBe(0);
  });
});
