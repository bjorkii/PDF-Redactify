import type { SidebarId } from "../store/appStore";
import { useSidebarResizeDrag } from "../hooks/useSidebarResizeDrag";
import "./SidebarDockHandle.css";

/**
 * SIDE-02: 사이드바 폭 리사이즈 핸들(뷰어와 맞닿은 안쪽 가장자리의 얇은
 * 스트립). 도킹 드래그는 이제 이름표시줄(header) 전용이다(SIDE-03,
 * BookmarkSidebar.tsx/RedactionSidebarContent.tsx의 useSidebarDockDrag) —
 * 이 핸들이 도킹까지 겸하면 폭을 조절하려는 드래그가 그대로 도킹 모드로
 * 전환돼버려 리사이즈를 할 수 없었다.
 */
export function SidebarDockHandle({ sidebarId }: { sidebarId: SidebarId }) {
  const handlePointerDown = useSidebarResizeDrag(sidebarId);
  return <div className="sidebar-dock-handle" onPointerDown={handlePointerDown} />;
}
