import { useAppStore } from "../store/appStore";
import { ko } from "../i18n/ko";
import { fitToPage, openPdf, zoomIn, zoomOut } from "../services/pdfService";
import { runDetection } from "../services/detectionService";
import { DetectionOptionsButton } from "./DetectionOptionsButton";
import { addReviewItemAtDefaultPosition } from "../services/reviewItemActions";
import { exportReviewItems } from "../services/exportService";
import { importReviewItems } from "../services/importService";
import { saveRedactedDocument } from "../services/saveService";
import { EMPTY_MARGINS } from "../utils/exclusionZone";
import { PageIndicator } from "./PageIndicator";
import {
  FolderOpenIcon,
  DetectIcon,
  BookmarkIcon,
  RedactionListIcon,
  AddRedactionIcon,
  ExportIcon,
  ImportIcon,
  SaveIcon,
  PaginatedViewIcon,
  ScrollViewIcon,
  ZoomOutIcon,
  ZoomInIcon,
  FitToPageIcon,
  ColorSettingsIcon,
  ShortcutsIcon,
  ExclusionZoneIcon,
} from "./icons";
import "./Toolbar.css";

// SPEC §7.1: 기능마다 아이콘 + 툴팁(기능명)을 갖는다(UI-02). 툴팁은 버튼의
// title 속성(브라우저 네이티브)이 맡아, 창 폭에 따른 위치 조정·잘림 방지를
// 별도 구현 없이 얻는다. 시각 라벨을 아이콘으로 바꾸는 대신 aria-label로
// 기능명을 남겨 스크린리더 접근성을 유지한다.
export function Toolbar() {
  const toggleBookmarkSidebar = useAppStore((s) => s.toggleBookmarkSidebar);
  const toggleRedactionSidebar = useAppStore((s) => s.toggleRedactionSidebar);
  const viewMode = useAppStore((s) => s.viewMode);
  const toggleViewMode = useAppStore((s) => s.toggleViewMode);
  const detectionInProgress = useAppStore((s) => s.detectionInProgress);
  const setColorSettingsDialogOpen = useAppStore((s) => s.setColorSettingsDialogOpen);
  const setShortcutsDialogOpen = useAppStore((s) => s.setShortcutsDialogOpen);
  const document = useAppStore((s) => s.document);
  const exclusionZoneEditMode = useAppStore((s) => s.exclusionZoneEditMode);
  const setExclusionZoneEditMode = useAppStore((s) => s.setExclusionZoneEditMode);
  const exclusionZones = useAppStore((s) => s.exclusionZones);
  const currentPageIndex = useAppStore((s) => s.currentPageIndex);
  const applyExclusionMarginsToAllPages = useAppStore((s) => s.applyExclusionMarginsToAllPages);
  const t = ko.toolbar;

  function handleApplyExclusionToAllPages() {
    const currentMargins = exclusionZones.find((z) => z.pageIndex === currentPageIndex)?.margins ?? EMPTY_MARGINS;
    applyExclusionMarginsToAllPages(currentMargins);
  }

  // KEY-01(§7.4/§8): 툴바 버튼을 클릭하면 브라우저 기본 동작으로 그
  // 버튼이 DOM 포커스를 가져간다 — 그러면 방금까지 뷰어/블랙마킹 목록에
  // 있던 포커스가 끊겨 곧바로 이어지는 방향키 등 포커스 기반 단축키가
  // 안 먹는다(사용자 재현: "툴바 아이콘 클릭과 동시에 포커스 상실").
  // mousedown 기본 동작(포커스 이동)만 막고 click은 그대로 두면(onClick은
  // 이 리스너와 무관하게 정상 발생) 클릭 직전 포커스가 그대로 유지된다.
  function preventFocusSteal(event: React.MouseEvent) {
    event.preventDefault();
  }

  // 버튼 라벨은 전환될 목표 모드를 보여준다(§6.1 보기 모드 토글).
  const viewModeLabel = viewMode === "paginated" ? t.viewModeScroll : t.viewModePaginated;

  return (
    <div className="toolbar" role="toolbar">
      <button type="button" title={t.openFile} aria-label={t.openFile} onMouseDown={preventFocusSteal} onClick={() => void openPdf()}>
        <FolderOpenIcon />
      </button>
      <span className="toolbar-detect-split">
        <button
          type="button"
          title={t.detect}
          aria-label={t.detect}
          disabled={detectionInProgress}
          onMouseDown={preventFocusSteal}
          onClick={() => void runDetection()}
        >
          <DetectIcon />
        </button>
        {/* DET-OPT: 검출 카테고리 on/off 옵션 드롭다운(버튼 오른쪽에 붙는 캐럿). */}
        <DetectionOptionsButton />
      </span>
      <button
        type="button"
        title={t.bookmarkSidebar}
        aria-label={t.bookmarkSidebar}
        onMouseDown={preventFocusSteal}
        onClick={toggleBookmarkSidebar}
      >
        <BookmarkIcon />
      </button>
      <button
        type="button"
        title={t.redactionSidebar}
        aria-label={t.redactionSidebar}
        onMouseDown={preventFocusSteal}
        onClick={toggleRedactionSidebar}
      >
        <RedactionListIcon />
      </button>
      <button
        type="button"
        title={t.addRedaction}
        aria-label={t.addRedaction}
        onMouseDown={preventFocusSteal}
        onClick={addReviewItemAtDefaultPosition}
      >
        <AddRedactionIcon />
      </button>
      <button type="button" title={t.export} aria-label={t.export} onMouseDown={preventFocusSteal} onClick={() => void exportReviewItems()}>
        <ExportIcon />
      </button>
      <button type="button" title={t.import} aria-label={t.import} onMouseDown={preventFocusSteal} onClick={() => void importReviewItems()}>
        <ImportIcon />
      </button>
      <button type="button" title={t.save} aria-label={t.save} onMouseDown={preventFocusSteal} onClick={() => void saveRedactedDocument()}>
        <SaveIcon />
      </button>
      <PageIndicator />
      <button type="button" title={viewModeLabel} aria-label={viewModeLabel} onMouseDown={preventFocusSteal} onClick={toggleViewMode}>
        {viewMode === "paginated" ? <ScrollViewIcon /> : <PaginatedViewIcon />}
      </button>
      <button type="button" title={t.zoomOut} aria-label={t.zoomOut} onMouseDown={preventFocusSteal} onClick={() => void zoomOut()}>
        <ZoomOutIcon />
      </button>
      <button type="button" title={t.zoomIn} aria-label={t.zoomIn} onMouseDown={preventFocusSteal} onClick={() => void zoomIn()}>
        <ZoomInIcon />
      </button>
      <button
        type="button"
        title={t.fitToPage}
        aria-label={t.fitToPage}
        disabled={!document}
        onMouseDown={preventFocusSteal}
        onClick={() => void fitToPage()}
      >
        <FitToPageIcon />
      </button>
      <button
        type="button"
        title={exclusionZoneEditMode ? t.exclusionZoneEditOff : t.exclusionZoneEdit}
        aria-label={exclusionZoneEditMode ? t.exclusionZoneEditOff : t.exclusionZoneEdit}
        aria-pressed={exclusionZoneEditMode}
        className={exclusionZoneEditMode ? "active" : undefined}
        disabled={!document || viewMode === "scroll"}
        onMouseDown={preventFocusSteal}
        onClick={() => setExclusionZoneEditMode(!exclusionZoneEditMode)}
      >
        <ExclusionZoneIcon />
      </button>
      {exclusionZoneEditMode && (
        <button
          type="button"
          title={t.exclusionZoneApplyAll}
          onMouseDown={preventFocusSteal}
          onClick={handleApplyExclusionToAllPages}
        >
          {t.exclusionZoneApplyAll}
        </button>
      )}
      <button
        type="button"
        title={t.colorSettings}
        aria-label={t.colorSettings}
        onMouseDown={preventFocusSteal}
        onClick={() => setColorSettingsDialogOpen(true)}
      >
        <ColorSettingsIcon />
      </button>
      <button
        type="button"
        title={t.shortcuts}
        aria-label={t.shortcuts}
        onMouseDown={preventFocusSteal}
        onClick={() => setShortcutsDialogOpen(true)}
      >
        <ShortcutsIcon />
      </button>
    </div>
  );
}
