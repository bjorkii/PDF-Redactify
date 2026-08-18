import { useAppStore, type SidebarId } from "../store/appStore";
import { computeDockGuideShape } from "../utils/dockGuide";

function otherSidebar(sidebarId: SidebarId) {
  const state = useAppStore.getState();
  return sidebarId === "bookmark" ? state.redactionSidebar : state.bookmarkSidebar;
}

/**
 * SIDE-02/03: 사이드바 도킹 드래그 공통 로직 — 전용 핸들(SidebarDockHandle)과
 * 사이드바 이름표시줄(header) 둘 다 이 pointerdown 핸들러를 그대로 쓴다.
 * 드래그하는 동안 커서 위치로 도킹 가이드 형태를 계산해(store.dockDrag)
 * 오버레이에 반영하고, 놓으면 해당 형태에 맞춰 도킹·배치를 확정한다
 * (빈 측 도킹 / 세로분할 / 가로나란히).
 */
export function useSidebarDockDrag(sidebarId: SidebarId) {
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();

    const computeShape = (clientX: number) => {
      const other = otherSidebar(sidebarId);
      const occupiedDock = other.visible ? other.dock : null;
      return computeDockGuideShape(clientX, window.innerWidth, occupiedDock, other.width);
    };

    useAppStore.getState().setDockDrag({ sidebarId, shape: computeShape(event.clientX) });

    function handlePointerMove(moveEvent: PointerEvent) {
      useAppStore.getState().setDockDrag({ sidebarId, shape: computeShape(moveEvent.clientX) });
    }

    function handlePointerUp(upEvent: PointerEvent) {
      useAppStore.getState().applyDockDrop(sidebarId, computeShape(upEvent.clientX));
      useAppStore.getState().setDockDrag(null);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return handlePointerDown;
}
