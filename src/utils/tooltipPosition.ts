export type TooltipAlign = "left" | "right";

/**
 * 잘린 텍스트 툴팁 공통 유틸(BM-04, 추후 LIST-07/UI-01 재사용). 창 폭을 고려해
 * 앵커가 뷰포트 오른쪽에 치우쳐 있으면 툴팁을 앵커의 오른쪽 경계에 맞춰
 * 왼쪽으로 자라게 하고, 그렇지 않으면 앵커의 왼쪽 경계에서 오른쪽으로
 * 자라게 한다 — 툴팁의 실제 폭을 몰라도(렌더 전이라) 화면 밖으로 잘리지
 * 않게 하는 실용적인 규칙(§6.2/§7.1 "창 폭 계산해 툴팁이 잘리지 않게").
 */
export function computeTooltipAlign(
  anchorLeft: number,
  viewportWidth: number,
  threshold = 0.6,
): TooltipAlign {
  return anchorLeft > viewportWidth * threshold ? "right" : "left";
}
