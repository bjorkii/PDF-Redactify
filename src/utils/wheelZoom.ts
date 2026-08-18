/**
 * §8.1 $확대/축소(cmd-트랙패드 두손가락 / 트랙패드 벌리기 / cmd-휠) 처리용.
 * 핀치·cmd-휠은 짧은 시간에 작은 deltaY가 여러 번 들어오는데, 매 이벤트마다
 * setZoom(→ pdfium 재렌더, §6.1)을 부르면 버벅인다. 그래서 누적치가 임계값을
 * 넘을 때만 한 단계씩 커밋하고, 나머지는 다음 이벤트로 이월한다.
 */
export const WHEEL_ZOOM_THRESHOLD = 40;

export interface WheelZoomResult {
  /** 이번 누적으로 확정된 확대(+)/축소(-) 단계 수. 0이면 아직 임계값 미만. */
  steps: number;
  /** 다음 이벤트로 이월할 나머지 누적치. */
  remaining: number;
}

/**
 * deltaY는 위로 스크롤/벌리기(확대 의도)일 때 음수이므로 부호를 반전해
 * 누적한다 — 결과 steps가 양수면 확대, 음수면 축소.
 */
export function accumulateWheelZoom(accumulated: number, deltaY: number): WheelZoomResult {
  const total = accumulated - deltaY;
  const steps = Math.trunc(total / WHEEL_ZOOM_THRESHOLD);
  return { steps, remaining: total - steps * WHEEL_ZOOM_THRESHOLD };
}
