// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handleTabKeyDown } from "./tabFocus";

function makeFocusable(attrs: Record<string, string>, parent: HTMLElement = document.body): HTMLDivElement {
  const el = document.createElement("div");
  el.tabIndex = 0;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  parent.appendChild(el);
  return el;
}

function fireTab(bookmarkVisible = true) {
  const event = { key: "Tab", preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handleTabKeyDown(event, bookmarkVisible);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function runRaf() {
  // requestAnimationFrame(cb) -> flush it synchronously in tests.
  vi.runAllTimers();
}

describe("handleTabKeyDown (KEY-01, §8.4 Tab) — real nested DOM", () => {
  it("뷰어 안의 중첩된 요소(PaginatedView처럼)에 포커스가 있어도 북마크 사이드바로 전환된다", () => {
    const viewer = makeFocusable({ "data-focus-region": "viewer" });
    const nestedInsideViewer = makeFocusable({}, viewer); // PaginatedView의 내부 tabIndex div 역할
    const bookmark = makeFocusable({ "data-sidebar-id": "bookmark" });

    nestedInsideViewer.focus();
    expect(document.activeElement).toBe(nestedInsideViewer);

    const event = fireTab();
    runRaf();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(bookmark);
  });

  it("블랙마킹 목록(행)에 포커스가 있어도 뷰어로 가지 않고 북마크 사이드바로 전환된다 — 이제 뷰어와 같은 도메인이라 Tab의 별도 대상이 아니다", () => {
    const viewer = makeFocusable({ "data-focus-region": "viewer" });
    const redactionRow = makeFocusable({ "data-sidebar-id": "redaction" });
    const bookmark = makeFocusable({ "data-sidebar-id": "bookmark" });

    redactionRow.focus();
    expect(document.activeElement).toBe(redactionRow);

    const event = fireTab();
    runRaf();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(bookmark);
    expect(document.activeElement).not.toBe(viewer);
  });

  it("북마크 사이드바 안의 중첩된 요소에 포커스가 있어도 뷰어로 되돌아간다", () => {
    const viewer = makeFocusable({ "data-focus-region": "viewer" });
    const bookmark = makeFocusable({ "data-sidebar-id": "bookmark" });
    const selectedNode = makeFocusable({}, bookmark); // BookmarkTreeItem(선택된 노드) 역할

    selectedNode.focus();
    expect(document.activeElement).toBe(selectedNode);

    const event = fireTab();
    runRaf();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(viewer);
  });

  it("뷰어 ↔ 북마크 사이드바를 여러 번 왕복해도 매번 정확히 전환된다", () => {
    const viewer = makeFocusable({ "data-focus-region": "viewer" });
    const bookmark = makeFocusable({ "data-sidebar-id": "bookmark" });

    viewer.focus();
    fireTab();
    runRaf();
    expect(document.activeElement).toBe(bookmark);

    fireTab();
    runRaf();
    expect(document.activeElement).toBe(viewer);

    fireTab();
    runRaf();
    expect(document.activeElement).toBe(bookmark);
  });

  it("툴바 버튼처럼 뷰어·사이드바 어디에도 속하지 않는 곳에 포커스가 있어도 북마크 사이드바로 전환한다(툴바를 거치지 않음)", () => {
    const toolbarButton = makeFocusable({});
    const bookmark = makeFocusable({ "data-sidebar-id": "bookmark" });

    toolbarButton.focus();
    expect(document.activeElement).toBe(toolbarButton);

    const event = fireTab();
    runRaf();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(bookmark);
  });

  it("포커스가 아예 없어도(document.body) 북마크 사이드바로 전환한다", () => {
    const bookmark = makeFocusable({ "data-sidebar-id": "bookmark" });
    (document.activeElement as HTMLElement | null)?.blur();

    const event = fireTab();
    runRaf();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(bookmark);
  });

  it("북마크 사이드바가 숨겨져 있으면 가로채지 않는다", () => {
    makeFocusable({ "data-focus-region": "viewer" });

    const event = fireTab(false);
    runRaf();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("입력창을 편집 중이면 가로채지 않는다(F2 수정, 색상 picker 등)", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const event = fireTab();
    runRaf();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("모달 다이얼로그 안에서는 가로채지 않는다(단축키창 등 자체 Tab 이동)", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    const button = makeFocusable({}, dialog);
    button.focus();

    const event = fireTab();
    runRaf();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });
});
