import { isModifierPressed, physicalLetter } from "../utils/platform";

export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "key" | "preventDefault"
> &
  Partial<Pick<KeyboardEvent, "code">>;

export interface GlobalShortcutActions {
  openFile: () => void;
  toggleBookmarkSidebar: () => void;
  toggleRedactionSidebar: () => void;
  undo: () => void;
  redo: () => void;
  toggleBboxVisible: () => void;
  saveRedactedDocument: () => void;
  importReviewItems: () => void;
}

/**
 * SPEC §8.1/§8.4 전역 단축키(OS modifier 자동 매핑, INF-05 활용):
 * - cmd/ctrl-O: 파일 열기
 * - alt-cmd/ctrl-B: 북마크 사이드바 토글(SIDE-01)
 * - alt-cmd/ctrl-L: 블랙마킹 사이드바 토글(SIDE-01)
 * - cmd/ctrl-Z: undo, shift-cmd/ctrl-Z: redo(STATE-06)
 * - cmd/ctrl-S: 블랙마킹 반영 새 파일 생성(저장, SAVE-03)
 * - cmd/ctrl-I: 블랙마킹 정보 가져오기(IO-02, KEY-01)
 * - F1: bbox 표시/숨기기(modifier 불필요, EDIT-04) — OS 도움말보다 우선 점유
 *
 * 순수 함수로 분리해 실제 DOM 없이 단위테스트할 수 있게 한다. 전체 단축키
 * 바인딩 프레임워크·단축키창은 KEY-01에서 다룬다.
 */
export function handleGlobalKeyDown(event: ShortcutKeyEvent, actions: GlobalShortcutActions): void {
  if (event.key === "F1") {
    event.preventDefault();
    actions.toggleBboxVisible();
    return;
  }

  if (!isModifierPressed(event)) return;
  // 한/영 무관: 물리 키 위치의 라틴 글자를 우선 쓰고, 글자 키가 아니면 event.key.
  const key = physicalLetter(event) ?? event.key.toLowerCase();

  if (!event.altKey && key === "o") {
    event.preventDefault();
    actions.openFile();
  } else if (event.altKey && key === "b") {
    event.preventDefault();
    actions.toggleBookmarkSidebar();
  } else if (event.altKey && key === "l") {
    event.preventDefault();
    actions.toggleRedactionSidebar();
  } else if (!event.altKey && key === "z" && event.shiftKey) {
    event.preventDefault();
    actions.redo();
  } else if (!event.altKey && key === "z") {
    event.preventDefault();
    actions.undo();
  } else if (!event.altKey && key === "s") {
    event.preventDefault();
    actions.saveRedactedDocument();
  } else if (!event.altKey && key === "i") {
    event.preventDefault();
    actions.importReviewItems();
  }
}
