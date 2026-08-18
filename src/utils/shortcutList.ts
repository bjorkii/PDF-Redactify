import type { OsKeySymbols } from "./platform";

export interface ShortcutRow {
  action: string;
  /**
   * 키 표기(공백으로 토큰 구분). 토큰 중 `+`·`/`·`또는`는 **구분자**로 옅은
   * 텍스트로, 나머지(⌘·O·↑·클릭 등)는 **칩(kbd)**으로 렌더된다(ShortcutsDialog).
   */
  keys: string;
}

export interface ShortcutSection {
  title: string;
  rows: ShortcutRow[];
}

/**
 * KEY-01(§8): 단축키창 목록 — `shortcuts.md`(사용자 편집 기준)를 단일 출처로
 * 삼아 동기화한다. OS별 modifier 기호(k: osKeySymbols)를 넣어 macOS는 ⌘/⌥/⇧/⌫,
 * Windows는 Ctrl/Alt/Shift/Del로 표기한다. 문자 단축키(C·z·x·a·f·s·d 등)는 한/영
 * 입력과 무관하게 물리 키로 동작한다(다이얼로그 하단 주석). 이 목록을 바꾸면
 * `shortcuts.md`와 (추후) GitHub README도 같은 기준으로 맞춘다.
 */
export function buildShortcutSections(k: OsKeySymbols): ShortcutSection[] {
  const { mod, alt, shift, del } = k;
  return [
    {
      title: "파일 / UI",
      rows: [
        { action: "PDF 파일 열기", keys: `${mod} + O` },
        { action: "블랙마킹 처리 파일 생성", keys: `${mod} + S` },
        { action: "블랙마킹 목록(XLSX) 가져오기", keys: `${mod} + I` },
        { action: "실행 취소 / 다시 실행", keys: `${mod} + Z / ${shift} + ${mod} + Z` },
        { action: "북마크 사이드바 보기 / 숨기기", keys: `${alt} + ${mod} + B` },
        { action: "블랙마킹 사이드바 보기 / 숨기기", keys: `${alt} + ${mod} + L` },
      ],
    },
    {
      title: "뷰어 > 보기·이동",
      rows: [
        { action: "포커스 전환(뷰어 ↔ 북마크)", keys: "Tab" },
        { action: "앞 / 뒤 페이지", keys: "← →" },
        { action: "이전 / 다음 블랙마킹 선택", keys: "Z X 또는 ↑ ↓" },
        { action: "블랙마킹 표시 / 숨김", keys: "F1" },
        { action: "페이지 보기 ↔ 스크롤 보기", keys: "C" },
        { action: "개인정보 탐지 제외영역 보기 / 숨김", keys: "F2" },
      ],
    },
    {
      title: "뷰어 > 블랙마킹 영역 수정",
      rows: [
        { action: "블랙마킹 영역 수동 지정", keys: "클릭 + 드래그" },
        { action: "블랙마킹 영역 복사 / 현재 마우스 위치에 붙여넣기", keys: `${mod} + C / ${mod} + V` },
        { action: "현재 페이지 블랙마킹 전체 선택", keys: `${mod} + A` },
        { action: "다중 선택", keys: `${alt} + 드래그 또는 ${mod} + 클릭` },
        { action: "선택 블랙마킹 영역 삭제", keys: `${del}` },
        { action: "문서 전체 블랙마킹 영역 삭제", keys: `${alt} + ${del}` },
        { action: "선택된 블랙마킹 왼쪽 영역 조정", keys: "A + ← → 또는 ↑ ↓" },
        { action: "선택된 블랙마킹 오른쪽 영역 조정", keys: "F + ← → 또는 ↑ ↓" },
        { action: "선택된 블랙마킹 윗 영역 조정", keys: "S + ← → 또는 ↑ ↓" },
        { action: "선택된 블랙마킹 아래 영역 조정", keys: "D + ← → 또는 ↑ ↓" },
      ],
    },
    {
      title: "블랙마킹 목록 사이드바",
      rows: [
        { action: "선택 이동", keys: "↑ ↓" },
        { action: "다중 선택", keys: `${shift} + ↑ ↓ 또는 ${mod} + 클릭` },
        { action: "선택(다중선택) / 해제", keys: "Space" },
        { action: "문서 전체 블랙마킹 영역 선택", keys: `${mod} + A` },
        { action: "선택 블랙마킹 영역 삭제", keys: `${del}` },
        { action: "전체 삭제", keys: `${alt} + ${del}` },
      ],
    },
    {
      title: "북마크 사이드바",
      rows: [
        { action: "북마크 트리 접기 / 펼치기", keys: "← →" },
        { action: "앞 / 뒤 북마크 이동", keys: "↑ ↓" },
      ],
    },
  ];
}

/** 키 문자열의 토큰이 칩이 아니라 구분자(옅은 텍스트)인지. */
export function isKeySeparator(token: string): boolean {
  return token === "+" || token === "/" || token === "또는";
}
