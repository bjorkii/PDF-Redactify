/**
 * §8.1 트랙패드 두 손가락 스크롤로 페이지 전환(페이지네이션 모드). 현재
 * 페이지가 뷰어보다 작아 스크롤할 게 없으면(줌 안 한 보통 상태) 위/아래
 * 경계에 이미 있는 것과 같으므로 스크롤하자마자 곧장 넘어간다. 확대해서
 * 스크롤할 내용이 있으면, 그 경계(맨 위/맨 아래)에 도달한 뒤에도 같은
 * 방향으로 계속 밀 때만 누적해 "덜컹"하는 느낌 이후 다음/이전 페이지로
 * 넘어간다 — 경계가 아니면(페이지 내용을 스크롤하는 중) 누적을 리셋한다.
 *
 * 120이었을 때는 가벼운 두 손가락 터치 한 번만으로도 임계값을 넘어 곧장
 * 페이지가 넘어가 버렸다(사용자 재현: "threshold가 거의 0인 것처럼
 * 느껴짐") — 경계에서 살짝 밀어보는 정도로는 안 넘어가고, 확실히 세게
 * 밀 때만 전환되도록 크게 올렸다. 320으로도 여전히 낮다는 재현 보고
 * (탐지 제외영역을 페이지 가장자리 가까이서 설정하는 도중 스크롤이
 * 살짝만 닿아도 페이지가 넘어가 불편함)를 반영해 다시 크게 올렸다.
 * 경계에서 이 임계값에 도달하기 전까지는 PaginatedView.tsx가 이벤트를
 * 막지 않고 웹뷰의 네이티브 오버스크롤(러버밴드) 바운스를 그대로
 * 통과시켜, 그 자체가 "덜컹"하는 저항감 피드백 역할을 한다.
 */
export const PAGE_TURN_THRESHOLD = 600;

export interface PageTurnResult {
  /** 1=다음 페이지, -1=이전 페이지, 0=아직 전환 안 함. */
  turn: 1 | -1 | 0;
  remaining: number;
}

export function accumulateBoundaryScroll(
  accumulated: number,
  deltaY: number,
  atTop: boolean,
  atBottom: boolean,
): PageTurnResult {
  const scrollingDown = deltaY > 0;
  if (scrollingDown ? !atBottom : !atTop) return { turn: 0, remaining: 0 };

  const total = accumulated + deltaY;
  if (Math.abs(total) < PAGE_TURN_THRESHOLD) return { turn: 0, remaining: total };
  return { turn: scrollingDown ? 1 : -1, remaining: 0 };
}
