import type { ReactNode } from "react";
import type { SidebarId } from "../store/appStore";
import {
  clampToViewport,
  computeDirectionalResizedRect,
  computeMovedRect,
  type FloatingRect,
  type ResizeDirection,
} from "../utils/floatingPanel";
import { PinOffIcon } from "./icons";
import "./FloatingPanel.css";

/** SIDE-10: 4변 + 4모서리 리사이즈 핸들. */
const RESIZE_DIRECTIONS: ResizeDirection[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

interface FloatingPanelProps {
  sidebarId: SidebarId;
  rect: FloatingRect;
  title: string;
  dockButtonLabel: string;
  onRectChange: (rect: FloatingRect) => void;
  onDock: () => void;
  children: ReactNode;
}

/**
 * SIDE-04: 플로팅 패널 공통 뼈대 — 제목표시줄 드래그로 이동, 모서리 드래그로
 * 리사이즈. 현재 블랙마킹 사이드바만 플로팅을 지원하는데, 블랙마킹
 * 목록은 뷰어와 하나의 키보드 도메인으로 통합돼(§8.1/§8.3) Tab의 대상도
 * SIDE-05 포커스 테두리 대상도 아니므로, 이 wrapper는 tabIndex/focus-region을
 * 갖지 않는다(§7.4/§8.4) — 안의 행은 클릭하면 여전히 개별적으로 포커스된다.
 */
export function FloatingPanel({
  sidebarId,
  rect,
  title,
  dockButtonLabel,
  onRectChange,
  onDock,
  children,
}: FloatingPanelProps) {
  function handleHeaderPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;

    function handleMove(moveEvent: PointerEvent) {
      const moved = computeMovedRect(rect, startX, startY, moveEvent.clientX, moveEvent.clientY);
      onRectChange(clampToViewport(moved, window.innerWidth, window.innerHeight));
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function handleResizePointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    direction: ResizeDirection,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;

    function handleMove(moveEvent: PointerEvent) {
      const resized = computeDirectionalResizedRect(
        rect,
        direction,
        startX,
        startY,
        moveEvent.clientX,
        moveEvent.clientY,
      );
      // n/w 방향 리사이즈로 상단이 뷰포트 위로 밀려 헤더가 사라지지 않게 clamp.
      onRectChange(clampToViewport(resized, window.innerWidth, window.innerHeight));
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <div
      className="floating-panel"
      data-sidebar-id={sidebarId}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <div className="floating-panel-header" onPointerDown={handleHeaderPointerDown}>
        <span className="floating-panel-title">{title}</span>
        <button type="button" className="icon-button" title={dockButtonLabel} aria-label={dockButtonLabel} onClick={onDock}>
          <PinOffIcon />
        </button>
      </div>
      <div className="floating-panel-body">{children}</div>
      {RESIZE_DIRECTIONS.map((direction) => (
        <div
          key={direction}
          className={`floating-panel-resize-handle floating-panel-resize-${direction}`}
          onPointerDown={(event) => handleResizePointerDown(event, direction)}
        />
      ))}
    </div>
  );
}
