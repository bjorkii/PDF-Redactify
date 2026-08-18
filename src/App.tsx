import { useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { subscribeBackendStatus } from "./services/statusBus";
import { subscribeOperationProgress } from "./services/progressBus";
import { openPdf } from "./services/pdfService";
import { startAutosave } from "./services/autosave";
import { startColorSettingsSync } from "./services/colorSettingsSync";
import { loadGlobalColorSettings } from "./services/colorSettingsService";
import { loadDetectionCategories } from "./services/detectionCategoriesService";
import { startWindowTitleSync } from "./services/windowTitle";
import { startDragDropOpen } from "./services/dragDropOpen";
import { saveRedactedDocument } from "./services/saveService";
import { importReviewItems } from "./services/importService";
import {
  deleteAllReviewItems,
  deleteSelectedReviewItem,
  isAnySelectedItemVisibleInList,
  selectAllReviewItemsInList,
  selectAllReviewItemsOnPage,
} from "./services/reviewItemActions";
import { copySelectedBBoxes, pasteBBoxes, startViewerMouseTracking } from "./services/bboxClipboard";
import { installResizeModifierTracking } from "./services/keyboardBboxResize";
import { useAppStore } from "./store/appStore";
import { handleGlobalKeyDown } from "./shortcuts/globalShortcuts";
import { handleTabKeyDown, isEditingOrInDialog } from "./shortcuts/tabFocus";
import { installBlankClickFocusGuard } from "./shortcuts/preserveFocus";
import { isModifierPressed, physicalLetter } from "./utils/platform";
import "./App.css";

function App() {
  const colorSettings = useAppStore((s) => s.colorSettings);
  const bookmarkSidebarVisible = useAppStore((s) => s.bookmarkSidebar.visible);

  // 툴바 빈 공간·사이드바의 비인터랙티브 영역을 클릭해도 포커스가 body로
  // 빠지지 않게 한다(preserveFocus.ts) — 안 그러면 뷰어/사이드바 어디에도
  // 포커스가 없어져 방향키를 포함한 모든 단축키가 먹통이 된다.
  useEffect(() => {
    return installBlankClickFocusGuard();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribeBackendStatus().then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // UI-PROGRESS: 저장/내보내기 진행률 이벤트 구독(상태바 progress bar + %).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribeOperationProgress().then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    return startAutosave();
  }, []);

  useEffect(() => {
    return startColorSettingsSync();
  }, []);

  // COLOR-02(§7.3/§7.4/§9.4): 문서/폴더 단위 설정은 문서를 열어야만 반영되는데,
  // 그전까지(앱을 막 띄운 직후)는 하드코딩된 기본 파랑으로 보였다가 문서를
  // 열어야 사용자가 설정했던 색으로 바뀌는 게 어색해서, 앱 전역 기본값(마지막
  // 으로 쓰던 색)을 부팅 시 곧바로 불러와 반영한다. 문서를 열면 그 폴더의
  // 설정이 있는 한 이 값을 덮어쓴다(pdfService.ts).
  useEffect(() => {
    let cancelled = false;
    void loadGlobalColorSettings().then((settings) => {
      if (!cancelled && settings) useAppStore.getState().setColorSettings(settings);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // DET-OPT: 저장된 자동검출 제외 카테고리를 앱 시작 시 불러온다.
  useEffect(() => {
    void loadDetectionCategories();
  }, []);

  useEffect(() => {
    return startWindowTitleSync();
  }, []);

  useEffect(() => {
    return startDragDropOpen();
  }, []);

  // EDIT-12: bbox 붙여넣기 위치(현재 마우스)를 추적한다.
  useEffect(() => {
    return startViewerMouseTracking();
  }, []);

  // B-6/B-7(EDIT-17): 변 리사이즈 수식어(a/f/s/d)의 keyup/blur 홀드 해제를
  // 전역에서 추적한다(뷰어 keydown 핸들러가 누름을 기록, 여기서 놓음을 기록).
  useEffect(() => {
    return installResizeModifierTracking();
  }, []);

  // KEY-01(§8.4 Tab): 앱을 처음 띄웠을 때 아무 데도 포커스가 없으면 Tab이
  // 어디로도 못 되돌아가는 것처럼 보인다. 뷰어를 기본 포커스로 잡아두면
  // 첫 Tab부터 곧바로 북마크 사이드바로 전환된다.
  useEffect(() => {
    document.querySelector<HTMLElement>('[data-focus-region="viewer"]')?.focus();
  }, []);

  // SIDE-01(§8.4): 북마크 사이드바를 숨기면 그 사이드바(SidePanelGroup —
  // visible이 false면 통째로 unmount) 안에 있던 포커스가 어디로도 안
  // 옮겨지고 그냥 사라진다 — resolveTabTarget(focusRegions.ts)도 "북마크
  // 사이드바가 안 보이면" Tab을 아예 가로채지 않으므로(null 반환), 그
  // 상태에서 Tab을 누르면 브라우저 네이티브 탭 순서(툴바 아이콘들)로
  // 빠져버린다(사용자 재현). 숨기는 순간 뷰어로 포커스를 강제 지정해두면
  // 이 문제가 없다. 다시 보이더라도(visible→true) 이 효과는 다시 실행되지
  // 않으므로(의존성이 false로 바뀔 때만 의미 있음, 아래 조건) 뷰어 포커스가
  // 그대로 유지된다 — BookmarkSidebar.tsx 쪽에는 마운트 시 자동 포커스하는
  // 코드가 없어 다시 보여도 저절로 옮겨가지 않는다.
  useEffect(() => {
    if (!bookmarkSidebarVisible) {
      document.querySelector<HTMLElement>('[data-focus-region="viewer"]')?.focus();
    }
  }, [bookmarkSidebarVisible]);

  // COLOR-02(§7.3/§7.4): 포커스 강조·사이드바 선택 하이라이트는 앱 전역
  // CSS 변수라서, 여기서 값을 반영해두면 이미 그 변수를 쓰는 모든 곳
  // (포커스 테두리, 목록/북마크 선택 강조 등)에 자동으로 퍼진다.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--focus-color", colorSettings.focus_border_color);
    root.setProperty("--selection-bg", colorSettings.sidebar_selection.background);
    root.setProperty("--selection-fg", colorSettings.sidebar_selection.font);
    root.setProperty("--exclusion-guide-color", colorSettings.exclusion_guide_color);
  }, [colorSettings.focus_border_color, colorSettings.sidebar_selection, colorSettings.exclusion_guide_color]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // UI-PROGRESS: 저장/내보내기 처리 중(busy)에는 중단 버튼(마우스)만 살리고
      // 모든 키보드 조작을 차단한다. 이 핸들러는 window의 capture 단계라 여기서
      // stopImmediatePropagation하면 뷰어/목록/사이드바의 어떤 keydown 핸들러에도
      // 이벤트가 닿지 않는다(전역 키보드 게이트).
      if (useAppStore.getState().busy) {
        event.stopImmediatePropagation();
        event.preventDefault();
        return;
      }

      handleTabKeyDown(event, useAppStore.getState().bookmarkSidebar.visible);

      handleGlobalKeyDown(event, {
        openFile: () => void openPdf(),
        toggleBookmarkSidebar: () => useAppStore.getState().toggleBookmarkSidebar(),
        toggleRedactionSidebar: () => useAppStore.getState().toggleRedactionSidebar(),
        undo: () => useAppStore.getState().undo(),
        redo: () => useAppStore.getState().redo(),
        toggleBboxVisible: () => useAppStore.getState().toggleBboxVisible(),
        saveRedactedDocument: () => void saveRedactedDocument(),
        importReviewItems: () => void importReviewItems(),
      });

      // KEY-01: F2/Enter 역할을 명확히 나눈다(사용자 요청 — 예전엔 F2가
      // 포커스 위치에 따라 "제외영역 토글"과 "목록 항목 편집모드 진입" 둘 중
      // 하나로 다르게 동작해 혼란스러웠다).
      // F2 = 포커스 위치와 무관하게 항상 제외영역 설정 토글. 편집 오버레이는
      // 페이지네이션 모드 전용이므로(appStore.ts setViewMode) 연속 스크롤
      // 모드에서는 무시한다.
      if (event.key === "F2") {
        const appState = useAppStore.getState();
        if (appState.document && appState.viewMode === "paginated") {
          event.preventDefault();
          appState.setExclusionZoneEditMode(!appState.exclusionZoneEditMode);
        }
      }

      // Enter = 포커스 위치와 무관하게(입력창·다이얼로그 안은 제외 — 그
      // 안에서는 Enter가 각자의 커밋/확인 동작을 그대로 해야 한다)
      // 블랙마킹 목록의 현재 선택 항목을 내용 편집모드로 연다.
      // pendingEditItemId는 원래 드래그로 새 bbox를 만든 직후 곧바로
      // 편집모드로 들어가는 데 쓰던 store 필드(RedactionListRow.tsx)를
      // 그대로 재사용한다 — 목록 행이 지금 마운트돼 있든(포커스 중) 뷰어에
      // 포커스가 있어 화면 밖 가상 목록에 있든, 그 행이 마운트되는 순간
      // 이 값을 소비해 편집모드로 들어간다.
      if (event.key === "Enter" && !isEditingOrInDialog()) {
        const { selectedItemId, setPendingEditItemId } = useAppStore.getState();
        if (selectedItemId) {
          event.preventDefault();
          setPendingEditItemId(selectedItemId);
        }
      }

      // C = 보기 모드(페이지네이션 ↔ 연속 스크롤) 전환. 문자 키라 입력창
      // 안에서 타이핑 중일 때는(isEditingOrInDialog) 절대 가로채면 안 되고,
      // modifier가 눌린 경우(특히 연속 스크롤 모드에서 텍스트를 cmd-C로 복사할
      // 때)도 가로채면 안 된다 — 안 그러면 cmd-C가 보기모드 토글로 새어버린다
      // (사용자 재현).
      if (
        physicalLetter(event) === "c" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditingOrInDialog()
      ) {
        event.preventDefault();
        useAppStore.getState().toggleViewMode();
      }

      // LIST-09/LIST-10(§8): Delete/Backspace = 선택 항목(다중 포함) 삭제,
      // Option/Alt+Delete = 전체 삭제. "선택된 항목"에 대한 동작이라 포커스
      // 위치와 무관해야 한다 — 특히 활성 행이 가상화로 언마운트(스크롤 아웃)돼도
      // 삭제가 먹어야 하므로 전역에서 처리한다(예전엔 행/뷰어 각자 처리라
      // 활성 행이 화면 밖이면 Del이 아무 데도 닿지 않았다). 입력창·다이얼로그
      // 안에서는 각자의 삭제(텍스트 지우기)가 우선이므로 가로채지 않는다.
      if ((event.key === "Delete" || event.key === "Backspace") && !isEditingOrInDialog()) {
        const { selectedItemIds, selectedItemId } = useAppStore.getState();
        if (selectedItemIds.size === 0 && !selectedItemId) return;
        if (event.altKey) {
          // Option/Alt+Delete = 전체 삭제(선택 가시성과 무관).
          event.preventDefault();
          deleteAllReviewItems();
        } else if (isAnySelectedItemVisibleInList()) {
          // 안전: 선택 항목이 목록에 하나도 안 보이면 삭제하지 않는다(사용자 요청).
          event.preventDefault();
          deleteSelectedReviewItem();
        }
      }

      // EDIT-13(전체선택): cmd/ctrl-a — 포커스가 블랙마킹 목록에 있으면 문서
      // 전체(필터로 보이는) 항목을, 뷰어에 있으면 현재 페이지의 bbox를 모두
      // 선택한다. cmd-a는 네이티브 전체선택(문서 텍스트·북마크 사이드바까지
      // 파랗게 선택)을 유발하므로, 우리 도메인(뷰어/목록)에서든 아니든 항상
      // preventDefault로 그 기본 동작을 막는다(사용자 요청). 입력창/다이얼로그
      // 편집 중에는 그 안의 전체선택이 정상 동작해야 하므로 제외.
      if (
        isModifierPressed(event) &&
        !event.altKey &&
        !event.shiftKey &&
        physicalLetter(event) === "a" &&
        !isEditingOrInDialog()
      ) {
        event.preventDefault();
        const active = window.document.activeElement;
        if (active?.closest("[data-redaction-scroll]")) {
          selectAllReviewItemsInList();
        } else if (active?.closest('[data-focus-region="viewer"]')) {
          selectAllReviewItemsOnPage(useAppStore.getState().currentPageIndex);
        }
      }

      // EDIT-12(§6.3.2 인접): bbox 복사(cmd/ctrl-C) · 붙여넣기(cmd/ctrl-V,
      // 현재 마우스 위치에 그룹 좌상단 기준·원본 크기). 입력창/다이얼로그
      // 편집 중이거나(=isEditingOrInDialog), 복사 시 실제 텍스트 선택이 있는
      // 동안은 OS 기본 복사/붙여넣기를 방해하지 않도록 가로채지 않는다.
      // 각 동작은 실제로 처리했을 때만(항목이 복사됐거나 붙여넣어졌을 때만)
      // preventDefault한다.
      const modKey = physicalLetter(event) ?? event.key.toLowerCase();
      if (
        isModifierPressed(event) &&
        !event.altKey &&
        !event.shiftKey &&
        (modKey === "c" || modKey === "v") &&
        !isEditingOrInDialog()
      ) {
        if (modKey === "c") {
          const selection = window.getSelection();
          const hasTextSelection = selection != null && !selection.isCollapsed && selection.toString().length > 0;
          if (!hasTextSelection && copySelectedBBoxes()) {
            event.preventDefault();
          }
        } else if (pasteBBoxes()) {
          event.preventDefault();
        }
      }
    }

    // capture 단계에서 먼저 가로챈다 — 일부 웹뷰의 네이티브 Tab 포커스
    // 이동이나 다른 리스너의 stopPropagation보다 앞서 처리되게 하기 위해서다.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  return <AppShell />;
}

export default App;
