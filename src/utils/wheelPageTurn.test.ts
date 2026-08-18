import { describe, expect, it } from "vitest";
import { accumulateBoundaryScroll, PAGE_TURN_THRESHOLD } from "./wheelPageTurn";

describe("accumulateBoundaryScroll (§8.1 트랙패드 두 손가락 스크롤로 페이지 전환)", () => {
  it("아래로 스크롤 중 맨 아래 경계가 아니면(페이지 내용을 보는 중) 누적하지 않는다", () => {
    const result = accumulateBoundaryScroll(50, 30, false, false);
    expect(result.turn).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it("맨 아래 경계에서 아래로 스크롤하면 누적된다", () => {
    const result = accumulateBoundaryScroll(0, 30, false, true);
    expect(result.turn).toBe(0);
    expect(result.remaining).toBe(30);
  });

  it("맨 아래 경계 누적이 임계값을 넘으면 다음 페이지(1)로 전환하고 리셋한다", () => {
    const result = accumulateBoundaryScroll(PAGE_TURN_THRESHOLD - 10, 20, false, true);
    expect(result.turn).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it("맨 위 경계에서 위로 스크롤하면 누적되다 임계값을 넘으면 이전 페이지(-1)로 전환한다", () => {
    const first = accumulateBoundaryScroll(0, -30, true, false);
    expect(first.turn).toBe(0);
    expect(first.remaining).toBe(-30);

    const second = accumulateBoundaryScroll(first.remaining, -PAGE_TURN_THRESHOLD, true, false);
    expect(second.turn).toBe(-1);
    expect(second.remaining).toBe(0);
  });

  it("스크롤할 내용이 없어(위/아래 경계가 동시에 참) 스크롤하자마자 누적된다", () => {
    const result = accumulateBoundaryScroll(0, PAGE_TURN_THRESHOLD, true, true);
    expect(result.turn).toBe(1);
  });

  it("아래로 누르다 맨 위(반대쪽) 경계 플래그만 참이면 누적하지 않는다", () => {
    const result = accumulateBoundaryScroll(50, 30, true, false);
    expect(result.turn).toBe(0);
    expect(result.remaining).toBe(0);
  });
});
