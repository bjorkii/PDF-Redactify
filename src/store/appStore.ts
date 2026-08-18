import { create } from "zustand";
import type { DockGuideShape } from "../utils/dockGuide";
import type { FloatingRect } from "../utils/floatingPanel";
import * as historyEngine from "../utils/history";
import type { ReviewItem } from "../types/generated/ReviewItem";
import type { HistoryState } from "../types/generated/HistoryState";
import type { HistoryAction } from "../types/generated/HistoryAction";
import type { RedactifySettings } from "../types/generated/RedactifySettings";

/** src-tauri/src/settings.rs의 default_settings()와 동일 — 사용자가 실제로
 * 바꾸기 전까지는 기존 하드코딩 색상과 동일하게 보이도록 맞춘 기본값. */
export const DEFAULT_COLOR_SETTINGS: RedactifySettings = {
  detected: {
    selected: { background: "#396cd8", border: "#396cd8" },
    unselected: { background: "#e6a000", border: "#e6a000" },
  },
  manual: {
    selected: { background: "#396cd8", border: "#396cd8" },
    unselected: { background: "#e6a000", border: "#e6a000" },
  },
  focus_border_color: "#396cd8",
  sidebar_selection: { background: "#396cd8", font: "#ffffff" },
  exclusion_guide_color: "#ffcc00",
};

export type SidebarDock = "left" | "right";
export type SidebarId = "bookmark" | "redaction";

/** UI-PROGRESS: 진행 중인 장시간 작업의 종류·진행 단위. 백엔드 operation-progress 이벤트와 대응. */
export type OperationKind = "save" | "export";
export interface OperationProgress {
  kind: OperationKind;
  processed: number;
  total: number;
}

/**
 * UI-PROGRESS: 저장/내보내기 완료 후 상태바에 남겨두는 요약 + '열기' 버튼 대상.
 * 다음 상태 메시지(publishStatus)나 새 작업 시작 전까지 유지된다.
 */
export interface OperationResult {
  /** 상태바에 그대로 표시할 완료 문구(요약 포함). */
  message: string;
  /** '열기' 버튼이 시스템 연결 앱으로 열 파일 경로(저장=PDF, 내보내기=xlsx). */
  openPath: string;
}

/** SIDE-03: 같은 측에 두 사이드바가 몰렸을 때의 배치(§7.2). */
export type SidebarArrangement = "sideBySide" | "stacked";

/** SPEC §6.1: 페이지네이션(기본) / 연속 스크롤(가상화). */
export type ViewMode = "paginated" | "scroll";

interface SidebarState {
  visible: boolean;
  dock: SidebarDock;
  /** SIDE-02: 안쪽 가장자리 핸들로 조절하는 폭(px). 문서별로 저장하지 않고
   * 세션 동안만 유지한다(§9.4가 다루는 view_state 스키마 밖). */
  width: number;
}

/** SIDE-04: 블랙마킹 사이드바만 플로팅 분리·리사이즈를 지원한다(§6.4, §5.2). */
interface RedactionSidebarState extends SidebarState {
  floating: boolean;
  rect: FloatingRect | null;
}

const DEFAULT_FLOATING_RECT: FloatingRect = { x: 160, y: 120, width: 320, height: 480 };

/** SIDE-02: 핸들 드래그 중인 사이드바와, 현재 커서 위치가 가리키는 가이드 형태. */
export interface DockDragState {
  sidebarId: SidebarId;
  shape: DockGuideShape;
}

/** Rust pdfium.rs의 PageDimensions와 대응(§5.2 page_dimensions, camelCase IPC 응답). */
export interface PageDimensionsEntry {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  textLayerStatus: "HasText" | "NoText";
}

/**
 * DET-07(신규): 페이지별 자동검출 제외 영역. Rust
 * `sidecar::PageExclusionMargins`/`PageExclusionZone`과 대응 — pageIndex는
 * ReviewItem.page와 동일하게 0-indexed(pageDimensions의 1-indexed
 * pageNumber와는 다른 관례이니 주의).
 */
export interface PageExclusionMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PageExclusionZoneEntry {
  pageIndex: number;
  margins: PageExclusionMargins;
}

export interface PdfDocumentInfo {
  path: string;
  filename: string;
  pageCount: number;
  pageDimensions: PageDimensionsEntry[];
  /** §4.4 파일 동일성 판정에 쓰이는 정규화 텍스트 해시("sha256:..."). */
  textFingerprint: string;
}

/** §6.4 정렬 상태(§5.2 view_state.sort). 실제 정렬 가능 컬럼은 LIST-05에서 확정. */
export interface SortState {
  column: string;
  direction: "asc" | "desc";
}

/**
 * LIST-08(신규): 목록 '구분'/'위치' 컬럼 필터. 세션 한정(view_state 스키마
 * 밖) — null은 "이 축은 필터링 안 함"(전체 표시), 빈 배열은 "아무 것도 안
 * 보임"과 다른 의미이므로 구분해서 쓴다.
 */
export interface ReviewListFilter {
  categories: string[] | null;
  pages: number[] | null;
}

export interface RenderedPage {
  pageIndex: number;
  width: number;
  height: number;
  pageWidthPt: number;
  pageHeightPt: number;
  pngBase64: string;
}

/** BM-01: 북마크(outline) 트리의 한 노드(§6.2). */
export interface BookmarkNode {
  title: string;
  pageIndex: number | null;
  children: BookmarkNode[];
}

function otherSidebarId(id: SidebarId): SidebarId {
  return id === "bookmark" ? "redaction" : "bookmark";
}

/** Sidebar.css의 기존 고정 폭과 맞춘 기본값(SIDE-02 드래그 판정·최초 폭 기준). */
export const DEFAULT_SIDEBAR_WIDTH_PX = 240;

export interface AppState {
  bookmarkSidebar: SidebarState;
  redactionSidebar: RedactionSidebarState;
  /** SIDE-03: 두 사이드바가 같은 측에 몰렸을 때만 의미 있는 배치·순서. */
  sameSideArrangement: SidebarArrangement;
  sameSideOrder: [SidebarId, SidebarId];
  statusMessage: string;
  document: PdfDocumentInfo | null;
  bookmarks: BookmarkNode[];
  currentPageIndex: number;
  renderedPage: RenderedPage | null;
  /**
   * 활성(primary) 선택 항목 — 뷰어 연동·편집·포커스의 기준(§5.2
   * view_state.selected_item_id 복원 대상). 다중선택 시에도 "지금 다루는 한 항목"을
   * 가리키며, 항상 `selectedItemIds`에 포함된다.
   */
  selectedItemId: string | null;
  /**
   * LIST-10(다중선택): 선택된 모든 항목 id(일괄삭제 대상). 단일선택이면 활성
   * 항목 하나만 담긴다. 갱신 시 항상 새 Set으로 교체해 반응성을 보장한다.
   */
  selectedItemIds: Set<string>;
  /** LIST-10: shift 범위선택의 기준점(마지막으로 modifier 없이 고른 항목). */
  selectionAnchorId: string | null;
  sort: SortState;
  /** LIST-08: 목록 '구분'/'위치' 컬럼 필터(세션 한정). */
  reviewListFilter: ReviewListFilter;
  /** LIST-15: 목록 컬럼 너비(px). 구분·위치는 고정폭, 내용은 남은 폭을 채운다.
   * 도킹/플로팅 모두 같은 값을 쓴다(세션 한정). */
  reviewListColumnWidths: { category: number; page: number };
  /**
   * DET-OPT: 자동검출에서 **제외할** 카테고리 코드 목록(전역 영속, 다음 실행에도
   * 적용). 비어 있으면 전체 검출. "제외 목록"이라 새 카테고리는 기본 검출된다.
   */
  excludedDetectionCategories: string[];
  /** pdfium render_page에 넘기는 포인트→픽셀 배율(§6.1 확대/축소는 재렌더 방식). */
  zoomScale: number;
  viewMode: ViewMode;
  /** SIDE-02: 드래그 중일 때만 존재(가이드 오버레이 표시용). */
  dockDrag: DockDragState | null;
  /** STATE-05(§4.4): sidecar와 현재 PDF가 불일치할 때 다이얼로그 표시 여부. */
  identityMismatchDialogOpen: boolean;
  /**
   * STATE-03: 현재 문서의 sidecar가 처음 만들어진 시각(§5.2 source.created_at).
   * 기존 sidecar를 복원했으면 그 값을, 새로 만드는 문서면 연 시각을 담아 이후
   * 자동저장마다 created_at을 덮어쓰지 않고 보존한다. 문서가 없으면 null.
   */
  sidecarCreatedAt: string | null;
  /** STATE-06(§5.2 review_items): M5~M7(DET/LIST/EDIT)이 채울 항목 목록. */
  reviewItems: ReviewItem[];
  /** DET-05: 자동검출 실행 중 여부(상태바 취소 버튼 표시 조건, §6.3.1). */
  detectionInProgress: boolean;
  /**
   * UI-PROGRESS: 저장(SAVE-03)/내보내기(IO-01) 처리 중 전역 잠금. true인 동안
   * 중단 버튼을 제외한 모든 PDF 조작(bbox·뷰어·목록·사이드바·단축키)을 차단한다.
   */
  busy: boolean;
  /**
   * UI-PROGRESS: 진행 중 작업의 진행률(백엔드 operation-progress 이벤트로 갱신).
   * null이면 진행 중 작업 없음(바 숨김).
   */
  operationProgress: OperationProgress | null;
  /** UI-PROGRESS: 현재 진행 중 작업이 실제 시작된 시각(ms). 남은 시간 추정 기준. null이면 미시작. */
  operationStartedAt: number | null;
  /** UI-PROGRESS: 직전 저장/내보내기 완료 요약 + '열기' 대상(다음 상태 메시지 전까지 유지). */
  operationResult: OperationResult | null;
  /** DET-07: 페이지별 자동검출 제외 영역. 문서(sidecar)와 함께 복원/저장. */
  exclusionZones: PageExclusionZoneEntry[];
  /** DET-07: 제외 영역 드래그 편집 오버레이 표시 여부(페이지네이션 모드 전용). */
  exclusionZoneEditMode: boolean;
  /** EDIT-14: bbox 드래그가 제외영역 경계에 닿는 동안 그 페이지 index(아니면 null).
   * 이 페이지에 한해 제외영역 바를 읽기전용으로 잠깐 보여 한계를 알린다(세션 한정). */
  exclusionContactPage: number | null;
  /** STATE-06(§5.2 history): undo/redo 커서·이력. */
  history: HistoryState;
  /** EDIT-04(§6.5, §8.1): 뷰어에 bbox를 표시할지. F1로 토글. */
  bboxVisible: boolean;
  /**
   * EDIT-01(§6.3.2): 방금 드래그로 만든 항목의 id. 목록의 해당 행이 마운트
   * 시 이 값을 보고 스스로 내용 편집모드로 들어간 뒤 소비(null로 되돌림)한다
   * — 뷰어(생성 주체)와 목록(편집모드 주체)이 서로 직접 참조하지 않고
   * store를 통해 일회성으로 신호를 주고받는 지점.
   */
  pendingEditItemId: string | null;
  /** COLOR-01/02(§7.3): 뷰어 bbox·사이드바 선택 강조 색상. */
  colorSettings: RedactifySettings;
  colorSettingsDialogOpen: boolean;
  /** IO-02(§6.6): "수정 중인 내용은 사라집니다..." 가져오기 경고 다이얼로그. */
  importConfirmDialogOpen: boolean;
  /** DET-05: "현재의 민감정보 검출목록이 모두 사라집니다..." 자동검출 경고 다이얼로그. */
  detectionConfirmDialogOpen: boolean;
  /** LIST-14: 구분 필터로 일부 검출항목이 숨겨진 채 저장하려 할 때 경고 다이얼로그. */
  saveFilterWarningDialogOpen: boolean;
  /**
   * IO-03(§5.4): 가져오기 시 내용 기반 재탐색에 실패해 `$bbox`로 폴백한
   * 항목의 id 집합("위치확인 필요" 표시용). sidecar에는 저장하지 않는
   * 세션 한정 UI 상태 — 사용자가 직접 위치를 조정하면 그 항목은 해제된다.
   */
  positionUncertainItemIds: Set<string>;
  /** KEY-01(§7.1/§8): 툴바 "단축키" 버튼으로 여는 단축키 안내창. */
  shortcutsDialogOpen: boolean;
  /** UX 편의: 앱 영역 위로 파일을 드래그하는 동안 true — 뷰어에 놓기 안내를 표시한다. */
  dragOverActive: boolean;
  toggleBookmarkSidebar: () => void;
  toggleRedactionSidebar: () => void;
  /** STATE-04: 토글이 아니라 복원 시 절대값을 그대로 반영하기 위한 세터. */
  setBookmarkSidebarState: (state: SidebarState) => void;
  setRedactionSidebarState: (state: RedactionSidebarState) => void;
  setStatusMessage: (message: string) => void;
  setDocument: (document: PdfDocumentInfo | null) => void;
  setBookmarks: (bookmarks: BookmarkNode[]) => void;
  setCurrentPageIndex: (pageIndex: number) => void;
  setRenderedPage: (renderedPage: RenderedPage | null) => void;
  setSelectedItemId: (id: string | null) => void;
  /**
   * LIST-10(다중선택): 활성 항목·선택 집합·앵커를 한 번에 설정한다. 클릭
   * modifier(cmd/shift)·드래그·shift-화살표 등 다중선택 조작이 이걸 쓴다.
   */
  setSelection: (activeId: string | null, ids: Set<string>, anchorId: string | null) => void;
  setSort: (sort: SortState) => void;
  setReviewListFilter: (filter: ReviewListFilter) => void;
  setReviewListColumnWidths: (widths: { category: number; page: number }) => void;
  setExcludedDetectionCategories: (categories: string[]) => void;
  setZoomScale: (zoomScale: number) => void;
  setViewMode: (viewMode: ViewMode) => void;
  toggleViewMode: () => void;
  setDockDrag: (drag: DockDragState | null) => void;
  setIdentityMismatchDialogOpen: (open: boolean) => void;
  setSidecarCreatedAt: (createdAt: string | null) => void;
  /** STATE-04 복원용 절대 세터. */
  setReviewItems: (items: ReviewItem[]) => void;
  setHistory: (history: HistoryState) => void;
  setDetectionInProgress: (inProgress: boolean) => void;
  /** UI-PROGRESS: 전역 busy 잠금 토글. */
  setBusy: (busy: boolean) => void;
  /** UI-PROGRESS: 진행률 갱신(null이면 바 숨김). */
  setOperationProgress: (progress: OperationProgress | null) => void;
  /** UI-PROGRESS: 진행 시작 시각 설정(null=미시작). */
  setOperationStartedAt: (at: number | null) => void;
  /** UI-PROGRESS: 완료 요약 설정(null=지움). */
  setOperationResult: (result: OperationResult | null) => void;
  /** STATE-04 복원용 절대 세터(문서 복원/새 문서 시 통째로 교체). */
  setExclusionZones: (zones: PageExclusionZoneEntry[]) => void;
  /** 드래그 편집 중 한 페이지의 마진만 upsert(없으면 추가, 있으면 교체). */
  setPageExclusionMargins: (pageIndex: number, margins: PageExclusionMargins) => void;
  /** "모든 페이지에 적용": 현재 페이지의 마진을 pageCount 전체로 복사한다. */
  applyExclusionMarginsToAllPages: (margins: PageExclusionMargins) => void;
  setExclusionZoneEditMode: (editMode: boolean) => void;
  setExclusionContactPage: (pageIndex: number | null) => void;
  /** STATE-06: 항목 변경 하나를 history에 기록하고 즉시 반영한다(add/edit/delete 등). */
  recordHistoryChange: (
    action: HistoryAction,
    itemId: string,
    before: ReviewItem | null,
    after: ReviewItem | null,
    groupId?: string,
  ) => void;
  undo: () => void;
  redo: () => void;
  toggleBboxVisible: () => void;
  setPendingEditItemId: (id: string | null) => void;
  setColorSettings: (settings: RedactifySettings) => void;
  setColorSettingsDialogOpen: (open: boolean) => void;
  setImportConfirmDialogOpen: (open: boolean) => void;
  setDetectionConfirmDialogOpen: (open: boolean) => void;
  setSaveFilterWarningDialogOpen: (open: boolean) => void;
  setPositionUncertainItemIds: (ids: Set<string>) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
  setDragOverActive: (active: boolean) => void;
  /** 사용자가 bbox를 직접 조정하면(EDIT-02) 더는 "위치확인 필요"가 아니다. */
  clearPositionUncertain: (itemId: string) => void;
  /** 드래그를 놓았을 때 도킹 확정(SIDE-02 edge / SIDE-03 overlay·insertOuter·insertInner). */
  applyDockDrop: (sidebarId: SidebarId, shape: DockGuideShape) => void;
  /** SIDE-02: 안쪽 가장자리 핸들 드래그로 폭을 조절한다(도킹 드래그와는 별개 동작). */
  setSidebarWidth: (sidebarId: SidebarId, width: number) => void;
  /** SIDE-04: 블랙마킹 사이드바 플로팅 ↔ 도킹 전환. 플로팅 시작 시 rect가 없으면 기본값 사용. */
  toggleRedactionFloating: () => void;
  setRedactionFloatingRect: (rect: FloatingRect) => void;
}

// SPEC §5.2 view_state의 기본값(북마크=좌측 도킹, 블랙마킹 목록=우측 도킹)을 따른다.
export const useAppStore = create<AppState>((set) => ({
  bookmarkSidebar: { visible: true, dock: "left", width: DEFAULT_SIDEBAR_WIDTH_PX },
  redactionSidebar: { visible: true, dock: "right", floating: false, rect: null, width: DEFAULT_SIDEBAR_WIDTH_PX },
  sameSideArrangement: "sideBySide",
  sameSideOrder: ["bookmark", "redaction"],
  statusMessage: "",
  document: null,
  bookmarks: [],
  currentPageIndex: 0,
  renderedPage: null,
  selectedItemId: null,
  selectedItemIds: new Set<string>(),
  selectionAnchorId: null,
  sort: { column: "position", direction: "asc" },
  reviewListFilter: { categories: null, pages: null },
  reviewListColumnWidths: { category: 110, page: 64 },
  excludedDetectionCategories: [],
  zoomScale: 1.0,
  viewMode: "paginated",
  dockDrag: null,
  identityMismatchDialogOpen: false,
  sidecarCreatedAt: null,
  reviewItems: [],
  history: { cursor: 0, entries: [] },
  detectionInProgress: false,
  busy: false,
  operationProgress: null,
  operationStartedAt: null,
  operationResult: null,
  exclusionZones: [],
  exclusionZoneEditMode: false,
  exclusionContactPage: null,
  bboxVisible: true,
  pendingEditItemId: null,
  colorSettings: DEFAULT_COLOR_SETTINGS,
  colorSettingsDialogOpen: false,
  importConfirmDialogOpen: false,
  detectionConfirmDialogOpen: false,
  saveFilterWarningDialogOpen: false,
  positionUncertainItemIds: new Set(),
  shortcutsDialogOpen: false,
  dragOverActive: false,
  toggleBookmarkSidebar: () =>
    set((state) => ({
      bookmarkSidebar: { ...state.bookmarkSidebar, visible: !state.bookmarkSidebar.visible },
    })),
  toggleRedactionSidebar: () =>
    set((state) => ({
      redactionSidebar: { ...state.redactionSidebar, visible: !state.redactionSidebar.visible },
    })),
  setBookmarkSidebarState: (bookmarkSidebar) => set({ bookmarkSidebar }),
  setRedactionSidebarState: (redactionSidebar) => set({ redactionSidebar }),
  setStatusMessage: (message) => set({ statusMessage: message }),
  setDocument: (document) => set({ document }),
  setBookmarks: (bookmarks) => set({ bookmarks }),
  setCurrentPageIndex: (currentPageIndex) => set({ currentPageIndex }),
  setRenderedPage: (renderedPage) => set({ renderedPage }),
  // 단일선택(커서): 활성 항목만 커서로 두고 다중선택 마크 집합(selectedItemIds)은
  // 비운다. 화살표 탐색·Space 마킹의 커서/마크 분리 모델(사용자 요청) — 평범한
  // 클릭은 마크를 지우고 그 항목만 커서로 삼는다. 삭제·복사 등은 마크가 비면
  // 커서로 폴백하므로 단일 동작은 그대로 유지된다.
  setSelectedItemId: (selectedItemId) =>
    set({
      selectedItemId,
      selectedItemIds: new Set<string>(),
      selectionAnchorId: selectedItemId,
    }),
  setSelection: (selectedItemId, selectedItemIds, selectionAnchorId) =>
    set({ selectedItemId, selectedItemIds: new Set(selectedItemIds), selectionAnchorId }),
  setSort: (sort) => set({ sort }),
  setReviewListFilter: (reviewListFilter) => set({ reviewListFilter }),
  setReviewListColumnWidths: (reviewListColumnWidths) => set({ reviewListColumnWidths }),
  setExcludedDetectionCategories: (excludedDetectionCategories) => set({ excludedDetectionCategories }),
  setZoomScale: (zoomScale) => set({ zoomScale }),
  // DET-07: 제외영역 편집은 페이지네이션 모드 전용 — 연속 스크롤로 바뀌면
  // 편집 UI 자체가 안 보이므로, 토글이 "켜진 채로 아무 효과도 없는" 상태로
  // 남지 않게 같이 끈다.
  setViewMode: (viewMode) =>
    set((state) => ({
      viewMode,
      exclusionZoneEditMode: viewMode === "scroll" ? false : state.exclusionZoneEditMode,
    })),
  toggleViewMode: () =>
    set((state) => {
      const viewMode = state.viewMode === "paginated" ? "scroll" : "paginated";
      return { viewMode, exclusionZoneEditMode: viewMode === "scroll" ? false : state.exclusionZoneEditMode };
    }),
  setDockDrag: (dockDrag) => set({ dockDrag }),
  setIdentityMismatchDialogOpen: (identityMismatchDialogOpen) => set({ identityMismatchDialogOpen }),
  setSidecarCreatedAt: (sidecarCreatedAt) => set({ sidecarCreatedAt }),
  setReviewItems: (reviewItems) => set({ reviewItems }),
  setHistory: (history) => set({ history }),
  setDetectionInProgress: (detectionInProgress) => set({ detectionInProgress }),
  setBusy: (busy) => set({ busy }),
  setOperationProgress: (operationProgress) => set({ operationProgress }),
  setOperationStartedAt: (operationStartedAt) => set({ operationStartedAt }),
  setOperationResult: (operationResult) => set({ operationResult }),
  setExclusionZones: (exclusionZones) => set({ exclusionZones }),
  setPageExclusionMargins: (pageIndex, margins) =>
    set((state) => {
      const exists = state.exclusionZones.some((z) => z.pageIndex === pageIndex);
      const exclusionZones = exists
        ? state.exclusionZones.map((z) => (z.pageIndex === pageIndex ? { pageIndex, margins } : z))
        : [...state.exclusionZones, { pageIndex, margins }];
      return { exclusionZones };
    }),
  applyExclusionMarginsToAllPages: (margins) =>
    set((state) => {
      const pageCount = state.document?.pageCount ?? 0;
      const exclusionZones = Array.from({ length: pageCount }, (_, pageIndex) => ({ pageIndex, margins }));
      return { exclusionZones };
    }),
  setExclusionZoneEditMode: (exclusionZoneEditMode) => set({ exclusionZoneEditMode }),
  setExclusionContactPage: (exclusionContactPage) => set({ exclusionContactPage }),
  recordHistoryChange: (action, itemId, before, after, groupId) =>
    set((state) => {
      const result = historyEngine.recordChange(
        state.reviewItems,
        state.history,
        action,
        itemId,
        before,
        after,
        groupId,
      );
      return { reviewItems: result.items, history: result.history };
    }),
  undo: () =>
    set((state) => {
      const result = historyEngine.undo(state.reviewItems, state.history);
      return { reviewItems: result.items, history: result.history };
    }),
  redo: () =>
    set((state) => {
      const result = historyEngine.redo(state.reviewItems, state.history);
      return { reviewItems: result.items, history: result.history };
    }),
  toggleBboxVisible: () => set((state) => ({ bboxVisible: !state.bboxVisible })),
  setPendingEditItemId: (pendingEditItemId) => set({ pendingEditItemId }),
  setColorSettings: (colorSettings) => set({ colorSettings }),
  setColorSettingsDialogOpen: (colorSettingsDialogOpen) => set({ colorSettingsDialogOpen }),
  setImportConfirmDialogOpen: (importConfirmDialogOpen) => set({ importConfirmDialogOpen }),
  setDetectionConfirmDialogOpen: (detectionConfirmDialogOpen) => set({ detectionConfirmDialogOpen }),
  setSaveFilterWarningDialogOpen: (saveFilterWarningDialogOpen) => set({ saveFilterWarningDialogOpen }),
  setPositionUncertainItemIds: (positionUncertainItemIds) => set({ positionUncertainItemIds }),
  setShortcutsDialogOpen: (shortcutsDialogOpen) => set({ shortcutsDialogOpen }),
  setDragOverActive: (dragOverActive) => set({ dragOverActive }),
  clearPositionUncertain: (itemId) =>
    set((state) => {
      if (!state.positionUncertainItemIds.has(itemId)) return {};
      const next = new Set(state.positionUncertainItemIds);
      next.delete(itemId);
      return { positionUncertainItemIds: next };
    }),
  applyDockDrop: (sidebarId, shape) =>
    set((state) => {
      const other = otherSidebarId(sidebarId);
      const dockUpdate =
        sidebarId === "bookmark"
          ? { bookmarkSidebar: { ...state.bookmarkSidebar, dock: shape.dock } }
          : { redactionSidebar: { ...state.redactionSidebar, dock: shape.dock } };

      switch (shape.kind) {
        case "edge":
          return dockUpdate;
        case "overlay":
          return { ...dockUpdate, sameSideArrangement: "stacked", sameSideOrder: [sidebarId, other] };
        case "insertOuter":
          return { ...dockUpdate, sameSideArrangement: "sideBySide", sameSideOrder: [sidebarId, other] };
        case "insertInner":
          return { ...dockUpdate, sameSideArrangement: "sideBySide", sameSideOrder: [other, sidebarId] };
      }
    }),
  toggleRedactionFloating: () =>
    set((state) => {
      const floating = !state.redactionSidebar.floating;
      return {
        redactionSidebar: {
          ...state.redactionSidebar,
          floating,
          rect: floating ? (state.redactionSidebar.rect ?? DEFAULT_FLOATING_RECT) : null,
        },
      };
    }),
  setRedactionFloatingRect: (rect) =>
    set((state) => ({ redactionSidebar: { ...state.redactionSidebar, rect } })),
  setSidebarWidth: (sidebarId, width) =>
    set((state) =>
      sidebarId === "bookmark"
        ? { bookmarkSidebar: { ...state.bookmarkSidebar, width } }
        : { redactionSidebar: { ...state.redactionSidebar, width } },
    ),
}));
