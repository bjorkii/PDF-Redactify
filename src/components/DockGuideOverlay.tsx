import type { CSSProperties } from "react";
import { useAppStore } from "../store/appStore";
import { SIDEBAR_WIDTH_PX } from "../utils/dockGuide";
import "./DockGuideOverlay.css";

const INSERT_STRIP_PX = 24;

// SIDE-02/03: 드래그 중 도킹 형태(겹침(세로분할)/바깥·안쪽 삽입(가로나란히))를
// 실시간으로 보여주는 가이드 오버레이(§7.2). "edge"(그 측에 이미 도킹된
// 사이드바가 없는 빈 자리)는 순서를 정할 필요가 없는 단순한 경우라 굳이
// 가이드를 보여주지 않는다(사용자 피드백 — 충돌이 있을 때만 필요).
export function DockGuideOverlay() {
  const dockDrag = useAppStore((s) => s.dockDrag);
  if (!dockDrag) return null;

  const { shape } = dockDrag;
  if (shape.kind === "edge") return null;

  const isLeft = shape.dock === "left";
  let style: CSSProperties;

  switch (shape.kind) {
    case "overlay":
      style = isLeft ? { left: 0, width: SIDEBAR_WIDTH_PX } : { right: 0, width: SIDEBAR_WIDTH_PX };
      break;
    case "insertOuter":
      style = isLeft ? { left: 0, width: INSERT_STRIP_PX } : { right: 0, width: INSERT_STRIP_PX };
      break;
    case "insertInner":
      style = isLeft
        ? { left: SIDEBAR_WIDTH_PX - INSERT_STRIP_PX, width: INSERT_STRIP_PX }
        : { right: SIDEBAR_WIDTH_PX - INSERT_STRIP_PX, width: INSERT_STRIP_PX };
      break;
  }

  return <div className={`dock-guide-overlay dock-guide-${shape.kind}`} style={style} />;
}
