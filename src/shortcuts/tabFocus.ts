import { resolveTabTarget, type TabTarget } from "../utils/focusRegions";

function isFocusInBookmarkSidebar(): boolean {
  return !!document.activeElement?.closest('[data-sidebar-id="bookmark"]');
}

function focusRegion(target: TabTarget): void {
  const selector = target === "viewer" ? '[data-focus-region="viewer"]' : '[data-sidebar-id="bookmark"]';
  document.querySelector<HTMLElement>(selector)?.focus();
}

/**
 * Tab을 가로채면 안 되는 경우: 입력창(구분 드롭박스·내용 입력·색상 picker
 * 등)을 편집 중이거나, 모달 다이얼로그(단축키창·색상 설정·가져오기 확인·
 * 불일치 확인) 안에서 자체적인 Tab 이동이 필요할 때. 이런 경우엔 항상
 * 브라우저 기본 Tab 동작에 맡긴다. Enter(항목 편집모드 진입)·C(보기 모드
 * 전환) 같은 새 전역 단축키도 같은 이유로 이 판정을 그대로 재사용한다
 * (App.tsx) — 안 그러면 필터 팝오버 입력창에서 Enter로 필터를 적용하려는
 * 순간 전역 핸들러가 먼저(capture 단계) 가로채 엉뚱하게 편집모드를
 * 열어버리거나, "c"를 타이핑하는 도중 보기 모드가 계속 토글된다.
 */
export function isEditingOrInDialog(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return true;
  if ((active as HTMLElement).isContentEditable) return true;
  return active.closest('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * KEY-01(§8.4 Tab): 전역 Tab 키를 "뷰어(블랙마킹 목록 포함) ↔ 북마크
 * 사이드바" 2단 전환으로 가로챈다. §8.4는 "포커스 전환(뷰어 ↔ 북마크
 * 사이드바)"만 명시하므로 툴바 등 다른 요소는 절대 거치지 않는다 —
 * 그래서 포커스가 이 두 영역 어디에도 없을 때도(툴바, 포커스 없음,
 * 블랙마킹 목록) 북마크 사이드바로 보낸다(resolveTabTarget 참고). 대상
 * 판단 자체는 resolveTabTarget(순수 함수)이 맡고, 여기서는
 * document.activeElement 조회 + focus() 호출 같은 DOM 연동, 그리고 입력창/
 * 다이얼로그 예외 처리만 담당한다.
 *
 * Tauri 웹뷰(WKWebView 등)는 Tab의 기본 포커스 이동을 JS preventDefault와
 * 별개로 처리하는 경우가 있어, 같은 이벤트 틱에 focus()를 걸어도 그 직후
 * 네이티브 쪽이 다시 되돌려버릴 수 있다. 그래서 preventDefault/
 * stopPropagation은 즉시 호출하되, 실제 focus() 적용은 다음 애니메이션
 * 프레임으로 미뤄 항상 우리가 마지막에 포커스를 확정짓게 한다.
 */
export function handleTabKeyDown(
  event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">,
  bookmarkVisible: boolean,
): void {
  if (event.key !== "Tab") return;
  if (isEditingOrInDialog()) return;

  const target = resolveTabTarget(isFocusInBookmarkSidebar(), bookmarkVisible);
  if (!target) return;

  event.preventDefault();
  event.stopPropagation();
  requestAnimationFrame(() => focusRegion(target));
}
