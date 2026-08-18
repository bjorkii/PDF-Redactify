import { useAppStore, type AppState } from "../store/appStore";
import { assembleSidecarDocument } from "./sidecarAssembly";
import { saveSidecar } from "./sidecarService";

/** WBS STATE-03: "일정 지연 후 자동 기록" — 구체적인 값은 미지정이라 임의 채택. */
export const AUTOSAVE_DEBOUNCE_MS = 800;

/** view_state·source에 영향을 주는 필드만 뽑아 얕은 비교로 변동을 감지한다. */
function selectAutosaveFields(state: AppState) {
  return {
    document: state.document,
    currentPageIndex: state.currentPageIndex,
    zoomScale: state.zoomScale,
    selectedItemId: state.selectedItemId,
    sort: state.sort,
    bookmarkSidebar: state.bookmarkSidebar,
    redactionSidebar: state.redactionSidebar,
    reviewItems: state.reviewItems,
    history: state.history,
  };
}

type AutosaveFields = ReturnType<typeof selectAutosaveFields>;

function fieldsEqual(a: AutosaveFields, b: AutosaveFields): boolean {
  return (
    a.document === b.document &&
    a.currentPageIndex === b.currentPageIndex &&
    a.zoomScale === b.zoomScale &&
    a.selectedItemId === b.selectedItemId &&
    a.sort === b.sort &&
    a.bookmarkSidebar === b.bookmarkSidebar &&
    a.redactionSidebar === b.redactionSidebar &&
    a.reviewItems === b.reviewItems &&
    a.history === b.history
  );
}

/**
 * STATE-03(§6.8): store에서 view_state/source 관련 필드가 바뀔 때마다
 * `AUTOSAVE_DEBOUNCE_MS` 후 sidecar를 자동 저장한다. 문서를 닫거나(document
 * null) 아직 안 열었으면 저장하지 않는다. 앱 부팅 시 한 번만 호출하고, 반환된
 * 함수로 구독을 해제한다.
 */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let previous = selectAutosaveFields(useAppStore.getState());

  const unsubscribe = useAppStore.subscribe((state) => {
    const next = selectAutosaveFields(state);
    if (fieldsEqual(previous, next)) return;
    previous = next;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const sidecarDocument = assembleSidecarDocument();
      if (!sidecarDocument) return;
      void saveSidecar(sidecarDocument.source.path, sidecarDocument);
    }, AUTOSAVE_DEBOUNCE_MS);
  });

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
