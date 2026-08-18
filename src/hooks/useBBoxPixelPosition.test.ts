import { describe, expect, it } from "vitest";
import { computeBBoxPixelPosition } from "./useBBoxPixelPosition";

describe("computeBBoxPixelPosition (PDF-04 bbox 좌표 재계산 훅)", () => {
  it("렌더된 페이지가 없으면 null을 반환한다", () => {
    expect(computeBBoxPixelPosition({ x: 0, y: 0, width: 0.1, height: 0.1 }, null)).toBeNull();
  });

  it("주어진 픽셀 크기 기준으로 상대좌표를 픽셀로 변환한다", () => {
    const bbox = { x: 0.25, y: 0.5, width: 0.1, height: 0.05 };
    const result = computeBBoxPixelPosition(bbox, { width: 800, height: 1000 });

    expect(result).toEqual({ x: 200, y: 500, width: 80, height: 50 });
  });

  it("줌으로 페이지 픽셀 크기가 바뀌면(재렌더) 같은 상대좌표라도 픽셀 값이 다시 계산된다", () => {
    const bbox = { x: 0.25, y: 0.5, width: 0.1, height: 0.05 };

    const at1x = computeBBoxPixelPosition(bbox, { width: 800, height: 1000 });
    const at2x = computeBBoxPixelPosition(bbox, { width: 1600, height: 2000 });

    expect(at2x).toEqual({
      x: at1x!.x * 2,
      y: at1x!.y * 2,
      width: at1x!.width * 2,
      height: at1x!.height * 2,
    });
  });
});
