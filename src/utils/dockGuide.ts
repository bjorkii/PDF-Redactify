import type { SidebarDock } from "../store/appStore";

/** Sidebar.css의 고정 폭과 맞춘 값(SIDE-02/03 드래그 판정 기준). */
export const SIDEBAR_WIDTH_PX = 240;

/**
 * SIDE-02: 드래그 중인 커서의 x좌표가 뷰포트 좌/우 어느 쪽에 더 가까운지로
 * 도킹 대상을 결정한다(§7.2 가이드 오버레이 기준).
 */
export function computeTargetDock(clientX: number, viewportWidth: number): SidebarDock {
  return clientX < viewportWidth / 2 ? "left" : "right";
}

/**
 * SIDE-03: 목표 측에 이미 다른 사이드바가 있을 때(동일 측 몰림) 가이드 형태를
 * 세분화한다.
 * - "edge": 목표 측이 비어 있음 → 그 측 전체에 도킹(SIDE-02 기본 동작)
 * - "overlay": 기존 사이드바 위에 겹침 → 세로 분할(위/아래로 스택)
 * - "insertOuter": 기존 사이드바보다 창 가장자리에 더 가까움 → 가로 나란히,
 *   드래그 중인 사이드바가 바깥쪽(창 가장자리 쪽)
 * - "insertInner": 기존 사이드바보다 뷰어에 더 가까움 → 가로 나란히,
 *   드래그 중인 사이드바가 안쪽(뷰어 쪽)
 */
export type DockGuideShape =
  | { kind: "edge"; dock: SidebarDock }
  | { kind: "overlay"; dock: SidebarDock }
  | { kind: "insertOuter"; dock: SidebarDock }
  | { kind: "insertInner"; dock: SidebarDock };

export function computeDockGuideShape(
  clientX: number,
  viewportWidth: number,
  occupiedDock: SidebarDock | null,
  sidebarWidth: number = SIDEBAR_WIDTH_PX,
): DockGuideShape {
  const dock = computeTargetDock(clientX, viewportWidth);

  if (occupiedDock !== dock) {
    return { kind: "edge", dock };
  }

  // 창 가장자리(0)를 기준으로 한 거리로 통일(오른쪽 도킹이면 뒤집어서 계산).
  const distanceFromWindowEdge = dock === "left" ? clientX : viewportWidth - clientX;
  const third = sidebarWidth / 3;

  if (distanceFromWindowEdge < third) return { kind: "insertOuter", dock };
  if (distanceFromWindowEdge > sidebarWidth - third) return { kind: "insertInner", dock };
  return { kind: "overlay", dock };
}
