import type { ReactNode } from "react";
import type { SidebarDock, SidebarId } from "../store/appStore";
import { SidebarDockHandle } from "./SidebarDockHandle";
import "./Sidebar.css";

interface SidebarShellProps {
  sidebarId: SidebarId;
  dock: SidebarDock;
  /** SIDE-02: 안쪽 가장자리 핸들로 조절한 폭(px) — Sidebar.css의 기본값을 덮는다. */
  width: number;
  children: ReactNode;
  /** BM-03 등 사이드바별 방향키 처리를 위한 훅. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /**
   * Tab으로 도달 가능하고 SIDE-05 포커스 테두리를 보이는 독립 키보드
   * 영역인지. 기본 true(북마크 사이드바). 블랙마킹 목록은 뷰어와 하나의
   * 키보드 도메인으로 통합돼(§8.1/§8.3) 더 이상 Tab의 별도 대상이 아니므로
   * false로 넘긴다 — 클릭으로는 여전히 개별 행에 포커스가 가지만(수정·
   * 제외 등), 이 바깥 wrapper 자체는 포커스 테두리 대상에서 빠진다.
   */
  tabFocusable?: boolean;
}

/**
 * 사이드바 공통 뼈대(SIDE-02): 도킹 방향에 맞춰 핸들을 뷰어와 맞닿은 안쪽
 * 가장자리에 배치한다(좌측 도킹→오른쪽 끝, 우측 도킹→왼쪽 끝).
 * SIDE-05: focus-region 클래스로 포커스 시 테두리 강조(§7.4) — tabFocusable일 때만.
 */
export function SidebarShell({ sidebarId, dock, width, children, onKeyDown, tabFocusable = true }: SidebarShellProps) {
  const handle = <SidebarDockHandle sidebarId={sidebarId} />;

  return (
    <div
      className={["sidebar", tabFocusable && "focus-region", dock].filter(Boolean).join(" ")}
      style={{ width }}
      tabIndex={tabFocusable ? 0 : undefined}
      onKeyDown={onKeyDown}
      data-sidebar-id={sidebarId}
    >
      {dock === "right" && handle}
      <div className="sidebar-content">{children}</div>
      {dock === "left" && handle}
    </div>
  );
}
