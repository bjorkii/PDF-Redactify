import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type BookmarkNode, type PdfDocumentInfo, type RenderedPage } from "../store/appStore";
import type { RelativeBBox } from "../types/generated/RelativeBBox";
import { publishStatus } from "./statusBus";
import { getErrorMessage } from "./appError";
import { getCachedRenderedPage, setCachedRenderedPage } from "./renderCache";
import { loadSidecar } from "./sidecarService";
import { applyViewState } from "./viewState";
import { requestIdentityMismatchDecision } from "./identityMismatch";
import { isSameSource } from "../utils/sourceIdentity";
import { hasAnyText } from "../utils/textLayer";
import { loadColorSettings } from "./colorSettingsService";
import { computeFitToPageScale } from "../utils/fitToPage";
import type { SidecarDocument } from "../types/generated/SidecarDocument";

const PDF_LOAD_FAILED_MESSAGE = "PDF 파일이 오류로 인해 열리지 않습니다.";
/** DET-06(§6.3.4): 텍스트 레이어가 전혀 없는(스캔본) 파일을 열었을 때의 안내. */
const NO_TEXT_LAYER_LOAD_MESSAGE =
  "이 파일에는 검출 가능한 텍스트 정보가 없으므로 자동검출은 실시할 수 없습니다.";

type OpenDecision = "fresh" | "restore" | "cancelled";

/**
 * STATE-05(§4.4): sidecar가 없으면 최초 실행이므로 그냥 진행("fresh"). 있고
 * 현재 PDF와 동일하면 그대로 복원("restore"). 불일치하면 다이얼로그로
 * 사용자에게 [무시하고 열기]("restore", §4.4 정식 워크플로)/[재검출](기존
 * sidecar를 버리고 "fresh")/[취소]("cancelled")를 묻는다.
 */
async function resolveOpenDecision(
  info: PdfDocumentInfo,
  sidecar: SidecarDocument | null,
): Promise<OpenDecision> {
  if (!sidecar) return "fresh";
  if (isSameSource(info, sidecar)) return "restore";

  const choice = await requestIdentityMismatchDecision();
  if (choice === "openAnyway") return "restore";
  if (choice === "redetect") return "fresh";
  return "cancelled";
}

/**
 * PDF-04(§6.1): 지정한 페이지 치수(pt)를 뷰어의 현재 실제 크기(px)에 맞춘
 * 배율을 계산한다. `.viewer`(Viewer.tsx의 data-focus-region="viewer")는
 * 문서가 열려 있는지와 무관하게 항상 DOM에 존재하므로(App.tsx의 부팅 시
 * 포커스 지정과 동일한 전제), 렌더 타이밍 경합 없이 곧바로 측정할 수 있다.
 * 아직 측정할 수 없으면(테스트 환경 등) 기존 기본값인 100%로 안전하게 대체한다.
 */
function measureFitToPageScale(pageWidthPt: number, pageHeightPt: number): number {
  // 이 파일의 서비스 함수들은 jsdom 없는(순수 Node) vitest 환경에서도 단위
  // 테스트되므로(pdfService.test.ts), 그런 환경엔 전역 document 자체가 없다
  // — typeof 체크로 먼저 걸러내야 ReferenceError 없이 안전하게 기본값(100%)으로 대체된다.
  if (typeof document === "undefined") return 1.0;
  const viewerEl = document.querySelector<HTMLElement>('[data-focus-region="viewer"]');
  if (!viewerEl || viewerEl.clientWidth === 0 || viewerEl.clientHeight === 0) return 1.0;
  return computeFitToPageScale(pageWidthPt, pageHeightPt, viewerEl.clientWidth, viewerEl.clientHeight);
}

/**
 * PDF-04(스크롤 모드 전체보기): 페이지가 뷰포트 **상하단을 채우도록** 높이에만
 * 맞춘 배율(연속 스크롤은 세로로 이어지므로 높이 기준이 자연스럽다 — 사용자 요청).
 * 스크롤 아이템 상하 패딩(24px)만큼 빼 페이지가 뷰포트를 넘치지 않게 한다.
 */
function measureFitPageHeightScale(pageHeightPt: number): number {
  if (typeof document === "undefined") return 1.0;
  const viewerEl = document.querySelector<HTMLElement>('[data-focus-region="viewer"]');
  if (!viewerEl || viewerEl.clientHeight === 0 || pageHeightPt <= 0) return 1.0;
  const usable = Math.max(1, viewerEl.clientHeight - 24);
  return usable / pageHeightPt;
}

/**
 * STATE-04(§6.8): 결정("fresh"/"restore")에 따라 view_state(페이지·줌·선택·
 * 정렬·사이드바 배치)를 복원하거나 기본값(첫 페이지, 전체보기 배율)으로
 * 시작하고, 해당 페이지를 렌더한다.
 */
async function applyOpenDecision(
  info: PdfDocumentInfo,
  sidecar: SidecarDocument | null,
  decision: "fresh" | "restore",
): Promise<void> {
  if (decision === "fresh" || !sidecar) {
    // STATE-03: 새로 만드는 sidecar이므로 created_at을 지금 시각으로 고정한다.
    useAppStore.getState().setSidecarCreatedAt(new Date().toISOString());
    useAppStore.getState().setCurrentPageIndex(0);
    // PDF-04: 파일을 처음 열 때는 전체보기(fit-to-page) 배율로 시작한다
    // (사용자 요청 — 예전엔 항상 100%로 열려서 큰 페이지는 잘려 보였다).
    const firstPageDims = info.pageDimensions[0];
    const initialScale = firstPageDims ? measureFitToPageScale(firstPageDims.pageWidth, firstPageDims.pageHeight) : 1.0;
    useAppStore.getState().setZoomScale(initialScale);
    // STATE-06: 새 문서이므로 이전 문서의 항목·undo 이력을 이어받지 않는다.
    useAppStore.getState().setReviewItems([]);
    useAppStore.getState().setHistory({ cursor: 0, entries: [] });
    // DET-07: 이전 문서의 탐지 제외 영역도 이어받지 않는다.
    useAppStore.getState().setExclusionZones([]);
    await renderCurrentPage(info.path, 0, initialScale);
    return;
  }

  // STATE-03: 기존 sidecar를 복원하므로 그 created_at을 그대로 이어간다.
  useAppStore.getState().setSidecarCreatedAt(sidecar.source.created_at);
  // STATE-06(§6.8): 블랙마킹 목록과 undo/redo 이력도 함께 복원한다.
  useAppStore.getState().setReviewItems(sidecar.review_items);
  useAppStore.getState().setHistory(sidecar.history);
  // DET-07: 페이지별 탐지 제외 영역도 함께 복원한다.
  useAppStore.getState().setExclusionZones(
    sidecar.exclusion_zones.map((z) => ({ pageIndex: z.page_index, margins: z.margins })),
  );
  applyViewState(sidecar.view_state);
  // 파일이 바뀌어 페이지 수가 줄었을 수도 있으므로 방어적으로 clamp한다.
  const restoredPage = Math.min(Math.max(sidecar.view_state.current_page, 0), info.pageCount - 1);
  await renderCurrentPage(info.path, restoredPage, sidecar.view_state.zoom);
}

/**
 * PDF-01/STATE-05(§4.4): 이미 열린(또는 새로) 얻은 PdfDocumentInfo 하나를
 * 실제로 문서로 반영하는 공통 경로. 다이얼로그로 고른 경우(openPdf)와
 * 드래그 앤 드롭으로 고른 경우(openPdfFromPath)가 이 로직을 공유한다.
 * 사이드카 조회 → 동일성 판단(불일치 시 다이얼로그) → 색상 설정 →
 * view_state 복원/초기화 → 북마크 로드 → NoText 안내까지 한 번에 처리한다.
 */
async function openPdfDocument(info: PdfDocumentInfo): Promise<void> {
  const sidecar = await loadSidecar(info.path);
  const decision = await resolveOpenDecision(info, sidecar);
  if (decision === "cancelled") {
    publishStatus("파일 열기를 취소했습니다.");
    return;
  }

  useAppStore.getState().setDocument(info);
  publishStatus(`${info.filename} 파일을 열었습니다.`);

  // COLOR-02(§9.4): 색상 설정은 폴더 단위. 이 폴더에 커스터마이즈한 적
  // 없으면(null) 지금 화면에 이미 반영돼 있는 값(앱 전역 기본값 또는
  // 이전 문서의 설정)을 그대로 둔다 — 하드코딩된 기본 파랑으로 되돌리면
  // 방금까지 보이던 사용자 설정 색이 문서를 열 때마다 깜빡이며 사라진다.
  const colorSettings = await loadColorSettings(info.path);
  if (colorSettings) useAppStore.getState().setColorSettings(colorSettings);

  await applyOpenDecision(info, sidecar, decision);
  await fetchAndStoreBookmarks(info.path);

  // DET-06: 텍스트 레이어가 전혀 없는 파일이면, 위의 "파일을 열었습니다"
  // 안내보다 이 경고가 더 실행 가능한(actionable) 정보이므로 덮어쓴다.
  if (!hasAnyText(info)) {
    publishStatus(NO_TEXT_LAYER_LOAD_MESSAGE);
  }
}

/**
 * PDF-01: 파일 열기 다이얼로그를 띄우고 선택한 PDF를 로드한다.
 * 사용자가 다이얼로그를 취소하면 아무 것도 하지 않는다. 실패(PDF-08 포함)
 * 시에는 §7.1 상태바 안내 문구를 그대로 표출한다. STATE-05: 불일치로 사용자가
 * [취소]를 고르면 기존에 열려 있던 문서를 그대로 유지한다(새 문서로 바꾸지 않음).
 */
export async function openPdf(): Promise<void> {
  try {
    const info = await invoke<PdfDocumentInfo | null>("open_pdf");
    if (!info) return;
    await openPdfDocument(info);
  } catch (err) {
    const message = getErrorMessage(err, PDF_LOAD_FAILED_MESSAGE);
    publishStatus(message);
  }
}

/**
 * UX 편의: 앱 영역에 PDF 파일을 드래그 앤 드롭했을 때, 다이얼로그 없이
 * 주어진 경로를 바로 연다. 그 외 흐름(사이드카/색상/불일치 처리 등)은
 * openPdf와 완전히 동일하다.
 */
export async function openPdfFromPath(path: string): Promise<void> {
  try {
    const info = await invoke<PdfDocumentInfo>("open_pdf_path", { path });
    await openPdfDocument(info);
  } catch (err) {
    const message = getErrorMessage(err, PDF_LOAD_FAILED_MESSAGE);
    publishStatus(message);
  }
}

/**
 * BM-01: 문서의 북마크(outline) 트리를 가져와 store에 반영한다.
 * 북마크가 없는 문서는 빈 배열(정상 상태, 에러 아님).
 */
export async function fetchAndStoreBookmarks(path: string): Promise<void> {
  try {
    const bookmarks = await invoke<BookmarkNode[]>("get_bookmarks", { path });
    useAppStore.getState().setBookmarks(bookmarks);
  } catch (err) {
    const message = getErrorMessage(err, PDF_LOAD_FAILED_MESSAGE);
    publishStatus(message);
  }
}

/**
 * PDF-02: 페이지 하나를 pdfium으로 렌더링해 결과를 반환한다(store는 건드리지
 * 않음). 연속 스크롤 모드(PDF-05)의 개별 페이지 컴포넌트처럼 "현재 페이지"
 * 개념과 무관하게 특정 페이지를 렌더해야 할 때 이 함수를 직접 쓴다.
 *
 * 성능: 같은 (path, pageIndex, scale)를 다시 요청하면(북마크 방향키로
 * 인접 페이지를 오가거나, 연속 스크롤에서 화면 밖으로 나갔다 들어온 경우)
 * IPC 왕복 없이 캐시로 즉시 응답한다 — render_page는 무겁고 pdfium 전역
 * 락 때문에 동시 요청도 직렬화되므로, 반복 렌더를 피하는 게 체감 속도에
 * 크게 도움 된다.
 */
export async function fetchRenderedPage(
  path: string,
  pageIndex: number,
  scale: number,
): Promise<RenderedPage | null> {
  const cached = getCachedRenderedPage(path, pageIndex, scale);
  if (cached) return cached;

  try {
    const rendered = await invoke<RenderedPage>("render_page", { path, pageIndex, scale });
    setCachedRenderedPage(path, pageIndex, scale, rendered);
    return rendered;
  } catch (err) {
    const message = getErrorMessage(err, PDF_LOAD_FAILED_MESSAGE);
    publishStatus(message);
    return null;
  }
}

/**
 * 이 값보다 오래된(먼저 시작했지만 나중에 끝난) 렌더링 응답은 버린다.
 * 줌 버튼을 빠르게 연타하면(각 단계가 pdfium 재렌더라 §6.1 자체가 좀
 * 걸릴 수 있음) 요청이 응답보다 먼저 여러 번 쌓일 수 있는데, IPC 왕복이
 * 요청 순서대로 끝난다는 보장이 없어서 먼저 보낸(더 큰/작은 배율) 요청이
 * 나중에 끝나 최신 상태를 덮어쓸 수 있었다 — "축소가 한 단계만 되고
 * 더 안 줄어드는 것처럼 보인다"는 보고가 바로 이 증상이었다.
 */
let renderGeneration = 0;

/**
 * 지정한 페이지를 렌더링해 "현재 페이지" 상태(store.renderedPage)에 반영한다.
 * scale은 PDF 포인트→픽셀 배율(1.0 = 72dpi 원본 크기). 페이지네이션 모드
 * 뷰어는 이 비트맵을 원본 비율 그대로 표시한다(§6.1).
 */
export async function renderCurrentPage(
  path: string,
  pageIndex: number,
  scale: number = useAppStore.getState().zoomScale,
): Promise<void> {
  const generation = ++renderGeneration;
  const rendered = await fetchRenderedPage(path, pageIndex, scale);
  if (rendered && generation === renderGeneration) useAppStore.getState().setRenderedPage(rendered);
}

/**
 * EDIT-10: 주어진 페이지·bbox가 덮는 텍스트를 백엔드에서 추출한다. bbox를
 * 리사이즈/이동한 뒤 그 영역의 실제 텍스트로 목록 content를 갱신하는 데 쓴다.
 * 문서가 없거나 추출 실패면 빈 문자열.
 */
export async function extractTextInBbox(pageIndex: number, bbox: RelativeBBox): Promise<string> {
  const { document } = useAppStore.getState();
  if (!document) return "";
  try {
    return await invoke<string>("extract_text_in_bbox", { path: document.path, pageIndex, bbox });
  } catch {
    return "";
  }
}

/**
 * PDF-05: 연속 스크롤 모드에서는 ScrollView가 마운트 시 이 함수로 자신의
 * scrollToIndex를 등록해, goToPage(직접 입력/이전·다음)가 재렌더 대신
 * 해당 페이지로 스크롤을 이동시키도록 한다. 언마운트 시 반드시 null로 해제한다.
 */
type ScrollToPageFn = (pageIndex: number) => void;
let scrollToPageImpl: ScrollToPageFn | null = null;

export function registerScrollToPage(fn: ScrollToPageFn | null): void {
  scrollToPageImpl = fn;
}

/**
 * PDF-04/05: 연속 스크롤 모드에서 "전체보기"가 기준으로 삼을 페이지를
 * 구하는 콜백 — ScrollView가 마운트 시 등록한다(registerScrollToPage와
 * 동일한 패턴). 현재 뷰포트에 가장 넓게 걸쳐 보이는 페이지 인덱스를
 * 반환한다(findMostVisiblePageIndex).
 */
type MostVisiblePageFn = () => number | null;
let mostVisiblePageImpl: MostVisiblePageFn | null = null;

export function registerMostVisiblePage(fn: MostVisiblePageFn | null): void {
  mostVisiblePageImpl = fn;
}

/**
 * PDF-03: 페이지 이동(이전/다음/직접 입력 공통 경로). 문서 범위를 벗어나면
 * 가장 가까운 유효 페이지로 고정하고, 이미 그 페이지면 아무 것도 하지 않는다.
 * 연속 스크롤 모드에서는 재렌더 대신 해당 페이지로 스크롤한다(PDF-05).
 */
export async function goToPage(pageIndex: number): Promise<void> {
  const { document, currentPageIndex, viewMode, setCurrentPageIndex } = useAppStore.getState();
  if (!document) return;

  const clamped = Math.min(Math.max(pageIndex, 0), document.pageCount - 1);
  if (clamped === currentPageIndex) return;

  setCurrentPageIndex(clamped);

  if (viewMode === "scroll" && scrollToPageImpl) {
    scrollToPageImpl(clamped);
    return;
  }

  await renderCurrentPage(document.path, clamped);
}

export async function goToNextPage(): Promise<void> {
  await goToPage(useAppStore.getState().currentPageIndex + 1);
}

export async function goToPreviousPage(): Promise<void> {
  await goToPage(useAppStore.getState().currentPageIndex - 1);
}

const MIN_ZOOM = 0.25;
// 10.0(1000%)도 다른 뷰어(예: macOS 미리보기, 최대 몇 천 %)보다 여전히
// 이르게 멈춘다는 재현 보고를 반영해 16.0(1600%)로 다시 올림. 그 이상은
// pdfium이 실제로 그 배율의 픽셀 크기(예: 편지지 크기 페이지가 변 약
// 9800px)로 재렌더하는 구조라(§6.1, CSS 확대가 아님) 비트맵 크기·렌더
// 시간이 배율의 제곱으로 커진다 — 무한정 올리면 오히려 렌더가 멎는
// 것처럼 느껴질 수 있어 이 선에서 제한한다.
const MAX_ZOOM = 16.0;
// 스텝을 고정폭(±0.25, 선형)이 아니라 비율(±25%, 로그 스케일)로 바꿨다
// — 선형이면 낮은 배율(25%→50%)에서는 한 번에 확 뛰고, 높은 배율
// (900%→925%)에서는 거의 안 변한 것처럼 느껴져 체감이 배율마다 달랐다
// (사용자 요청). 매 스텝 곱/나눗셈이라 어느 배율에서든 "그만큼 더/덜
// 확대됐다"는 체감이 비슷하게 유지된다.
const ZOOM_FACTOR = 1.25;

/**
 * PDF-04: 확대/축소는 CSS 스케일링이 아니라 pdfium 실시간 재렌더링이다(§6.1).
 * zoomScale은 render_page의 포인트→픽셀 배율로 그대로 쓰인다.
 */
export async function setZoom(scale: number): Promise<void> {
  const { document, currentPageIndex, setZoomScale } = useAppStore.getState();
  const clamped = Math.min(Math.max(scale, MIN_ZOOM), MAX_ZOOM);
  setZoomScale(clamped);

  if (!document) return;
  await renderCurrentPage(document.path, currentPageIndex, clamped);
}

export async function zoomIn(): Promise<void> {
  await setZoom(useAppStore.getState().zoomScale * ZOOM_FACTOR);
}

export async function zoomOut(): Promise<void> {
  await setZoom(useAppStore.getState().zoomScale / ZOOM_FACTOR);
}

/**
 * PDF-04(§6.1): 툴바 "전체보기" — 페이지가 뷰어에 꽉 차도록 배율을 맞춘다.
 * 연속 스크롤 모드(PDF-05)에서는 "현재 페이지"(currentPageIndex, 맨 위에
 * 살짝만 걸쳐도 그 페이지로 갱신됨 — ScrollView.tsx) 대신, 지금 뷰포트에
 * 가장 넓게 걸쳐 보이는 페이지를 기준으로 삼는다(사용자 요청).
 */
export async function fitToPage(): Promise<void> {
  const { document: appDocument, currentPageIndex, viewMode, setCurrentPageIndex } = useAppStore.getState();
  if (!appDocument) return;
  const pageIndex = viewMode === "scroll" ? (mostVisiblePageImpl?.() ?? currentPageIndex) : currentPageIndex;
  const dims = appDocument.pageDimensions[pageIndex];
  if (!dims) return;
  if (viewMode === "scroll") {
    // 스크롤 유지 + 클릭 시점 가장 넓게 보이던 페이지를 뷰포트 상하단에 맞춘다(높이 기준).
    // setZoom이 currentPageIndex로 스크롤하므로 그 기준을 이 페이지로 먼저 맞춘다.
    setCurrentPageIndex(pageIndex);
    await setZoom(measureFitPageHeightScale(dims.pageHeight));
    scrollToPageImpl?.(pageIndex);
    return;
  }
  await setZoom(measureFitToPageScale(dims.pageWidth, dims.pageHeight));
}
