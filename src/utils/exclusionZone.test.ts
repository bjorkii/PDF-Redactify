import { describe, expect, it } from "vitest";
import {
  bboxTouchesExclusion,
  clampMargins,
  computeDraggedMargins,
  EMPTY_MARGINS,
  marginsToDragBounds,
} from "./exclusionZone";

describe("clampMargins (DET-07)", () => {
  it("음수는 0으로 클램프한다(다른 축은 역전을 안 일으키는 값)", () => {
    expect(clampMargins({ top: -0.1, bottom: 0.2, left: 0.1, right: 0.1 })).toEqual({
      top: 0,
      bottom: 0.2,
      left: 0.1,
      right: 0.1,
    });
  });

  it("1을 넘는 값은 0..1로 클램프된 뒤, 반대편과 역전되지 않도록 추가 보정된다", () => {
    const result = clampMargins({ top: 1.5, bottom: 0, left: 0, right: 0 });
    expect(result.top).toBeCloseTo(0.99, 5); // (1-MIN_GAP) 초과분의 절반만 top에서 깎임
    expect(result.bottom).toBe(0);
  });

  it("역전되지 않는 큰 값은 상한 없이 그대로 둔다(사용자 요청 — 기존 45% 상한 제거)", () => {
    const margins = { top: 0.8, bottom: 0.1, left: 0.02, right: 0.02 };
    expect(clampMargins(margins)).toEqual(margins);
  });

  it("top+bottom이 역전되면(합이 1을 넘으면) 양쪽에서 절반씩 줄여 보정한다", () => {
    const result = clampMargins({ top: 0.7, bottom: 0.6, left: 0, right: 0 });
    expect(result.top + result.bottom).toBeCloseTo(0.98, 5); // 1 - MIN_GAP
    expect(result.top).toBeCloseTo(0.54, 5);
    expect(result.bottom).toBeCloseTo(0.44, 5);
  });

  it("left+right가 역전되면 양쪽에서 절반씩 줄여 보정한다", () => {
    const result = clampMargins({ top: 0, bottom: 0, left: 0.6, right: 0.6 });
    expect(result.left + result.right).toBeCloseTo(0.98, 5);
    expect(result.left).toBeCloseTo(0.49, 5);
    expect(result.right).toBeCloseTo(0.49, 5);
  });
});

describe("computeDraggedMargins (DET-07 드래그 가이드)", () => {
  it("top 가이드는 커서의 y 위치를 그대로 top 마진으로 쓴다", () => {
    const result = computeDraggedMargins(EMPTY_MARGINS, "top", 0.15);
    expect(result).toEqual({ top: 0.15, bottom: 0, left: 0, right: 0 });
  });

  it("top 가이드를 페이지 아래쪽 끝 가까이(0.9)까지 밀어도 상한 없이 반영된다(bottom이 0일 때)", () => {
    const result = computeDraggedMargins(EMPTY_MARGINS, "top", 0.9);
    expect(result.top).toBeCloseTo(0.9, 5);
  });

  it("bottom이 이미 어떤 값을 차지하고 있으면 top은 그 반대편을 넘어 역전되지 않는다", () => {
    const current = { top: 0, bottom: 0.3, left: 0, right: 0 };
    const result = computeDraggedMargins(current, "top", 0.9); // 0.9는 1-0.3-MIN_GAP(0.68)보다 큼
    expect(result.top).toBeCloseTo(0.68, 5);
    expect(result.bottom).toBe(0.3); // 반대편은 그대로
  });

  it("bottom 가이드는 (1 - 커서 y)를 bottom 마진으로 쓴다", () => {
    const result = computeDraggedMargins(EMPTY_MARGINS, "bottom", 0.9);
    expect(result.bottom).toBeCloseTo(0.1);
  });

  it("left 가이드는 커서의 x 위치를 그대로 left 마진으로 쓴다", () => {
    const result = computeDraggedMargins(EMPTY_MARGINS, "left", 0.2);
    expect(result).toEqual({ top: 0, bottom: 0, left: 0.2, right: 0 });
  });

  it("right 가이드는 (1 - 커서 x)를 right 마진으로 쓴다", () => {
    const result = computeDraggedMargins(EMPTY_MARGINS, "right", 0.85);
    expect(result.right).toBeCloseTo(0.15);
  });

  it("한 축을 드래그해도 나머지 3개 마진은 그대로 유지한다", () => {
    const current = { top: 0.1, bottom: 0.2, left: 0.05, right: 0.1 };
    const result = computeDraggedMargins(current, "left", 0.3);
    expect(result).toEqual({ top: 0.1, bottom: 0.2, left: 0.3, right: 0.1 });
  });

  it("커서가 페이지 밖(음수)이어도 0으로 클램프된다", () => {
    const result = computeDraggedMargins(EMPTY_MARGINS, "left", -0.5);
    expect(result.left).toBe(0);
  });

  it("커서가 반대편 가이드를 넘어가려 해도 역전되지 않는다(left/right)", () => {
    const current = { top: 0, bottom: 0, left: 0, right: 0.4 };
    const result = computeDraggedMargins(current, "left", 0.95); // 반대편 right=0.4를 넘어서려는 시도
    expect(result.left).toBeCloseTo(0.58, 5); // 1 - 0.4 - MIN_GAP
    expect(result.right).toBe(0.4);
  });
});

describe("marginsToDragBounds (DET-07 — 제외영역 안으로 bbox 진입 차단)", () => {
  it("마진이 전부 0이면 페이지 전체([0,1])와 같다", () => {
    expect(marginsToDragBounds(EMPTY_MARGINS)).toEqual({ minX: 0, maxX: 1, minY: 0, maxY: 1 });
  });

  it("각 마진만큼 허용 영역이 안쪽으로 좁혀진다", () => {
    const bounds = marginsToDragBounds({ top: 0.1, bottom: 0.2, left: 0.05, right: 0.15 });
    expect(bounds).toEqual({ minX: 0.05, maxX: 0.85, minY: 0.1, maxY: 0.8 });
  });

  it("마진 합이 1을 넘는(비정상) 경우에도 min이 max를 넘지 않는다", () => {
    const bounds = marginsToDragBounds({ top: 0.9, bottom: 0.9, left: 0, right: 0 });
    expect(bounds.maxY).toBeGreaterThanOrEqual(bounds.minY);
  });
});

describe("bboxTouchesExclusion (EDIT-14)", () => {
  const margins = { top: 0.1, bottom: 0.1, left: 0, right: 0 };

  it("상단 마진 경계에 닿으면 true", () => {
    expect(bboxTouchesExclusion({ x: 0.4, y: 0.1, width: 0.2, height: 0.05 }, margins)).toBe(true);
  });

  it("하단 마진 경계에 닿으면 true", () => {
    expect(bboxTouchesExclusion({ x: 0.4, y: 0.85, width: 0.2, height: 0.05 }, margins)).toBe(true);
  });

  it("경계에서 떨어져 있으면 false", () => {
    expect(bboxTouchesExclusion({ x: 0.4, y: 0.4, width: 0.2, height: 0.05 }, margins)).toBe(false);
  });

  it("마진이 0인 변은 닿아도 false(제외영역 없음)", () => {
    expect(bboxTouchesExclusion({ x: 0, y: 0.4, width: 0.2, height: 0.05 }, margins)).toBe(false);
  });
});
