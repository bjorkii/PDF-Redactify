import { describe, expect, it } from "vitest";
import { computeAutoScrollTop } from "./autoScroll";

describe("computeAutoScrollTop (BM-02)", () => {
  it("이미 완전히 보이는 항목은 스크롤하지 않는다(null)", () => {
    // 컨테이너: scrollTop=100, 높이=300 → 보이는 범위 [100, 400]
    // 항목: top=150, height=20 → [150, 170], 완전히 안에 있음
    expect(computeAutoScrollTop(150, 20, 100, 300)).toBeNull();
  });

  it("항목이 위쪽으로 화면 밖에 있으면 중앙으로 오도록 스크롤한다", () => {
    // 항목 top=10, height=20 → 중앙 정렬 목표: 10+10-150 = -130 → clamp 0
    expect(computeAutoScrollTop(10, 20, 100, 300)).toBe(0);
  });

  it("항목이 아래쪽으로 화면 밖에 있으면 중앙으로 오도록 스크롤한다", () => {
    // 항목 top=1000, height=20 → 목표: 1000+10-150 = 860
    expect(computeAutoScrollTop(1000, 20, 100, 300)).toBe(860);
  });

  it("항목이 일부만 걸쳐 보여도(완전히 보이지 않으면) 중앙으로 슬라이딩한다", () => {
    // 컨테이너 보이는 범위 [100, 400], 항목 [390, 410] → 아래로 일부 잘림
    const result = computeAutoScrollTop(390, 20, 100, 300);
    expect(result).not.toBeNull();
    expect(result).toBe(390 + 10 - 150);
  });
});
