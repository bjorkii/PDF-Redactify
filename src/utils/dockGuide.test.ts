import { describe, expect, it } from "vitest";
import { computeDockGuideShape, computeTargetDock } from "./dockGuide";

describe("computeTargetDock (SIDE-02)", () => {
  const width = 1000;

  it("뷰포트 왼쪽 절반이면 left를 반환한다", () => {
    expect(computeTargetDock(0, width)).toBe("left");
    expect(computeTargetDock(499, width)).toBe("left");
  });

  it("뷰포트 오른쪽 절반이면 right를 반환한다", () => {
    expect(computeTargetDock(500, width)).toBe("right");
    expect(computeTargetDock(999, width)).toBe("right");
  });
});

describe("computeDockGuideShape (SIDE-03 동일 측 몰림 분기)", () => {
  const width = 1000;
  const sidebarWidth = 240;

  it("목표 측이 비어있으면(occupiedDock 불일치) edge를 반환한다", () => {
    expect(computeDockGuideShape(100, width, null, sidebarWidth)).toEqual({
      kind: "edge",
      dock: "left",
    });
    expect(computeDockGuideShape(100, width, "right", sidebarWidth)).toEqual({
      kind: "edge",
      dock: "left",
    });
  });

  it("left 도킹: 기존 사이드바 가운데(가운데 1/3)는 overlay(세로분할)", () => {
    // sidebarWidth=240 → 가운데 1/3은 80~160
    expect(computeDockGuideShape(80, width, "left", sidebarWidth)).toEqual({
      kind: "overlay",
      dock: "left",
    });
    expect(computeDockGuideShape(160, width, "left", sidebarWidth)).toEqual({
      kind: "overlay",
      dock: "left",
    });
  });

  it("left 도킹: 창 가장자리에 더 가까우면(바깥쪽 1/3) insertOuter", () => {
    expect(computeDockGuideShape(0, width, "left", sidebarWidth)).toEqual({
      kind: "insertOuter",
      dock: "left",
    });
    expect(computeDockGuideShape(79, width, "left", sidebarWidth)).toEqual({
      kind: "insertOuter",
      dock: "left",
    });
  });

  it("left 도킹: 뷰어에 더 가까우면(안쪽 1/3) insertInner", () => {
    expect(computeDockGuideShape(161, width, "left", sidebarWidth)).toEqual({
      kind: "insertInner",
      dock: "left",
    });
    expect(computeDockGuideShape(239, width, "left", sidebarWidth)).toEqual({
      kind: "insertInner",
      dock: "left",
    });
  });

  it("right 도킹은 창 가장자리 기준으로 뒤집어 계산한다(대칭)", () => {
    // 오른쪽 끝(width)이 "창 가장자리"이므로, width-80 근방이 overlay 중심
    expect(computeDockGuideShape(width, width, "right", sidebarWidth)).toEqual({
      kind: "insertOuter",
      dock: "right",
    });
    expect(computeDockGuideShape(width - 120, width, "right", sidebarWidth)).toEqual({
      kind: "overlay",
      dock: "right",
    });
    expect(computeDockGuideShape(width - 239, width, "right", sidebarWidth)).toEqual({
      kind: "insertInner",
      dock: "right",
    });
  });
});
