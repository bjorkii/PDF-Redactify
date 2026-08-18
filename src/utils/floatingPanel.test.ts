import { describe, expect, it } from "vitest";
import {
  clampToViewport,
  computeDirectionalResizedRect,
  computeMovedRect,
  computeResizedRect,
} from "./floatingPanel";

const RECT = { x: 100, y: 100, width: 300, height: 400 };

describe("computeMovedRect (SIDE-04 플로팅 이동)", () => {
  it("커서 이동량만큼 위치를 옮기고 크기는 그대로 둔다", () => {
    const result = computeMovedRect(RECT, 50, 50, 80, 70);
    expect(result).toEqual({ x: 130, y: 120, width: 300, height: 400 });
  });

  it("이동량이 0이면 변화가 없다", () => {
    expect(computeMovedRect(RECT, 50, 50, 50, 50)).toEqual(RECT);
  });
});

describe("computeResizedRect (SIDE-04 플로팅 리사이즈)", () => {
  it("커서 이동량만큼 크기를 바꾸고 위치는 그대로 둔다", () => {
    const result = computeResizedRect(RECT, 50, 50, 100, 90);
    expect(result).toEqual({ x: 100, y: 100, width: 350, height: 440 });
  });

  it("최소 크기 아래로는 줄어들지 않는다", () => {
    const result = computeResizedRect(RECT, 50, 50, -1000, -1000, 240, 200);
    expect(result.width).toBe(240);
    expect(result.height).toBe(200);
  });
});

describe("computeDirectionalResizedRect (SIDE-10 방향별 리사이즈)", () => {
  it("e: 오른쪽 변만 이동하고 위치는 그대로", () => {
    expect(computeDirectionalResizedRect(RECT, "e", 50, 50, 90, 90)).toEqual({
      x: 100,
      y: 100,
      width: 340,
      height: 400,
    });
  });

  it("s: 아래 변만 이동하고 위치는 그대로", () => {
    expect(computeDirectionalResizedRect(RECT, "s", 50, 50, 90, 90)).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 440,
    });
  });

  it("w: 왼쪽 변을 오른쪽으로 밀면 x가 이동하고 오른쪽 변은 고정된다", () => {
    // 오른쪽 변 = x+width = 400 고정. dx=+30 → width 270, x 130
    const result = computeDirectionalResizedRect(RECT, "w", 50, 50, 80, 50);
    expect(result).toEqual({ x: 130, y: 100, width: 270, height: 400 });
    expect(result.x + result.width).toBe(400);
  });

  it("n: 위 변을 아래로 밀면 y가 이동하고 아래 변은 고정된다", () => {
    // 아래 변 = y+height = 500 고정. dy=+40 → height 360, y 140
    const result = computeDirectionalResizedRect(RECT, "n", 50, 50, 50, 90);
    expect(result).toEqual({ x: 100, y: 140, width: 300, height: 360 });
    expect(result.y + result.height).toBe(500);
  });

  it("nw: 좌상단 모서리는 x/y 둘 다 이동하고 우하단은 고정된다", () => {
    const result = computeDirectionalResizedRect(RECT, "nw", 50, 50, 80, 90);
    expect(result).toEqual({ x: 130, y: 140, width: 270, height: 360 });
    expect(result.x + result.width).toBe(400);
    expect(result.y + result.height).toBe(500);
  });

  it("w: 최소 폭에 걸리면 오른쪽 변 기준으로 x가 고정된다", () => {
    // 오른쪽 변 400 고정, 최소폭 240 → x = 400-240 = 160
    const result = computeDirectionalResizedRect(RECT, "w", 50, 50, 5000, 50, 240, 200);
    expect(result.width).toBe(240);
    expect(result.x).toBe(160);
    expect(result.x + result.width).toBe(400);
  });

  it("n: 최소 높이에 걸리면 아래 변 기준으로 y가 고정된다", () => {
    // 아래 변 500 고정, 최소높이 200 → y = 500-200 = 300
    const result = computeDirectionalResizedRect(RECT, "n", 50, 50, 50, 5000, 240, 200);
    expect(result.height).toBe(200);
    expect(result.y).toBe(300);
    expect(result.y + result.height).toBe(500);
  });

  it("se는 기존 computeResizedRect와 동일한 결과를 낸다", () => {
    expect(computeDirectionalResizedRect(RECT, "se", 50, 50, 100, 90)).toEqual(
      computeResizedRect(RECT, 50, 50, 100, 90),
    );
  });
});

describe("clampToViewport (SIDE-04 헤더 프레임아웃 방지)", () => {
  it("상단이 뷰포트 위로 나가면 top=0으로, 헤더가 아래로 사라지면 위로 당긴다", () => {
    expect(clampToViewport({ x: 50, y: -80, width: 300, height: 400 }, 1200, 800).y).toBe(0);
    // y가 아주 크면 top=viewportHeight-headerHeight로 제한(헤더는 보임).
    expect(clampToViewport({ x: 50, y: 5000, width: 300, height: 400 }, 1200, 800, 36).y).toBe(800 - 36);
  });

  it("가로로 넘치면 뷰포트 안으로(좌0~우측 여백) 당긴다", () => {
    expect(clampToViewport({ x: -100, y: 10, width: 300, height: 400 }, 1200, 800).x).toBe(0);
    expect(clampToViewport({ x: 5000, y: 10, width: 300, height: 400 }, 1200, 800).x).toBe(1200 - 300);
  });
});
