import { describe, expect, it } from "vitest";
import {
  physicalLetter,
  detectPlatform,
  modifierEventKey,
  modifierKey,
  modifierSymbol,
  isModifierPressed,
} from "./platform";

describe("detectPlatform", () => {
  it("맥 계열 문자열을 mac으로 판별한다", () => {
    expect(detectPlatform("MacIntel")).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
  });

  it("윈도우 계열 문자열을 windows로 판별한다", () => {
    expect(detectPlatform("Win32")).toBe("windows");
    expect(detectPlatform("Windows NT 10.0")).toBe("windows");
  });

  it("그 외는 other로 판별한다", () => {
    expect(detectPlatform("Linux x86_64")).toBe("other");
  });
});

describe("modifierKey / modifierEventKey / modifierSymbol", () => {
  it("macOS는 cmd/metaKey/⌘로 매핑된다", () => {
    expect(modifierKey("mac")).toBe("cmd");
    expect(modifierEventKey("mac")).toBe("metaKey");
    expect(modifierSymbol("mac")).toBe("⌘");
  });

  it("Windows(그 외 포함)는 ctrl/ctrlKey/Ctrl로 매핑된다", () => {
    expect(modifierKey("windows")).toBe("ctrl");
    expect(modifierEventKey("windows")).toBe("ctrlKey");
    expect(modifierSymbol("windows")).toBe("Ctrl");

    expect(modifierKey("other")).toBe("ctrl");
    expect(modifierEventKey("other")).toBe("ctrlKey");
  });
});

describe("isModifierPressed", () => {
  it("macOS에서는 metaKey만 인식한다", () => {
    expect(isModifierPressed({ metaKey: true, ctrlKey: false }, "mac")).toBe(true);
    expect(isModifierPressed({ metaKey: false, ctrlKey: true }, "mac")).toBe(false);
  });

  it("Windows에서는 ctrlKey만 인식한다", () => {
    expect(isModifierPressed({ metaKey: false, ctrlKey: true }, "windows")).toBe(true);
    expect(isModifierPressed({ metaKey: true, ctrlKey: false }, "windows")).toBe(false);
  });
});

describe("physicalLetter (한/영 무관 단축키)", () => {
  it("KeyA~KeyZ code를 라틴 소문자로 돌려준다(event.key와 무관)", () => {
    expect(physicalLetter({ code: "KeyZ" })).toBe("z");
    // 한글 입력 상태로 key가 'ㅋ'이어도 물리 위치는 그대로.
    expect(physicalLetter({ code: "KeyZ", key: "ㅋ" } as unknown as { code?: string })).toBe("z");
    expect(physicalLetter({ code: "KeyA" })).toBe("a");
  });

  it("글자 키가 아니면 null(호출부가 event.key로 폴백)", () => {
    expect(physicalLetter({ code: "Digit1" })).toBeNull();
    expect(physicalLetter({ code: "ArrowLeft" })).toBeNull();
    expect(physicalLetter({ code: undefined })).toBeNull();
    expect(physicalLetter({})).toBeNull();
  });
});
