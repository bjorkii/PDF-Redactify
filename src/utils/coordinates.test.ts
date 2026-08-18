import { describe, expect, it } from "vitest";
import { pixelToRelative, relativeToPixel, type PixelSize, type RelativeBBox } from "./coordinates";

describe("relativeToPixel / pixelToRelative 왕복 변환", () => {
  const pageSize: PixelSize = { width: 800, height: 1200 };

  it("상대좌표 → 픽셀 → 상대좌표 왕복이 무손실이다", () => {
    const original: RelativeBBox = { x: 0.102, y: 0.871, width: 0.101, height: 0.012 };

    const pixel = relativeToPixel(original, pageSize);
    const roundTripped = pixelToRelative(pixel, pageSize);

    expect(roundTripped.x).toBeCloseTo(original.x, 10);
    expect(roundTripped.y).toBeCloseTo(original.y, 10);
    expect(roundTripped.width).toBeCloseTo(original.width, 10);
    expect(roundTripped.height).toBeCloseTo(original.height, 10);
  });

  it("경계값(0, 1)도 왕복이 무손실이다", () => {
    const original: RelativeBBox = { x: 0, y: 0, width: 1, height: 1 };

    const roundTripped = pixelToRelative(relativeToPixel(original, pageSize), pageSize);

    expect(roundTripped).toEqual(original);
  });

  it("페이지 크기가 달라져도 픽셀 값은 페이지에 맞게 재계산된다(줌·재렌더 대응)", () => {
    const original: RelativeBBox = { x: 0.25, y: 0.5, width: 0.1, height: 0.05 };
    const zoomedPageSize: PixelSize = { width: 1600, height: 2400 }; // 2배 확대 렌더

    const pixelAtZoom = relativeToPixel(original, zoomedPageSize);

    expect(pixelAtZoom).toEqual({ x: 400, y: 1200, width: 160, height: 120 });
    expect(pixelToRelative(pixelAtZoom, zoomedPageSize)).toEqual(original);
  });

  it("relativeToPixel은 지정된 픽셀 값을 정확히 계산한다", () => {
    const bbox: RelativeBBox = { x: 0.5, y: 0.25, width: 0.2, height: 0.1 };
    expect(relativeToPixel(bbox, pageSize)).toEqual({ x: 400, y: 300, width: 160, height: 120 });
  });
});
