import { describe, expect, it } from "vitest";
import { categoryLabel, categoryCode } from "./reviewItemCategory";

describe("categoryLabel (LIST-03, §5.3)", () => {
  it("알려진 category 코드를 한국어 표시명으로 바꾼다", () => {
    expect(categoryLabel("PhoneNumber")).toBe("전화번호");
    expect(categoryLabel("RRN")).toBe("주민등록번호");
    expect(categoryLabel("Custom")).toBe("사용자 지정");
  });

  it("알 수 없는 값은 원본 문자열을 그대로 보여준다(가져오기 등 예외 데이터 대비)", () => {
    expect(categoryLabel("Unknown")).toBe("Unknown");
  });
});

describe("categoryCode (IO-02, §5.4)", () => {
  it("알려진 한국어 표시명을 category 코드로 되돌린다", () => {
    expect(categoryCode("전화번호")).toBe("PhoneNumber");
    expect(categoryCode("주민등록번호")).toBe("RRN");
    expect(categoryCode("사용자 지정")).toBe("Custom");
  });

  it("알 수 없는 표시명(오탈자·사용자 지정 문자열)은 그대로 코드로 쓴다", () => {
    expect(categoryCode("휴대폰번호")).toBe("휴대폰번호");
  });

  it("categoryLabel과 왕복한다", () => {
    expect(categoryCode(categoryLabel("PhoneNumber"))).toBe("PhoneNumber");
  });
});
