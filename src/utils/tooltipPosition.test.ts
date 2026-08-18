import { describe, expect, it } from "vitest";
import { computeTooltipAlign } from "./tooltipPosition";

describe("computeTooltipAlign (BM-04)", () => {
  const viewportWidth = 1000;

  it("앵커가 창 왼쪽~중앙에 있으면 left(오른쪽으로 자람)", () => {
    expect(computeTooltipAlign(0, viewportWidth)).toBe("left");
    expect(computeTooltipAlign(500, viewportWidth)).toBe("left");
  });

  it("앵커가 창 오른쪽에 치우치면 right(왼쪽으로 자람, 화면 밖 방지)", () => {
    expect(computeTooltipAlign(700, viewportWidth)).toBe("right");
    expect(computeTooltipAlign(999, viewportWidth)).toBe("right");
  });

  it("threshold를 조정할 수 있다", () => {
    expect(computeTooltipAlign(500, viewportWidth, 0.4)).toBe("right");
    expect(computeTooltipAlign(300, viewportWidth, 0.4)).toBe("left");
  });
});
