import { describe, expect, it } from "vitest";
import { computeFitToPageScale } from "./fitToPage";

describe("computeFitToPageScale (PDF-04 전체보기)", () => {
  it("가로가 더 제약이 크면(뷰포트가 가로로 좁으면) 가로 기준 배율을 쓴다", () => {
    // 페이지 612x792pt, 뷰포트 306x900px → 2px 안전 여유를 뺀 304/612 ≈ 0.4967
    expect(computeFitToPageScale(612, 792, 306, 900)).toBeCloseTo(304 / 612, 5);
  });

  it("세로가 더 제약이 크면(뷰포트가 세로로 좁으면) 세로 기준 배율을 쓴다", () => {
    // 페이지 612x792pt, 뷰포트 900x396px → 2px 안전 여유를 뺀 394/792 ≈ 0.4975
    expect(computeFitToPageScale(612, 792, 900, 396)).toBeCloseTo(394 / 792, 5);
  });

  it("페이지와 뷰포트가 정확히 같은 비율이면 두 축의 배율이 같은 방향(1보다 살짝 작게)으로 나온다", () => {
    // 2px 안전 여유 때문에 정확히 1이 아니라 살짝 작다(반올림으로 인한
    // 뷰어 영역 밖 넘침 방지 — fitToPage.ts 주석 참고).
    const scale = computeFitToPageScale(612, 792, 612, 792);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeCloseTo(610 / 612, 5);
  });

  it("뷰포트가 여유(2px)보다 작아도 음수·0 배율이 되지 않는다", () => {
    expect(computeFitToPageScale(612, 792, 1, 1)).toBeGreaterThan(0);
  });

  it("페이지/뷰포트 치수가 0 이하이면(아직 측정 전 등) 안전하게 1을 반환한다", () => {
    expect(computeFitToPageScale(0, 792, 900, 900)).toBe(1);
    expect(computeFitToPageScale(612, 792, 0, 900)).toBe(1);
  });
});
