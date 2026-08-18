import { useAppStore } from "../store/appStore";
import { SidebarShell } from "./SidebarShell";
import { RedactionSidebarContent } from "./RedactionSidebarContent";

// SPEC §6.4 블랙마킹 목록표 사이드바(도킹 모드). 플로팅 중엔 SidePanelGroup이
// 이 컴포넌트를 렌더하지 않고 FloatingRedactionPanel이 대신 표시한다(SIDE-04).
// tabFocusable=false: 뷰어와 하나의 키보드 도메인으로 통합돼(§8.1/§8.3)
// Tab의 별도 대상도, SIDE-05 포커스 테두리 대상도 아니다(§7.4/§8.4).
export function RedactionSidebar() {
  const dock = useAppStore((s) => s.redactionSidebar.dock);
  const width = useAppStore((s) => s.redactionSidebar.width);

  return (
    <SidebarShell sidebarId="redaction" dock={dock} width={width} tabFocusable={false}>
      <RedactionSidebarContent />
    </SidebarShell>
  );
}
