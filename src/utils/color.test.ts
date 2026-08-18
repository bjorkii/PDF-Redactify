import { describe, expect, it } from "vitest";
import { hexToRgba } from "./color";

describe("hexToRgba (COLOR-02)", () => {
  it("hex를 rgba() 문자열로 바꾼다", () => {
    expect(hexToRgba("#396cd8", 0.2)).toBe("rgba(57, 108, 216, 0.2)");
  });

  it("# 없이도 동작한다", () => {
    expect(hexToRgba("e6a000", 0.5)).toBe("rgba(230, 160, 0, 0.5)");
  });
});
