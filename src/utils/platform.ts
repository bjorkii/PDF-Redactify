// SPEC §8: 단축키 modifier는 OS별로 자동 매핑된다(macOS=cmd, Windows=ctrl).

export type Platform = "mac" | "windows" | "other";

export function detectPlatform(userAgentOrPlatform: string): Platform {
  const value = userAgentOrPlatform.toLowerCase();
  if (value.includes("mac")) return "mac";
  if (value.includes("win")) return "windows";
  return "other";
}

export function currentPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  return detectPlatform(navigator.platform || navigator.userAgent || "");
}

/** 표시용 modifier 이름("cmd" | "ctrl"). */
export function modifierKey(platform: Platform = currentPlatform()): "cmd" | "ctrl" {
  return platform === "mac" ? "cmd" : "ctrl";
}

/** KeyboardEvent에서 확인할 실제 modifier 속성명. */
export function modifierEventKey(platform: Platform = currentPlatform()): "metaKey" | "ctrlKey" {
  return platform === "mac" ? "metaKey" : "ctrlKey";
}

/** 단축키 표기에 쓸 modifier 기호("⌘" | "Ctrl"). */
export function modifierSymbol(platform: Platform = currentPlatform()): string {
  return platform === "mac" ? "⌘" : "Ctrl";
}

/** 단축키창·README에 쓸 OS별 키 기호 세트. mac은 기호, Windows는 단어로 표기. */
export interface OsKeySymbols {
  mod: string;
  alt: string;
  shift: string;
  del: string;
}

export function osKeySymbols(platform: Platform = currentPlatform()): OsKeySymbols {
  return platform === "mac"
    ? { mod: "⌘", alt: "⌥", shift: "⇧", del: "⌫" }
    : { mod: "Ctrl", alt: "Alt", shift: "Shift", del: "Del" };
}

/** 현재 OS의 modifier가 눌려있는지 확인(§8 OS 매핑 적용). */
export function isModifierPressed(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
  platform: Platform = currentPlatform(),
): boolean {
  return event[modifierEventKey(platform)];
}

/**
 * 한/영(IME)·키보드 레이아웃과 무관하게, **물리 키 위치**의 라틴 소문자
 * 글자를 돌려준다(예: `event.code === "KeyZ"` → `"z"`). 한글 입력 상태에서는
 * `event.key`가 "ㅋ"·"ㅁ" 등으로 바뀌지만 `event.code`는 물리 위치라 그대로다
 * — 그래서 z/ㅋ, s/ㄴ 어느 상태에서도 같은 단축키로 동작한다(사용자 요청).
 * 글자 키가 아니면(숫자·기호·화살표 등) null → 호출부가 `event.key`로 폴백한다.
 */
export function physicalLetter(event: { code?: string }): string | null {
  const code = event.code;
  if (code && code.length === 4 && code.startsWith("Key")) {
    return code[3].toLowerCase();
  }
  return null;
}
