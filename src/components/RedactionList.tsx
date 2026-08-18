import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/appStore";
import { sortReviewItems, nextSortState, type SortColumn } from "../utils/reviewItemSort";
import { filterReviewItems, parsePageFilterInput } from "../utils/reviewItemFilter";
import { categoryLabel } from "../utils/reviewItemCategory";
import { rangeIds, toggleId, extendSelection } from "../utils/reviewItemSelection";
import { goToPage, goToNextPage, goToPreviousPage } from "../services/pdfService";
import { selectAdjacentReviewItem } from "../services/reviewItemActions";
import { isEditingOrInDialog } from "../shortcuts/tabFocus";
import { RedactionListRow } from "./RedactionListRow";
import { FilterPopover } from "./FilterPopover";
import { FilterIcon } from "./icons";
import "./RedactionList.css";

const ROW_HEIGHT_PX = 32;

// LIST-15: 컬럼 autofit용 텍스트 폭 측정(공유 canvas 재사용). 가상화로 안 보이는
// 행까지 포함해 정확히 재려면 DOM 측정 대신 폰트로 직접 measureText 한다.
let measureCanvas: HTMLCanvasElement | null = null;
function measureTextWidth(text: string, font: string): number {
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * 8;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * LIST-01/05/06(§6.4, §5.4): 블랙마킹 목록 가상화 테이블. 표시 컬럼은 구분/
 * 내용/위치(페이지 번호)뿐 — $파일명·$bbox·수정추가시각은 ReviewItem
 * 데이터에는 남아있지만 이 UI에는 그리지 않는다(숨김컬럼). 헤더를 클릭하면
 * 그 컬럼으로 정렬하고(이미 그 컬럼이면 오름/내림 토글), 기본은 위치 순
 * (page→y→x). ↑/↓(§8.3)는 선택을 이전/다음 항목으로 옮기고 뷰어도 그
 * 페이지로 이동시킨다. 목록↔뷰어 bbox 연동(LIST-02), 셀 편집(LIST-03),
 * 제외/포함(LIST-04)은 각 행(RedactionListRow)이 이미 처리한다.
 */
export function RedactionList() {
  const reviewItems = useAppStore((s) => s.reviewItems);
  const sort = useAppStore((s) => s.sort);
  const setSort = useAppStore((s) => s.setSort);
  const filter = useAppStore((s) => s.reviewListFilter);
  const setFilter = useAppStore((s) => s.setReviewListFilter);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const selectedItemIds = useAppStore((s) => s.selectedItemIds);
  const selectionAnchorId = useAppStore((s) => s.selectionAnchorId);
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId);
  const setSelection = useAppStore((s) => s.setSelection);
  const columnWidths = useAppStore((s) => s.reviewListColumnWidths);
  const setColumnWidths = useAppStore((s) => s.setReviewListColumnWidths);
  const parentRef = useRef<HTMLDivElement>(null);
  /** LIST-10: 드래그 선택 중 시작 행 인덱스(마우스 버튼을 뗄 때까지 유지). */
  const dragStartIndex = useRef<number | null>(null);
  const [openFilterPopover, setOpenFilterPopover] = useState<"category" | "page" | null>(null);
  const [pageFilterInput, setPageFilterInput] = useState("");

  // LIST-08: 필터 체크박스에 나열할 카테고리는 필터 적용 전(reviewItems) 기준
  // — 필터로 하나만 남겨놔도, 다시 다른 카테고리를 켤 수 있는 선택지 자체는
  // 계속 보여야 한다.
  const allCategories = useMemo(() => {
    const set = new Set(reviewItems.map((item) => item.category));
    return Array.from(set).sort((a, b) => {
      // '사용자 지정'(Custom)은 가나다 정렬과 무관하게 항상 맨 아래로.
      if (a === "Custom") return 1;
      if (b === "Custom") return -1;
      return categoryLabel(a).localeCompare(categoryLabel(b), "ko");
    });
  }, [reviewItems]);

  const items = useMemo(
    () => sortReviewItems(filterReviewItems(reviewItems, filter), sort),
    [reviewItems, filter, sort],
  );

  function handleHeaderClick(column: SortColumn) {
    setSort(nextSortState(sort, column));
  }

  function sortIndicator(column: SortColumn): string {
    if (sort.column !== column) return "";
    return sort.direction === "asc" ? " ▲" : " ▼";
  }

  // LIST-15: 컬럼 너비 리사이즈 — 구분(오른쪽 경계)/위치(왼쪽 경계) 핸들 드래그.
  // 델타는 시작 폭 기준으로 절대 계산(누적 아님)하므로 stale 클로저 문제 없음.
  function startColumnResize(column: "category" | "page", event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column];
    const dir = column === "category" ? 1 : -1; // 위치는 왼쪽 경계라 왼쪽으로 끌면 넓어짐
    function onMove(e: PointerEvent) {
      const next = Math.max(40, Math.min(400, startWidth + (e.clientX - startX) * dir));
      setColumnWidths({ ...columnWidths, [column]: next });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // LIST-15: 리사이즈 핸들 더블클릭 → 그 컬럼의 데이터 중 가장 긴 것에 맞춰 폭 조정.
  // 구분 핸들은 구분 컬럼(왼쪽), 위치 핸들은 위치 컬럼을 대상으로 한다(내용 컬럼은
  // 남은 폭을 채우는 유동 컬럼이라 고정폭 autofit 대상이 아니다).
  function autofitColumn(column: "category" | "page") {
    const sample = parentRef.current?.querySelector<HTMLElement>(".redaction-list-cell");
    const cs = sample ? getComputedStyle(sample) : null;
    const font = cs ? `${cs.fontSize} ${cs.fontFamily}` : "13px sans-serif";
    const texts =
      column === "category"
        ? Array.from(new Set(items.map((item) => categoryLabel(item.category))))
        : items.map((item) => String(item.page + 1));
    let maxWidth = 0;
    for (const text of texts) maxWidth = Math.max(maxWidth, measureTextWidth(text, font));
    const width = Math.max(40, Math.min(400, Math.ceil(maxWidth) + 16)); // 좌우 여백 여유분
    setColumnWidths({ ...columnWidths, [column]: width });
  }

  function toggleCategoryFilter(category: string) {
    const current = filter.categories ?? allCategories;
    const next = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    setFilter({ ...filter, categories: next });
  }

  function clearCategoryFilter() {
    setFilter({ ...filter, categories: null });
  }

  // 전체 해제: 빈 배열(아무 카테고리도 표시 안 함)로 두어, 원하는 것만 다시
  // 체크해 좁혀갈 수 있게 한다. null(전체 표시)과 의미가 다르다.
  function deselectAllCategoryFilter() {
    setFilter({ ...filter, categories: [] });
  }

  function openPageFilterPopover() {
    setPageFilterInput(filter.pages?.join(", ") ?? "");
    setOpenFilterPopover("page");
  }

  function applyPageFilter() {
    const parsed = parsePageFilterInput(pageFilterInput);
    setFilter({ ...filter, pages: parsed.length > 0 ? parsed : null });
    setOpenFilterPopover(null);
  }

  function clearPageFilter() {
    setPageFilterInput("");
    setFilter({ ...filter, pages: null });
    setOpenFilterPopover(null);
  }

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 8,
  });

  // LIST-10 다중선택: pointer-down에서 modifier·드래그를 판정한다. 뷰어 연동
  // (goToPage)은 선택이 확정될 때만 — 드래그 중(mouseenter)에는 페이지를 옮기지
  // 않아 스크롤이 튀지 않게 한다.
  function handlePointerSelect(event: React.MouseEvent, index: number) {
    const item = items[index];
    if (!item) return;

    if (event.shiftKey) {
      // 현재 선택(앵커)부터 클릭한 항목까지 범위 선택. 텍스트 드래그 선택은 막는다.
      event.preventDefault();
      const anchor = selectionAnchorId ?? selectedItemId;
      setSelection(item.id, rangeIds(items, anchor, item.id), anchor ?? item.id);
      void goToPage(item.page);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      // cmd/ctrl-click: 불연속 토글.
      const ids = toggleId(selectedItemIds, item.id);
      const active = ids.has(item.id) ? item.id : ids.size > 0 ? Array.from(ids)[ids.size - 1] : null;
      setSelection(active, ids, item.id);
      void goToPage(item.page);
      return;
    }
    // 평범한 down: 단일 선택 + 드래그 시작(mouseenter가 범위를 넓힌다).
    dragStartIndex.current = index;
    setSelectedItemId(item.id);
    void goToPage(item.page);
  }

  function handlePointerEnter(event: React.MouseEvent, index: number) {
    // 버튼을 누른 채(주 버튼=1)일 때만 드래그 선택. 트랙패드 스크롤로 행이 커서
    // 밑을 지날 때는 buttons===0이라, 이 가드가 없으면 스크롤만 해도 다중선택이
    // 번지는 버그가 났다(사용자 재현). 눌린 상태가 아니면 드래그를 확실히 끝낸다.
    if (event.buttons !== 1) {
      dragStartIndex.current = null;
      return;
    }
    if (dragStartIndex.current === null) return;
    const anchorId = items[dragStartIndex.current]?.id ?? null;
    const target = items[index];
    if (!target) return;
    setSelection(target.id, rangeIds(items, anchorId, target.id), anchorId);
  }

  // 드래그 종료: 문서 어디서 버튼을 떼도 선택 드래그를 끝낸다.
  useEffect(() => {
    function endDrag() {
      dragStartIndex.current = null;
    }
    window.addEventListener("mouseup", endDrag);
    return () => window.removeEventListener("mouseup", endDrag);
  }, []);

  // LIST-06(§8.3 ↑/↓): 선택 이동 자체는 selectAdjacentReviewItem이 뷰어
  // 포커스(§8.1)와 공유하고, 여기서는 가상화 때문에 화면 밖일 수 있는 다음
  // 행을 그 인덱스로 스크롤해 마운트되게 하는 것만 추가로 처리한다.
  function handleNavigate(direction: 1 | -1) {
    const next = selectAdjacentReviewItem(direction);
    if (!next) return;
    const index = items.indexOf(next);
    // §사용자 요청: 스크롤/리사이즈로 선택 항목이 프레임아웃된 상태에서 ↑/↓을
    // 누르면 새로 선택된 항목이 목록 "중앙"에 나타나게 한다. 이미 보이는
    // 범위면 최소 이동(auto)으로 — 매번 재중앙정렬되면 산만하다는 기존 판단
    // (아래 center-effect 주석)과 동일한 기준을, 여기서 이동 직전에 적용한다.
    const el = parentRef.current;
    let align: "auto" | "center" = "auto";
    if (el) {
      const rowTop = index * ROW_HEIGHT_PX;
      const rowBottom = rowTop + ROW_HEIGHT_PX;
      if (rowTop < el.scrollTop || rowBottom > el.scrollTop + el.clientHeight) align = "center";
    }
    virtualizer.scrollToIndex(index, { align });
  }

  // §사용자 재현 버그(반복): 목록 행에 DOM 포커스가 있는 상태로 트랙패드
  // two-finger 등으로 스크롤하면, 그 행이 가상화로 언마운트되며 포커스가
  // body로 떨어져 ↑/↓이 아무 핸들러에도 닿지 않았다(=화살표가 먹통).
  // 그래서 키 처리를 "언마운트되지 않는" 스크롤 컨테이너(.redaction-list-scroll)
  // 로 올린다 — 행이 포커스를 잃고 언마운트돼도(RedactionListRow가 언마운트
  // 시 이 컨테이너로 포커스를 넘긴다) 여기서 계속 ↑/↓을 처리한다. 뷰어
  // 포커스일 때의 ↑/↓은 여전히 handleViewerNavigationKeyDown이 맡는다(별개 도메인).
  function handleListKeyboard(event: React.KeyboardEvent) {
    if (isEditingOrInDialog()) return;
    // 구분 커스텀 드롭다운(내부 편집)이 열린 행에서 온 키는 건드리지 않는다.
    if ((event.target as HTMLElement).closest(".redaction-category-edit")) return;

    if (event.key === "ArrowDown" && event.shiftKey) {
      event.preventDefault();
      handleExtend(1);
    } else if (event.key === "ArrowUp" && event.shiftKey) {
      event.preventDefault();
      handleExtend(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      handleNavigate(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      handleNavigate(-1);
    } else if (event.key === "ArrowLeft") {
      // §8.1 뷰어와 하나의 키보드 도메인 — ←/→는 앞/뒤 페이지 이동.
      event.preventDefault();
      void goToPreviousPage();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      void goToNextPage();
    } else if (event.key === " ") {
      // 사용자 요청: Space = 활성(커서) 항목의 다중선택 토글. 화살표로
      // 옮겨다니며 Space로 중복선택/선별해제한다(옛 '제외' 토글 자리를 대체).
      event.preventDefault();
      const { selectedItemId, selectedItemIds, setSelection } = useAppStore.getState();
      if (!selectedItemId) return;
      setSelection(selectedItemId, toggleId(selectedItemIds, selectedItemId), selectedItemId);
    }
  }

  // LIST-10: shift+↑/↓ 선택 범위 확장(활성 항목을 한 칸 옮기며 앵커~활성 범위 선택).
  function handleExtend(direction: 1 | -1) {
    const result = extendSelection(items, selectionAnchorId, selectedItemId, direction);
    if (!result) return;
    setSelection(result.activeId, result.ids, result.anchorId);
    const active = items.find((it) => it.id === result.activeId);
    if (active) void goToPage(active.page);
    virtualizer.scrollToIndex(
      items.findIndex((it) => it.id === result.activeId),
      { align: "auto" },
    );
  }

  // §사용자 요청: 선택 항목이 실제로 화면(스크롤 뷰포트) 밖이면 부드럽게 목록
  // 수직 중앙으로 스크롤한다. 삭제 후 다음 선택이 멀리 있을 때가 주 대상.
  // 행 높이가 고정(ROW_HEIGHT_PX)이라 인덱스로 정확한 top/bottom을 계산해,
  // overscan(렌더는 됐지만 화면엔 안 보이는 범위)에 속아 스킵되지 않게 한다.
  // 한 칸 화살표 이동은 대개 이미 보이는 범위라 여기서 걸리지 않고
  // handleNavigate(align:auto)가 맡는다. items가 바뀌는(삭제) 다음 프레임에
  // 스크롤이 실제 반영되도록 rAF로 한 틱 미룬다.
  useEffect(() => {
    if (!selectedItemId) return;
    const index = items.findIndex((it) => it.id === selectedItemId);
    if (index === -1) return;

    const raf = requestAnimationFrame(() => {
      const el = parentRef.current;
      if (!el) return;
      const rowTop = index * ROW_HEIGHT_PX;
      const rowBottom = rowTop + ROW_HEIGHT_PX;
      const viewTop = el.scrollTop;
      const viewBottom = viewTop + el.clientHeight;
      if (rowTop < viewTop || rowBottom > viewBottom) {
        virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId, items]);

  return (
    <div className="redaction-list">
      <div className="redaction-list-row redaction-list-header" role="row">
        <div
          className="redaction-list-cell redaction-list-cell-category redaction-list-header-cell"
          style={{ flex: `0 0 ${columnWidths.category}px` }}
        >
          <button
            type="button"
            className={`redaction-list-filter-trigger${filter.categories ? " active filter-hidden" : ""}`}
            title="구분 필터"
            aria-label="구분 필터"
            onClick={() => setOpenFilterPopover(openFilterPopover === "category" ? null : "category")}
          >
            <FilterIcon width={12} height={12} />
          </button>
          <span onClick={() => handleHeaderClick("category")}>
            구분{sortIndicator("category")}
          </span>
          {openFilterPopover === "category" && (
            <FilterPopover onClose={() => setOpenFilterPopover(null)}>
              {allCategories.map((category) => (
                <label key={category} className="filter-popover-option">
                  <input
                    type="checkbox"
                    checked={filter.categories === null || filter.categories.includes(category)}
                    onChange={() => toggleCategoryFilter(category)}
                  />
                  {categoryLabel(category)}
                </label>
              ))}
              <div className="filter-popover-actions">
                <button type="button" onClick={clearCategoryFilter}>
                  전체 선택
                </button>
                <button type="button" onClick={deselectAllCategoryFilter}>
                  전체 해제
                </button>
              </div>
            </FilterPopover>
          )}
          {/* LIST-15: 구분 컬럼 오른쪽 경계 리사이즈 핸들(더블클릭=데이터 최대폭 맞춤). */}
          <div
            className="redaction-list-column-resizer"
            title="드래그: 너비 조정 · 더블클릭: 내용에 맞춤"
            onPointerDown={(event) => startColumnResize("category", event)}
            onDoubleClick={() => autofitColumn("category")}
          />
        </div>
        <span
          className="redaction-list-cell redaction-list-cell-content"
          onClick={() => handleHeaderClick("content")}
        >
          내용{sortIndicator("content")}
        </span>
        <div
          className="redaction-list-cell redaction-list-cell-page redaction-list-header-cell"
          style={{ flex: `0 0 ${columnWidths.page}px` }}
        >
          {/* LIST-15: 위치 컬럼 왼쪽 경계 리사이즈 핸들(더블클릭=데이터 최대폭 맞춤). */}
          <div
            className="redaction-list-column-resizer redaction-list-column-resizer-left"
            title="드래그: 너비 조정 · 더블클릭: 내용에 맞춤"
            onPointerDown={(event) => startColumnResize("page", event)}
            onDoubleClick={() => autofitColumn("page")}
          />
          <button
            type="button"
            className={`redaction-list-filter-trigger${filter.pages ? " active" : ""}`}
            title="위치 필터"
            aria-label="위치 필터"
            onClick={() => (openFilterPopover === "page" ? setOpenFilterPopover(null) : openPageFilterPopover())}
          >
            <FilterIcon width={12} height={12} />
          </button>
          <span onClick={() => handleHeaderClick("page")}>
            위치{sortIndicator("page")}
          </span>
          {openFilterPopover === "page" && (
            <FilterPopover onClose={() => setOpenFilterPopover(null)}>
              <input
                type="text"
                className="filter-popover-input"
                placeholder="예: 1, 3, 5"
                value={pageFilterInput}
                autoFocus
                onChange={(event) => setPageFilterInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyPageFilter();
                  else if (event.key === "Escape") setOpenFilterPopover(null);
                }}
              />
              <div className="filter-popover-actions">
                <button type="button" onClick={clearPageFilter}>
                  전체 선택
                </button>
                <button type="button" onClick={applyPageFilter}>
                  적용
                </button>
              </div>
            </FilterPopover>
          )}
        </div>
      </div>
      <div
        ref={parentRef}
        className="redaction-list-scroll"
        role="rowgroup"
        data-redaction-scroll
        tabIndex={-1}
        onKeyDown={handleListKeyboard}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];

            return (
              <RedactionListRow
                key={item.id}
                item={item}
                index={virtualRow.index}
                isActive={item.id === selectedItemId}
                isSelected={selectedItemIds.has(item.id)}
                height={virtualRow.size}
                offsetY={virtualRow.start}
                columnWidths={columnWidths}
                onPointerSelect={handlePointerSelect}
                onPointerEnter={handlePointerEnter}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
