import { useAppStore } from "../store/appStore";
import type { ViewState } from "../types/generated/ViewState";

/** STATE-03/04: 현재 앱 상태로부터 sidecar에 저장할 view_state를 구성한다(§5.2). */
export function assembleViewState(): ViewState {
  const state = useAppStore.getState();

  return {
    current_page: state.currentPageIndex,
    zoom: state.zoomScale,
    selected_item_id: state.selectedItemId,
    // 포커스 영역은 DOM 포커스로만 관리하고 store에 별도 추적하지 않으므로,
    // 재구동 시 포커스를 프로그램적으로 되찾지 않는 기본값을 기록한다.
    focus: "viewer",
    bookmark_sidebar: {
      visible: state.bookmarkSidebar.visible,
      dock: state.bookmarkSidebar.dock,
    },
    redaction_sidebar: {
      visible: state.redactionSidebar.visible,
      dock: state.redactionSidebar.dock,
      floating: state.redactionSidebar.floating,
      rect: state.redactionSidebar.rect,
    },
    sort: { column: state.sort.column, direction: state.sort.direction },
  };
}

/** STATE-04: 불러온 view_state를 store에 그대로 반영한다(§6.8 재구동 시 복원). */
export function applyViewState(viewState: ViewState): void {
  const store = useAppStore.getState();

  store.setCurrentPageIndex(viewState.current_page);
  store.setZoomScale(viewState.zoom);
  store.setSelectedItemId(viewState.selected_item_id);
  store.setSort({ column: viewState.sort.column, direction: viewState.sort.direction });
  // width는 view_state 스키마에 없는(세션 한정) 값이라 문서를 복원해도
  // 지금 사용자가 끌어놓은 폭을 그대로 유지한다.
  store.setBookmarkSidebarState({
    visible: viewState.bookmark_sidebar.visible,
    dock: viewState.bookmark_sidebar.dock,
    width: store.bookmarkSidebar.width,
  });
  store.setRedactionSidebarState({
    visible: viewState.redaction_sidebar.visible,
    dock: viewState.redaction_sidebar.dock,
    floating: viewState.redaction_sidebar.floating,
    rect: viewState.redaction_sidebar.rect,
    width: store.redactionSidebar.width,
  });
}
