import { describe, expect, it } from "vitest";
import {
  computeDragRect,
  isDragRectSignificant,
  bboxEquals,
  computeResizedBbox,
  computeEdgeResizedBbox,
  computeMovedBbox,
  type RelativeRect,
} from "./dragRect";

// 부동소수점 오차(0.1+0.2 류) 때문에 toEqual 대신 각 필드를 근사 비교한다.
function expectRectClose(actual: RelativeRect, expected: RelativeRect) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.width).toBeCloseTo(expected.width);
  expect(actual.height).toBeCloseTo(expected.height);
}

describe("computeDragRect (EDIT-01, §6.3.2)", () => {
  it("오른쪽 아래로 드래그하면 시작점이 좌상단이 된다", () => {
    const rect = computeDragRect({ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.6 });
    expect(rect).toEqual({ x: 0.2, y: 0.3, width: 0.3, height: 0.3 });
  });

  it("왼쪽 위로 드래그해도(역방향) 같은 사각형이 나온다", () => {
    const rect = computeDragRect({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.3 });
    expect(rect).toEqual({ x: 0.2, y: 0.3, width: 0.3, height: 0.3 });
  });

  it("페이지 밖으로 벗어난 좌표는 경계로 clamp한다", () => {
    const rect = computeDragRect({ x: -0.5, y: 0.5 }, { x: 1.5, y: 0.8 });
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(1);
  });
});

describe("isDragRectSignificant", () => {
  it("충분히 크면 true", () => {
    expect(isDragRectSignificant({ x: 0, y: 0, width: 0.1, height: 0.1 })).toBe(true);
  });

  it("너무 작으면(실수 클릭) false", () => {
    expect(isDragRectSignificant({ x: 0, y: 0, width: 0.001, height: 0.001 })).toBe(false);
  });
});

describe("bboxEquals", () => {
  it("네 값이 모두 같으면 true", () => {
    expect(bboxEquals({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, { x: 0.1, y: 0.2, width: 0.3, height: 0.4 })).toBe(
      true,
    );
  });

  it("하나라도 다르면 false", () => {
    expect(bboxEquals({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, { x: 0.1, y: 0.2, width: 0.3, height: 0.5 })).toBe(
      false,
    );
  });
});

describe("computeResizedBbox (EDIT-02, §6.3.3)", () => {
  const original = { x: 0.2, y: 0.2, width: 0.3, height: 0.3 }; // (0.2,0.2)~(0.5,0.5)

  it("se(오른쪽 아래) 핸들은 좌상단(0.2,0.2)을 고정하고 그 지점까지 늘린다", () => {
    const result = computeResizedBbox(original, "se", { x: 0.7, y: 0.6 });
    expectRectClose(result, { x: 0.2, y: 0.2, width: 0.5, height: 0.4 });
  });

  it("nw(왼쪽 위) 핸들은 우하단(0.5,0.5)을 고정한다", () => {
    const result = computeResizedBbox(original, "nw", { x: 0.1, y: 0.1 });
    expectRectClose(result, { x: 0.1, y: 0.1, width: 0.4, height: 0.4 });
  });

  it("ne(오른쪽 위) 핸들은 좌하단(0.2,0.5)을 고정한다", () => {
    const result = computeResizedBbox(original, "ne", { x: 0.6, y: 0.1 });
    expectRectClose(result, { x: 0.2, y: 0.1, width: 0.4, height: 0.4 });
  });

  it("sw(왼쪽 아래) 핸들은 우상단(0.5,0.2)을 고정한다", () => {
    const result = computeResizedBbox(original, "sw", { x: 0.1, y: 0.6 });
    expectRectClose(result, { x: 0.1, y: 0.2, width: 0.4, height: 0.4 });
  });
});

describe("computeMovedBbox (EDIT-02, §6.3.3)", () => {
  const original = { x: 0.2, y: 0.2, width: 0.3, height: 0.3 };

  it("드래그한 만큼 위치만 옮기고 크기는 그대로 둔다", () => {
    const result = computeMovedBbox(original, { x: 0.3, y: 0.3 }, { x: 0.4, y: 0.5 });
    expectRectClose(result, { x: 0.3, y: 0.4, width: 0.3, height: 0.3 });
  });

  it("페이지 밖으로 나가지 않도록 clamp한다", () => {
    const result = computeMovedBbox(original, { x: 0, y: 0 }, { x: 5, y: 5 });
    expect(result.x).toBe(0.7); // 1 - width(0.3)
    expect(result.y).toBe(0.7);
    expect(result.width).toBe(0.3);
  });

  it("반대 방향(왼쪽 위)으로 나가도 0에서 멈춘다", () => {
    const result = computeMovedBbox(original, { x: 0, y: 0 }, { x: -5, y: -5 });
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});

describe("DET-07: bounds(제외영역 허용 영역)로 좁혀진 드래그", () => {
  // 페이지 상단 30%가 제외영역인 경우의 허용 영역.
  const bounds = { minX: 0, maxX: 1, minY: 0.3, maxY: 1 };

  it("computeDragRect — 제외영역 안으로는 드래그해도 그 경계에서 멈춘다", () => {
    const rect = computeDragRect({ x: 0.2, y: 0.1 }, { x: 0.5, y: 0.6 }, bounds);
    expectRectClose(rect, { x: 0.2, y: 0.3, width: 0.3, height: 0.3 });
  });

  it("computeDragRect — 시작·끝 모두 제외영역 안이면 크기가 0이 된다(생성 안 됨)", () => {
    const rect = computeDragRect({ x: 0.1, y: 0.05 }, { x: 0.4, y: 0.2 }, bounds);
    expect(rect.height).toBe(0);
  });

  it("computeResizedBbox — 제외영역 쪽으로 리사이즈해도 경계에서 멈춘다", () => {
    const original = { x: 0.2, y: 0.5, width: 0.3, height: 0.3 }; // (0.2,0.5)~(0.5,0.8)
    const result = computeResizedBbox(original, "nw", { x: 0.1, y: 0.1 }, bounds);
    expectRectClose(result, { x: 0.1, y: 0.3, width: 0.4, height: 0.5 });
  });

  it("computeMovedBbox — 제외영역 쪽으로 이동해도 경계에서 멈춘다", () => {
    const original = { x: 0.2, y: 0.4, width: 0.3, height: 0.1 };
    const result = computeMovedBbox(original, { x: 0, y: 0 }, { x: 0, y: -5 }, bounds);
    expect(result.y).toBe(0.3);
  });
});

describe("computeEdgeResizedBbox (EDIT-17, B-6/B-7)", () => {
  const rect: RelativeRect = { x: 0.3, y: 0.3, width: 0.2, height: 0.2 }; // (0.3,0.3)~(0.5,0.5)

  it("왼쪽 변: +면 오른쪽으로(축소), -면 왼쪽으로(확장) — x/width만 바뀜", () => {
    expectRectClose(computeEdgeResizedBbox(rect, "left", 0.05), { x: 0.35, y: 0.3, width: 0.15, height: 0.2 });
    expectRectClose(computeEdgeResizedBbox(rect, "left", -0.1), { x: 0.2, y: 0.3, width: 0.3, height: 0.2 });
  });

  it("오른쪽 변: +면 확장, -면 축소 — width만 바뀜", () => {
    expectRectClose(computeEdgeResizedBbox(rect, "right", 0.1), { x: 0.3, y: 0.3, width: 0.3, height: 0.2 });
    expectRectClose(computeEdgeResizedBbox(rect, "right", -0.05), { x: 0.3, y: 0.3, width: 0.15, height: 0.2 });
  });

  it("윗변/아랫변: y·height를 민다", () => {
    expectRectClose(computeEdgeResizedBbox(rect, "top", -0.1), { x: 0.3, y: 0.2, width: 0.2, height: 0.3 });
    expectRectClose(computeEdgeResizedBbox(rect, "bottom", 0.1), { x: 0.3, y: 0.3, width: 0.2, height: 0.3 });
  });

  it("페이지 밖으로 확장하면 경계에서 멈춘다", () => {
    expectRectClose(computeEdgeResizedBbox(rect, "left", -1), { x: 0, y: 0.3, width: 0.5, height: 0.2 });
    expectRectClose(computeEdgeResizedBbox(rect, "right", 1), { x: 0.3, y: 0.3, width: 0.7, height: 0.2 });
  });

  it("변이 반대 변을 넘어 뒤집히지 않게 최소 크기(0.01)를 지킨다", () => {
    // 왼쪽 변을 오른쪽으로 크게 밀어도 오른변(0.5)−0.01 까지만.
    const r = computeEdgeResizedBbox(rect, "left", 1);
    expect(r.width).toBeCloseTo(0.01);
    expect(r.x).toBeCloseTo(0.49);
  });

  it("제외영역 bounds 안으로 clamp한다", () => {
    // 윗변 위쪽 제외(minY=0.3)면 위로 못 넘어간다.
    const r = computeEdgeResizedBbox(rect, "top", -0.5, { minX: 0, maxX: 1, minY: 0.3, maxY: 1 });
    expect(r.y).toBeCloseTo(0.3);
  });
});
