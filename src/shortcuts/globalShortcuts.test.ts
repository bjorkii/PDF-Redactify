import { describe, expect, it, vi } from "vitest";
import { handleGlobalKeyDown, type ShortcutKeyEvent } from "./globalShortcuts";

function makeEvent(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: "",
    preventDefault: vi.fn(),
    ...overrides,
  };
}

function makeActions() {
  return {
    openFile: vi.fn(),
    toggleBookmarkSidebar: vi.fn(),
    toggleRedactionSidebar: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    toggleBboxVisible: vi.fn(),
    saveRedactedDocument: vi.fn(),
    importReviewItems: vi.fn(),
  };
}

// 실제 코드는 isModifierPressed(event)로 "현재 OS에 맞는" 한 modifier만 보지만,
// 이 테스트는 OS 판별(INF-05는 platform.test.ts에서 이미 검증) 자체가 아니라
// 단축키 매핑 로직만 확인하는 게 목적이므로 metaKey/ctrlKey를 모두 켜서
// 테스트 실행 환경이 어느 쪽으로 판별되든 안정적으로 통과하게 한다.
const ANY_OS_MODIFIER = { metaKey: true, ctrlKey: true } as const;

describe("handleGlobalKeyDown (SPEC §8.4)", () => {
  it("cmd/ctrl-O: 파일 열기를 호출한다", () => {
    const actions = makeActions();
    const event = makeEvent({ ...ANY_OS_MODIFIER, key: "o" });

    handleGlobalKeyDown(event, actions);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(actions.openFile).toHaveBeenCalledOnce();
    expect(actions.toggleBookmarkSidebar).not.toHaveBeenCalled();
  });

  it("alt-cmd/ctrl-B: 북마크 사이드바를 토글한다", () => {
    const actions = makeActions();
    handleGlobalKeyDown(makeEvent({ ...ANY_OS_MODIFIER, altKey: true, key: "B" }), actions);

    expect(actions.toggleBookmarkSidebar).toHaveBeenCalledOnce();
    expect(actions.openFile).not.toHaveBeenCalled();
  });

  it("alt-cmd/ctrl-L: 블랙마킹 사이드바를 토글한다", () => {
    const actions = makeActions();
    handleGlobalKeyDown(makeEvent({ ...ANY_OS_MODIFIER, altKey: true, key: "l" }), actions);

    expect(actions.toggleRedactionSidebar).toHaveBeenCalledOnce();
  });

  it("modifier 없이는 아무 것도 하지 않는다", () => {
    const actions = makeActions();
    const event = makeEvent({ key: "o" });

    handleGlobalKeyDown(event, actions);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(actions.openFile).not.toHaveBeenCalled();
  });

  it("alt 없이 B/L을 눌러도 사이드바를 토글하지 않는다(O와 구분)", () => {
    const actions = makeActions();
    handleGlobalKeyDown(makeEvent({ ...ANY_OS_MODIFIER, key: "b" }), actions);

    expect(actions.toggleBookmarkSidebar).not.toHaveBeenCalled();
  });

  it("modifier가 있어도 매핑되지 않은 키는 무시한다", () => {
    const actions = makeActions();
    const event = makeEvent({ ...ANY_OS_MODIFIER, key: "x" });

    handleGlobalKeyDown(event, actions);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(actions.openFile).not.toHaveBeenCalled();
    expect(actions.toggleBookmarkSidebar).not.toHaveBeenCalled();
    expect(actions.toggleRedactionSidebar).not.toHaveBeenCalled();
  });

  it("cmd/ctrl-Z: undo를 호출한다(STATE-06)", () => {
    const actions = makeActions();
    const event = makeEvent({ ...ANY_OS_MODIFIER, key: "z" });

    handleGlobalKeyDown(event, actions);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(actions.undo).toHaveBeenCalledOnce();
    expect(actions.redo).not.toHaveBeenCalled();
  });

  it("shift-cmd/ctrl-Z: redo를 호출한다(STATE-06)", () => {
    const actions = makeActions();
    const event = makeEvent({ ...ANY_OS_MODIFIER, shiftKey: true, key: "Z" });

    handleGlobalKeyDown(event, actions);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(actions.redo).toHaveBeenCalledOnce();
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it("F1: modifier 없이도 bbox 표시를 토글한다(EDIT-04, §8.1)", () => {
    const actions = makeActions();
    const event = makeEvent({ key: "F1" });

    handleGlobalKeyDown(event, actions);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(actions.toggleBboxVisible).toHaveBeenCalledOnce();
  });

  it("cmd/ctrl-S: 블랙마킹 반영 저장을 호출한다(SAVE-03, §8.4)", () => {
    const actions = makeActions();
    const event = makeEvent({ ...ANY_OS_MODIFIER, key: "s" });

    handleGlobalKeyDown(event, actions);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(actions.saveRedactedDocument).toHaveBeenCalledOnce();
  });

  it("cmd/ctrl-I: 블랙마킹 정보 가져오기를 호출한다(KEY-01, §8.4)", () => {
    const actions = makeActions();
    const event = makeEvent({ ...ANY_OS_MODIFIER, key: "i" });

    handleGlobalKeyDown(event, actions);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(actions.importReviewItems).toHaveBeenCalledOnce();
  });
});
