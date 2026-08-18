const FOCUSABLE_SELECTOR = "input, select, textarea, button, a[href], [tabindex]";

/**
 * 인터랙티브 요소가 아닌 곳(툴바 빈 공간, 블랙마킹 사이드바의 목록 외
 * 영역 — 헤더 여백·버튼 사이 간격 등)을 클릭하면, 브라우저 기본 동작
 * (mousedown 시 가장 가까운 포커스 가능 조상으로 포커스를 옮기고, 그런
 * 조상이 없으면 body로 보냄)이 그 순간까지 있던 포커스를 통째로 날려버린다.
 * 그러면 뷰어에도 사이드바에도 포커스가 없는 "무주공산" 상태가 되어
 * 방향키를 포함한 모든 포커스 기반 단축키가 먹통이 된다.
 *
 * 클릭 대상(또는 그 조상)이 실제 인터랙티브 요소가 아니면 mousedown의
 * 기본 동작 자체를 막아, 클릭 직전의 포커스가 그대로 유지되게 한다.
 * click 이벤트 자체(예: 다이얼로그 배경 클릭으로 닫기)는 그대로 발생하므로
 * 영향 없다 — mousedown의 기본 동작(포커스 이동/텍스트 선택 시작)만 막는다.
 */
export function installBlankClickFocusGuard(): () => void {
  function handleMouseDown(event: MouseEvent) {
    const target = event.target as Element | null;
    if (target?.closest(FOCUSABLE_SELECTOR)) return;
    event.preventDefault();
  }

  window.addEventListener("mousedown", handleMouseDown);
  return () => window.removeEventListener("mousedown", handleMouseDown);
}
