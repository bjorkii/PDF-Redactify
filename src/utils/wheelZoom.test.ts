import { describe, expect, it } from "vitest";
import { accumulateWheelZoom, WHEEL_ZOOM_THRESHOLD } from "./wheelZoom";

describe("accumulateWheelZoom (§8.1 핀치/cmd-휠 확대·축소)", () => {
  it("임계값 미만이면 steps는 0이고 누적치만 늘어난다", () => {
    const result = accumulateWheelZoom(0, -10);
    expect(result.steps).toBe(0);
    expect(result.remaining).toBe(10);
  });

  it("음수 deltaY(위로 스크롤/벌리기)가 쌓여 임계값을 넘으면 확대(+1)로 커밋한다", () => {
    const result = accumulateWheelZoom(0, -WHEEL_ZOOM_THRESHOLD);
    expect(result.steps).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it("양수 deltaY(아래로 스크롤/오므리기)가 쌓여 임계값을 넘으면 축소(-1)로 커밋한다", () => {
    const result = accumulateWheelZoom(0, WHEEL_ZOOM_THRESHOLD);
    expect(result.steps).toBe(-1);
    expect(result.remaining).toBe(0);
  });

  it("임계값을 여러 번 넘으면 steps도 그만큼 커진다(빠른 제스처)", () => {
    const result = accumulateWheelZoom(0, -WHEEL_ZOOM_THRESHOLD * 2.5);
    expect(result.steps).toBe(2);
    expect(result.remaining).toBeCloseTo(WHEEL_ZOOM_THRESHOLD * 0.5);
  });

  it("나머지는 다음 이벤트로 이월돼 누적된다", () => {
    const first = accumulateWheelZoom(0, -(WHEEL_ZOOM_THRESHOLD - 5));
    expect(first.steps).toBe(0);
    expect(first.remaining).toBe(WHEEL_ZOOM_THRESHOLD - 5);

    const second = accumulateWheelZoom(first.remaining, -10);
    expect(second.steps).toBe(1);
  });

  it("방향이 반대로 뒤집히면 누적치가 상쇄된다", () => {
    const first = accumulateWheelZoom(0, -20);
    expect(first.steps).toBe(0);
    expect(first.remaining).toBe(20);

    const second = accumulateWheelZoom(first.remaining, 20);
    expect(second.steps).toBe(0);
    expect(second.remaining).toBe(0);
  });
});
