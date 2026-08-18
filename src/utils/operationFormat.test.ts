import { describe, expect, it } from "vitest";
import { formatMmSs, estimateRemainingMs, formatSizeDelta } from "./operationFormat";

describe("formatMmSs", () => {
  it("분·초를 2자리로 채운다", () => {
    expect(formatMmSs(0)).toBe("00:00");
    expect(formatMmSs(5000)).toBe("00:05");
    expect(formatMmSs(92_000)).toBe("01:32");
    expect(formatMmSs(2_732_000)).toBe("45:32");
  });
  it("음수는 00:00으로 방어", () => {
    expect(formatMmSs(-1000)).toBe("00:00");
  });
});

describe("estimateRemainingMs", () => {
  it("처리 전이면 null", () => {
    expect(estimateRemainingMs(1000, 0, 10)).toBeNull();
    expect(estimateRemainingMs(1000, 5, 0)).toBeNull();
  });
  it("진행 비율로 남은 시간을 추정한다", () => {
    // 2/10 처리에 2초 → 전체 추정 10초, 남은 8초.
    expect(estimateRemainingMs(2000, 2, 10)).toBe(8000);
    // 절반 처리에 5초 → 남은 5초.
    expect(estimateRemainingMs(5000, 5, 10)).toBe(5000);
  });
});

describe("formatSizeDelta", () => {
  it("증가/감소/동일을 구분한다", () => {
    expect(formatSizeDelta(1_000_000, 2_048_576)).toBe("1.0MB 증가");
    expect(formatSizeDelta(3_097_152, 2_048_576)).toBe("1.0MB 감소");
    expect(formatSizeDelta(1000, 1000)).toBe("용량 동일");
  });
});
