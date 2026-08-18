// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { installBlankClickFocusGuard } from "./preserveFocus";

function fireMouseDown(target: Element): boolean {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  document.body.innerHTML = "";
});

describe("installBlankClickFocusGuard", () => {
  it("포커스 가능한 요소가 아닌 곳(툴바 빈 공간 등)을 클릭하면 mousedown 기본 동작을 막는다", () => {
    uninstall = installBlankClickFocusGuard();
    const blank = document.createElement("div");
    document.body.appendChild(blank);

    expect(fireMouseDown(blank)).toBe(true);
  });

  it("포커스 가능한 요소(button 등)를 클릭하면 막지 않는다", () => {
    uninstall = installBlankClickFocusGuard();
    const button = document.createElement("button");
    document.body.appendChild(button);

    expect(fireMouseDown(button)).toBe(false);
  });

  it("tabIndex가 있는 요소를 클릭하면 막지 않는다(뷰어·사이드바 wrapper 등)", () => {
    uninstall = installBlankClickFocusGuard();
    const wrapper = document.createElement("div");
    wrapper.tabIndex = 0;
    document.body.appendChild(wrapper);

    expect(fireMouseDown(wrapper)).toBe(false);
  });

  it("포커스 가능한 요소의 자손(예: 목록 행 안의 텍스트)을 클릭해도 막지 않는다", () => {
    uninstall = installBlankClickFocusGuard();
    const row = document.createElement("div");
    row.tabIndex = 0;
    const cell = document.createElement("span");
    row.appendChild(cell);
    document.body.appendChild(row);

    expect(fireMouseDown(cell)).toBe(false);
  });

  it("포커스 불가능한 요소의 자손(예: 사이드바 헤더 텍스트)을 클릭하면 막는다", () => {
    uninstall = installBlankClickFocusGuard();
    const header = document.createElement("div");
    const label = document.createElement("span");
    header.appendChild(label);
    document.body.appendChild(header);

    expect(fireMouseDown(label)).toBe(true);
  });

  it("해제(uninstall) 후에는 더 이상 막지 않는다", () => {
    const stop = installBlankClickFocusGuard();
    stop();
    const blank = document.createElement("div");
    document.body.appendChild(blank);

    expect(fireMouseDown(blank)).toBe(false);
  });
});
