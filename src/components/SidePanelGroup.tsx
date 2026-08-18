import { useAppStore, type SidebarDock, type SidebarId } from "../store/appStore";
import { BookmarkSidebar } from "./BookmarkSidebar";
import { RedactionSidebar } from "./RedactionSidebar";
import "./SidePanelGroup.css";

const SIDEBAR_COMPONENTS: Record<SidebarId, () => React.ReactElement> = {
  bookmark: BookmarkSidebar,
  redaction: RedactionSidebar,
};

/**
 * SIDE-03: 한 측(좌/우)에 도킹된 사이드바를 배치한다. 하나뿐이면 그대로,
 * 둘이 몰리면(§7.2) sameSideArrangement/sameSideOrder에 따라 세로 분할
 * 또는 가로 나란히로 배치한다.
 */
export function SidePanelGroup({ dock }: { dock: SidebarDock }) {
  const bookmarkSidebar = useAppStore((s) => s.bookmarkSidebar);
  const redactionSidebar = useAppStore((s) => s.redactionSidebar);
  const sameSideArrangement = useAppStore((s) => s.sameSideArrangement);
  const sameSideOrder = useAppStore((s) => s.sameSideOrder);

  const visibleIds = (["bookmark", "redaction"] as SidebarId[]).filter((id) => {
    // SIDE-04: 플로팅 중인 블랙마킹 사이드바는 도킹 레이아웃에서 제외(별도 창으로 렌더).
    if (id === "redaction" && redactionSidebar.floating) return false;
    const sidebar = id === "bookmark" ? bookmarkSidebar : redactionSidebar;
    return sidebar.visible && sidebar.dock === dock;
  });

  if (visibleIds.length === 0) return null;

  if (visibleIds.length === 1) {
    const Component = SIDEBAR_COMPONENTS[visibleIds[0]];
    return <Component />;
  }

  const ordered = sameSideOrder.filter((id) => visibleIds.includes(id));

  if (sameSideArrangement === "stacked") {
    return (
      <div className="side-panel-stack">
        {ordered.map((id) => {
          const Component = SIDEBAR_COMPONENTS[id];
          return <Component key={id} />;
        })}
      </div>
    );
  }

  return (
    <>
      {ordered.map((id) => {
        const Component = SIDEBAR_COMPONENTS[id];
        return <Component key={id} />;
      })}
    </>
  );
}
