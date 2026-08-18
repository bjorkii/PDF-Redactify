import { goToNextPage, goToPreviousPage } from "../services/pdfService";
import { selectAdjacentReviewItem } from "../services/reviewItemActions";
import { applyKeyboardResize, heldResizeEdges, noteResizeModifierDown } from "../services/keyboardBboxResize";
import { physicalLetter } from "./platform";
import { useAppStore } from "../store/appStore";

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/**
 * SPEC §8.1: 뷰어 영역 포커스 중 ← / → = 앞/뒤 페이지 이동, ↑ / ↓(shift+←/→
 * 별칭) = 이전/다음 블랙마킹 항목 선택 이동. PaginatedView/ScrollView 두 보기
 * 모드가 동일하게 지원해야 하므로(§6.1) 한 곳에 모아 공유한다 — 예전엔
 * PaginatedView에만 있었고 ScrollView는 아예 키 핸들러가 없어, 연속 스크롤
 * 모드로 전환하면 방향키가 먹통이 되는(포커스를 잃은 것처럼 보이는) 원인이었다.
 *
 * B-5(EDIT-16): z / x = 이전/다음 bbox 선택 이동. ↑/↓과 같은 이동이지만,
 * 화살표는 키보드 리사이즈(B-6, a/f/s/d + 화살표)에 물려 있어 리사이즈 중에도
 * 순수 선택 이동을 하려면 화살표를 쓰지 않는 별도 키가 필요하다. **정확히 한
 * 항목만 선택**됐을 때만 동작한다(그룹 선택 중엔 이동 대상이 모호하므로 무시).
 *
 * Delete/Backspace(선택 항목 삭제)는 포커스 위치와 무관해야 하고 특히 활성 행이
 * 가상화로 언마운트돼도 동작해야 하므로 전역 핸들러(App.tsx)로 일원화했다 —
 * 여기서(그리고 RedactionListRow에서) 중복 처리하지 않는다.
 */
export function handleViewerNavigationKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
  const noMods = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

  // B-6/B-7(EDIT-17): 변 수식어(a/f/s/d)를 누르고 있는지 추적한다. 수식어 키
  // 자체는 다른 동작이 없다(누른 채 화살표를 눌러야 리사이즈). cmd-s/cmd-a 등
  // 조합은 여기서 잡지 않도록 수식어 없는 경우로 한정한다. 한/영 무관(event.code).
  if (noMods && noteResizeModifierDown(event)) {
    return;
  }
  // 변 수식어가 눌린 채 화살표면, 페이지/항목 이동 대신 그 변을 민다. 수식어가
  // 눌려 있는 동안엔 화살표를 리사이즈 전용으로 점유해(축이 안 맞아도 이동으로
  // 새지 않게) 실수로 페이지가 넘어가지 않게 한다.
  if (noMods && heldResizeEdges().length > 0 && ARROW_KEYS.has(event.key)) {
    event.preventDefault();
    applyKeyboardResize(event.key);
    return;
  }

  if (event.key === "ArrowLeft" && !event.shiftKey) {
    event.preventDefault();
    void goToPreviousPage();
  } else if (event.key === "ArrowRight" && !event.shiftKey) {
    event.preventDefault();
    void goToNextPage();
  } else if (event.key === "ArrowUp" || (event.key === "ArrowLeft" && event.shiftKey)) {
    event.preventDefault();
    selectAdjacentReviewItem(-1);
  } else if (event.key === "ArrowDown" || (event.key === "ArrowRight" && event.shiftKey)) {
    event.preventDefault();
    selectAdjacentReviewItem(1);
  } else if (noMods && isSingleSelection()) {
    // B-5(EDIT-16): z/x = 이전/다음 bbox 선택. 한/영 무관(물리 키 위치).
    const letter = physicalLetter(event) ?? event.key.toLowerCase();
    if (letter === "z" || letter === "x") {
      event.preventDefault();
      selectAdjacentReviewItem(letter === "z" ? -1 : 1);
    }
  }
}

/** 정확히 한 항목만 선택됐는지(커서 단독, 또는 마크 1개). B-5 게이트. */
function isSingleSelection(): boolean {
  const { selectedItemId, selectedItemIds } = useAppStore.getState();
  return selectedItemId != null && selectedItemIds.size <= 1;
}
