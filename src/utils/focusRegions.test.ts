import { describe, expect, it } from "vitest";
import { resolveTabTarget } from "./focusRegions";

describe("resolveTabTarget (KEY-01, §8.4 Tab)", () => {
  it("북마크 사이드바 안에 있으면 뷰어로 되돌린다", () => {
    expect(resolveTabTarget(true, true)).toBe("viewer");
    expect(resolveTabTarget(true, false)).toBe("viewer");
  });

  it("북마크 사이드바 밖(뷰어·블랙마킹 목록·툴바·포커스 없음 등)이면 북마크 사이드바로 전환한다", () => {
    expect(resolveTabTarget(false, true)).toBe("bookmark");
  });

  it("북마크 사이드바가 숨겨져 있으면 전환하지 않는다", () => {
    expect(resolveTabTarget(false, false)).toBeNull();
  });
});
