import { Toolbar } from "./Toolbar";
import { Viewer } from "./Viewer";
import { SidePanelGroup } from "./SidePanelGroup";
import { StatusBar } from "./StatusBar";
import { DockGuideOverlay } from "./DockGuideOverlay";
import { FloatingRedactionPanel } from "./FloatingRedactionPanel";
import { IdentityMismatchDialog } from "./IdentityMismatchDialog";
import { ColorSettingsDialog } from "./ColorSettingsDialog";
import { ImportConfirmDialog } from "./ImportConfirmDialog";
import { DetectionConfirmDialog } from "./DetectionConfirmDialog";
import { SaveFilterWarningDialog } from "./SaveFilterWarningDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { DragDropOverlay } from "./DragDropOverlay";
import { BusyOverlay } from "./BusyOverlay";
import "./AppShell.css";

// SPEC §7.1 기본 구조: 툴바 / (북마크 사이드바 + 뷰어 + 블랙마킹 목록 사이드바) / 상태바.
export function AppShell() {
  return (
    <div className="app-shell">
      <Toolbar />
      <div className="app-body">
        <SidePanelGroup dock="left" />
        <Viewer />
        <SidePanelGroup dock="right" />
        <DockGuideOverlay />
      </div>
      {/* UI-PROGRESS: busy 시 본체 위 입력 차단(상태바보다 아래 스택). */}
      <BusyOverlay />
      <StatusBar />
      <FloatingRedactionPanel />
      <IdentityMismatchDialog />
      <ColorSettingsDialog />
      <ImportConfirmDialog />
      <DetectionConfirmDialog />
      <SaveFilterWarningDialog />
      <ShortcutsDialog />
      <DragDropOverlay />
    </div>
  );
}
