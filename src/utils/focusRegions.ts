export type TabTarget = "viewer" | "bookmark";

/**
 * KEY-01(§8.4 Tab): Tab은 툴바 등 다른 요소를 거치지 않고 "뷰어(블랙마킹
 * 목록 포함 — §8.1/§8.3이 하나의 키보드 도메인으로 통합됨) ↔ 북마크
 * 사이드바"만 오가는 2단 전환이다. 블랙마킹 목록은 더 이상 Tab의 독립된
 * 대상이 아니다(SIDE-05 포커스 테두리도 안 뜸) — 뷰어 쪽 도메인 안에
 * 있는 것으로 취급된다. 그래서 "북마크 사이드바 안"만 특수 케이스(뷰어로
 * 되돌림)로 다루고, 그 외 나머지 전부 — 뷰어·블랙마킹 목록은 물론
 * 툴바·포커스가 아예 없는 상태까지 — 는 전부 북마크 사이드바로 전환한다
 * (보이는 경우에만). 입력창 편집 중·다이얼로그 안처럼 Tab을 가로채면 안
 * 되는 예외는 이 함수 호출 전에 상위(tabFocus.ts)에서 걸러낸다.
 */
export function resolveTabTarget(focusedBookmarkSidebar: boolean, bookmarkVisible: boolean): TabTarget | null {
  if (focusedBookmarkSidebar) return "viewer";
  return bookmarkVisible ? "bookmark" : null;
}
