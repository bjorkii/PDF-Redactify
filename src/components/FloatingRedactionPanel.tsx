import { useAppStore } from "../store/appStore";
import { ko } from "../i18n/ko";
import { FloatingPanel } from "./FloatingPanel";
import { RedactionSidebarContent } from "./RedactionSidebarContent";
import "./Sidebar.css";

// SIDE-04: 블랙마킹 사이드바가 플로팅 상태일 때 자유 이동·리사이즈되는 창.
export function FloatingRedactionPanel() {
  const redactionSidebar = useAppStore((s) => s.redactionSidebar);
  const setRect = useAppStore((s) => s.setRedactionFloatingRect);
  const toggleFloating = useAppStore((s) => s.toggleRedactionFloating);

  if (!redactionSidebar.visible || !redactionSidebar.floating || !redactionSidebar.rect) {
    return null;
  }

  return (
    <FloatingPanel
      sidebarId="redaction"
      rect={redactionSidebar.rect}
      title={ko.redactionSidebar.title}
      dockButtonLabel={ko.redactionSidebar.dock}
      onRectChange={setRect}
      onDock={toggleFloating}
    >
      <RedactionSidebarContent />
    </FloatingPanel>
  );
}
