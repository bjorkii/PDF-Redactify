import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";
import { assembleViewState, applyViewState } from "./viewState";
import type { ViewState } from "../types/generated/ViewState";

beforeEach(() => {
  useAppStore.setState({
    currentPageIndex: 0,
    zoomScale: 1.0,
    selectedItemId: null,
    sort: { column: "position", direction: "asc" },
    bookmarkSidebar: { visible: true, dock: "left", width: 240 },
    redactionSidebar: { visible: true, dock: "right", floating: false, rect: null, width: 240 },
  });
});

describe("assembleViewState (STATE-03/04)", () => {
  it("현재 store 상태로부터 §5.2 view_state를 구성한다", () => {
    useAppStore.setState({
      currentPageIndex: 6,
      zoomScale: 1.5,
      selectedItemId: "r-0",
      sort: { column: "page", direction: "desc" },
    });

    const viewState = assembleViewState();

    expect(viewState.current_page).toBe(6);
    expect(viewState.zoom).toBe(1.5);
    expect(viewState.selected_item_id).toBe("r-0");
    expect(viewState.sort).toEqual({ column: "page", direction: "desc" });
    expect(viewState.bookmark_sidebar).toEqual({ visible: true, dock: "left" });
    expect(viewState.redaction_sidebar).toEqual({
      visible: true,
      dock: "right",
      floating: false,
      rect: null,
    });
  });

  it("블랙마킹 사이드바가 플로팅 중이면 rect도 함께 담는다", () => {
    useAppStore.setState({
      redactionSidebar: {
        visible: true,
        dock: "right",
        floating: true,
        rect: { x: 10, y: 20, width: 300, height: 400 },
        width: 240,
      },
    });

    expect(assembleViewState().redaction_sidebar.rect).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    });
  });
});

describe("applyViewState (STATE-04)", () => {
  const savedViewState: ViewState = {
    current_page: 9,
    zoom: 2.0,
    selected_item_id: "r-5",
    focus: "bookmark",
    bookmark_sidebar: { visible: false, dock: "right" },
    redaction_sidebar: { visible: true, dock: "left", floating: true, rect: { x: 1, y: 2, width: 3, height: 4 } },
    sort: { column: "category", direction: "desc" },
  };

  it("불러온 view_state를 store에 그대로 반영한다", () => {
    applyViewState(savedViewState);

    const state = useAppStore.getState();
    expect(state.currentPageIndex).toBe(9);
    expect(state.zoomScale).toBe(2.0);
    expect(state.selectedItemId).toBe("r-5");
    expect(state.sort).toEqual({ column: "category", direction: "desc" });
    expect(state.bookmarkSidebar).toEqual({ visible: false, dock: "right", width: 240 });
    expect(state.redactionSidebar).toEqual({
      visible: true,
      dock: "left",
      floating: true,
      rect: { x: 1, y: 2, width: 3, height: 4 },
      width: 240,
    });
  });

  it("assembleViewState → applyViewState 왕복이 상태를 보존한다", () => {
    useAppStore.setState({
      currentPageIndex: 3,
      zoomScale: 0.75,
      selectedItemId: "r-9",
      sort: { column: "content", direction: "asc" },
    });

    const assembled = assembleViewState();
    useAppStore.setState({ currentPageIndex: 0, zoomScale: 1.0, selectedItemId: null });
    applyViewState(assembled);

    const state = useAppStore.getState();
    expect(state.currentPageIndex).toBe(3);
    expect(state.zoomScale).toBe(0.75);
    expect(state.selectedItemId).toBe("r-9");
  });
});
