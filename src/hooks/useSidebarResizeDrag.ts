import { useAppStore, type SidebarId } from "../store/appStore";

const MIN_SIDEBAR_WIDTH_PX = 180;
const MAX_SIDEBAR_WIDTH_PX = 560;

function currentSidebarState(sidebarId: SidebarId) {
  const state = useAppStore.getState();
  return sidebarId === "bookmark" ? state.bookmarkSidebar : state.redactionSidebar;
}

function clampWidth(width: number): number {
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH_PX), MAX_SIDEBAR_WIDTH_PX);
}

/**
 * SIDE-02: 사이드바 안쪽 가장자리(뷰어와 맞닿은 얇은 핸들)를 좌우로 끌어
 * 폭을 조절한다. 이 핸들은 더는 도킹 드래그를 겸하지 않는다 — 예전엔
 * 이름표시줄과 같은 로직(useSidebarDockDrag)을 공유해서, 폭을 조절하려고
 * 가장자리를 끌면 그대로 도킹 모드로 전환돼 정작 리사이즈가 안 됐다
 * (사용자 재현 보고). 도킹 방향에 따라 커서를 밀어야 하는 부호가 반대다 —
 * 왼쪽 도킹은 핸들이 오른쪽 끝에 있어 오른쪽으로 밀수록 넓어지고, 오른쪽
 * 도킹은 핸들이 왼쪽 끝에 있어 왼쪽으로 밀수록 넓어진다.
 */
export function useSidebarResizeDrag(sidebarId: SidebarId) {
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();

    const { dock, width: startWidth } = currentSidebarState(sidebarId);
    const startX = event.clientX;

    function handlePointerMove(moveEvent: PointerEvent) {
      const deltaX = moveEvent.clientX - startX;
      const signedDelta = dock === "left" ? deltaX : -deltaX;
      useAppStore.getState().setSidebarWidth(sidebarId, clampWidth(startWidth + signedDelta));
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return handlePointerDown;
}
