import { describe, expect, it } from "vitest";
import { collectItemsFullyInside, collectItemsInClientMarquee, computeGroupMovedBboxes, computeGroupResizedBboxes, groupBoundingBox } from "./marqueeSelect";

const box = (id: string, x: number, y: number, width = 0.1, height = 0.05) => ({
  id,
  bbox: { x, y, width, height },
});

describe("collectItemsFullyInside (EDIT-13 러버밴드 포함판정)", () => {
  const items = [
    box("a", 0.1, 0.1), // 안쪽
    box("b", 0.5, 0.5), // 바깥
    box("c", 0.28, 0.1), // 오른쪽 경계 걸침(마퀴 오른쪽 0.35, c 오른쪽 0.38)
  ];
  const marquee = { x: 0.05, y: 0.05, width: 0.3, height: 0.3 }; // 0.05~0.35

  it("온전히 포함되는 항목만 반환한다", () => {
    expect(collectItemsFullyInside(marquee, items)).toEqual(["a"]);
  });

  it("경계에 정확히 접하는 항목은 포함으로 본다(<=)", () => {
    const flush = box("d", 0.05, 0.05, 0.3, 0.3); // 마퀴와 정확히 일치
    expect(collectItemsFullyInside(marquee, [flush])).toEqual(["d"]);
  });

  it("포함되는 게 없으면 빈 배열", () => {
    expect(collectItemsFullyInside({ x: 0, y: 0, width: 0.01, height: 0.01 }, items)).toEqual([]);
  });
});

describe("computeGroupMovedBboxes (EDIT-13 그룹 이동)", () => {
  const items = [box("a", 0.1, 0.1), box("b", 0.3, 0.2)];

  it("같은 변위로 전부 옮기고 상대 배치를 유지한다", () => {
    const moved = computeGroupMovedBboxes(items, { x: 0.1, y: 0.1 }, { x: 0.2, y: 0.15 });
    expect(moved.get("a")).toEqual({ x: 0.2, y: 0.15, width: 0.1, height: 0.05 });
    // b도 같은 변위(+0.1, +0.05)
    expect(moved.get("b")!.x).toBeCloseTo(0.4, 10);
    expect(moved.get("b")!.y).toBeCloseTo(0.25, 10);
  });

  it("그룹이 페이지 오른쪽/아래로 넘치면 delta를 clamp한다", () => {
    // group max x = 0.4. 오른쪽으로 크게 밀어도 group max <= 1
    const moved = computeGroupMovedBboxes(items, { x: 0, y: 0 }, { x: 5, y: 5 });
    const maxRight = Math.max(...[...moved.values()].map((b) => b.x + b.width));
    const maxBottom = Math.max(...[...moved.values()].map((b) => b.y + b.height));
    expect(maxRight).toBeLessThanOrEqual(1 + 1e-9);
    expect(maxBottom).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("그룹이 페이지 왼쪽/위로 넘치면 min 경계를 지킨다", () => {
    const moved = computeGroupMovedBboxes(items, { x: 0, y: 0 }, { x: -5, y: -5 });
    const minLeft = Math.min(...[...moved.values()].map((b) => b.x));
    const minTop = Math.min(...[...moved.values()].map((b) => b.y));
    expect(minLeft).toBeGreaterThanOrEqual(-1e-9);
    expect(minTop).toBeGreaterThanOrEqual(-1e-9);
  });

  it("빈 목록은 빈 맵", () => {
    expect(computeGroupMovedBboxes([], { x: 0, y: 0 }, { x: 1, y: 1 }).size).toBe(0);
  });
});

describe("groupBoundingBox / computeGroupResizedBboxes (EDIT-15 B-1)", () => {
  const items = [
    box("a", 0.2, 0.2, 0.1, 0.1), // (0.2,0.2)~(0.3,0.3)
    box("b", 0.4, 0.4, 0.1, 0.1), // (0.4,0.4)~(0.5,0.5)
  ];
  // 그룹 bbox = (0.2,0.2)~(0.5,0.5), width=0.3 height=0.3

  it("groupBoundingBox는 멤버 전체를 감싼다", () => {
    expect(groupBoundingBox(items)).toEqual({ x: 0.2, y: 0.2, width: 0.3, height: 0.3 });
  });

  it("se 모서리를 안쪽으로 끌면 그룹이 축소되고 멤버가 비율대로 줄어든다", () => {
    // se를 (0.35,0.35)로 → 새 그룹 (0.2,0.2)~(0.35,0.35), sx=sy=0.5
    const r = computeGroupResizedBboxes(items, "se", { x: 0.35, y: 0.35 });
    const a = r.get("a")!;
    const b = r.get("b")!;
    expect(a.x).toBeCloseTo(0.2);
    expect(a.y).toBeCloseTo(0.2);
    expect(a.width).toBeCloseTo(0.05);
    expect(a.height).toBeCloseTo(0.05);
    expect(b.x).toBeCloseTo(0.3);
    expect(b.y).toBeCloseTo(0.3);
    expect(b.width).toBeCloseTo(0.05);
    expect(b.height).toBeCloseTo(0.05);
  });

  it("동쪽 변(e)만 끌면 가로만 스케일되고 세로는 그대로", () => {
    // e를 x=0.8로 → 새 width=0.6, sx=2, sy=1
    const r = computeGroupResizedBboxes(items, "e", { x: 0.8, y: 0.5 });
    const a = r.get("a")!;
    expect(a.width).toBeCloseTo(0.2); // 0.1*2
    expect(a.height).toBeCloseTo(0.1); // 그대로
    expect(a.y).toBeCloseTo(0.2);
  });

  it("그룹이 페이지 밖으로 커지지 않게 bounds로 clamp한다", () => {
    const r = computeGroupResizedBboxes(items, "se", { x: 5, y: 5 });
    const maxRight = Math.max(...[...r.values()].map((b) => b.x + b.width));
    const maxBottom = Math.max(...[...r.values()].map((b) => b.y + b.height));
    expect(maxRight).toBeLessThanOrEqual(1 + 1e-9);
    expect(maxBottom).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("빈 목록은 빈 맵", () => {
    expect(computeGroupResizedBboxes([], "se", { x: 0.5, y: 0.5 }).size).toBe(0);
  });
});

describe("collectItemsInClientMarquee (스크롤 모드 alt 마퀴)", () => {
  const pages = [
    { pageIndex: 0, rect: { left: 100, top: 0, right: 300, bottom: 200 } },   // 200x200
    { pageIndex: 1, rect: { left: 100, top: 220, right: 300, bottom: 420 } }, // 아래 페이지
  ];
  const items = [
    { id: "a", page: 0, bbox: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 } }, // px (120,20)~(140,40)
    { id: "b", page: 1, bbox: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 } }, // px (120,240)~(140,260)
    { id: "edge", page: 0, bbox: { x: 0.9, y: 0.1, width: 0.2, height: 0.1 } }, // 오른쪽 경계 넘음
  ];

  it("마퀴에 온전히 든 항목만, 페이지를 넘나들며 모은다", () => {
    const marquee = { left: 100, top: 0, right: 300, bottom: 300 }; // 페이지0 전체 + 페이지1 상단
    expect(collectItemsInClientMarquee(marquee, pages, items).sort()).toEqual(["a", "b"]);
  });

  it("경계를 넘는 항목은 제외한다", () => {
    const marquee = { left: 100, top: 0, right: 200, bottom: 200 }; // 페이지0 왼쪽 절반
    expect(collectItemsInClientMarquee(marquee, pages, items)).toEqual(["a"]);
  });
});
