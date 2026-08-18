import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/appStore";
import { registerMostVisiblePage, registerScrollToPage } from "../services/pdfService";
import { estimatePageThumbSize, findMostVisiblePageIndex } from "../utils/scrollEstimate";
import { handleViewerNavigationKeyDown } from "../utils/viewerNavigation";
import { collectItemsInClientMarquee, type ClientRect } from "../utils/marqueeSelect";
import { PageThumb } from "./PageThumb";
import "./ScrollView.css";

interface MarqueeState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

/** .scroll-view-item의 실제 CSS(padding: 12px 0)와 맞춘다 — 추정치가 실측치와
 * 어긋나면(패딩만큼 항상 모자라면) 매 아이템마다 측정-보정이 반복된다. */
const SCROLL_ITEM_VERTICAL_PADDING_PX = 24;

/**
 * PDF-05: 연속 스크롤 보기 모드. TanStack Virtual로 뷰포트 근접 페이지만
 * 마운트해(가상화) 262p급 대용량 문서에서도 메모리·스크롤 성능을 지킨다.
 */
export function ScrollView() {
  const document = useAppStore((s) => s.document)!;
  const zoomScale = useAppStore((s) => s.zoomScale);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: document.pageCount,
    getScrollElement: () => parentRef.current,
    // 문서를 열 때 이미 전 페이지의 pt 크기를 알고 있으므로(§4.2), 페이지마다
    // 실제 pt 크기 × zoomScale로 추정한다(estimatePageThumbSize) — 책등처럼
    // 비율이 크게 다른 페이지도 처음부터 실측치에 가까운 높이로 자리잡고,
    // 줌을 바꾸면 세로 간격도 그만큼 다시 잡힌다. CSS의 상하 padding도
    // 더해야 실측치와 맞아 불필요한 재측정을 피한다.
    estimateSize: (index) =>
      estimatePageThumbSize(document.pageDimensions, index, zoomScale).height + SCROLL_ITEM_VERTICAL_PADDING_PX,
    // render_page 한 번이 무겁고(디버그 빌드에서 특히), pdfium이 스레드
    // 안전하지 않아 전역 락으로 직렬화된다 — 오버스캔이 클수록 화면 밖
    // 페이지까지 한꺼번에 렌더 요청이 몰려 체감 지연이 커진다. 1로 줄여
    // 동시에 대기하는 요청 수를 최소화한다(스크롤 여유 폭은 조금 줄지만
    // 응답성이 더 중요하다).
    overscan: 1,
  });

  // PageThumb에 그대로(참조 동일성 유지) 넘긴다 — 매 렌더 새 함수를 넘기면
  // PageThumb의 [rendered, onMeasured] 의존 effect가 매 렌더 다시 돌면서
  // virtualizer.measure() → 재렌더 → 새 함수 → 다시 measure()로 무한
  // 루프에 빠질 수 있다(추정치가 실측치와 어긋나 있을 때 특히 잘 드러남).
  const handleMeasured = useCallback(() => virtualizer.measure(), [virtualizer]);

  useEffect(() => {
    registerScrollToPage((index) => virtualizer.scrollToIndex(index, { align: "start" }));
    return () => registerScrollToPage(null);
  }, [virtualizer]);

  // PDF-04: "전체보기"가 연속 스크롤 모드에서 기준으로 삼을 페이지 — 지금
  // 뷰포트에 가장 넓게 걸쳐 보이는 페이지(findMostVisiblePageIndex 참고).
  useEffect(() => {
    registerMostVisiblePage(() => {
      const container = parentRef.current;
      if (!container) return null;
      return findMostVisiblePageIndex(virtualizer.getVirtualItems(), container.scrollTop, container.clientHeight);
    });
    return () => registerMostVisiblePage(null);
  }, [virtualizer]);

  // PDF-04(사용자 버그): 스크롤 모드로 "전환"할 때 첫 페이지로 튀지 않고 현재
  // 페이지를 그대로 보여준다. 진입 시점의 currentPageIndex를 잡아 두었다가
  // 마운트 직후 그 페이지로 스크롤한다. 초기 scrollTop=0 상태가 currentPageIndex를
  // 0으로 덮어쓰지 않도록, 초기 스크롤이 끝난 다음 프레임부터 동기화를 허용한다.
  const initialPageRef = useRef(useAppStore.getState().currentPageIndex);
  const didInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    const target = initialPageRef.current;
    // 1차: 추정 높이 기반 스크롤. 추정치가 실측과 어긋나면 목표 페이지가 살짝
    // 어긋나 보일 수 있어(사용자 재현 "뷰포트 페이지 오차"), 다음 프레임에 실측이
    // 반영된 상태로 한 번 더 보정 스크롤한 뒤 동기화를 허용한다.
    virtualizer.scrollToIndex(target, { align: "start" });
    const raf = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(target, { align: "start" });
      didInitialScrollRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 스크롤 중 currentPageIndex를 **가장 많이 보이는** 페이지로 동기화한다 —
  // 페이지 모드로 되전환할 때 그 시점 뷰포트에서 가장 넓게 걸친 페이지가 보이도록
  // (사용자 요청). 첫 보이는 페이지가 아니라 최대 가시 면적 기준.
  const syncCurrentPage = useCallback(() => {
    if (!didInitialScrollRef.current) return;
    const container = parentRef.current;
    if (!container) return;
    const idx = findMostVisiblePageIndex(
      virtualizer.getVirtualItems(),
      container.scrollTop,
      container.clientHeight,
    );
    if (idx != null) useAppStore.getState().setCurrentPageIndex(idx);
  }, [virtualizer]);

  const scrollRafRef = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      syncCurrentPage();
    });
  }, [syncCurrentPage]);

  // EDIT-13(스크롤 모드 alt 마퀴 그룹선택 — 사용자 요청): 페이지네이션과 동일하게
  // alt-드래그로 마퀴 사각형에 온전히 들어온 bbox를 그룹선택한다. 연속 스크롤은
  // 여러 페이지가 보이므로 각 페이지 래퍼([data-page-wrapper])의 화면 사각형으로
  // 픽셀 좌표 판정(collectItemsInClientMarquee)해 페이지를 넘나들며 모은다.
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.altKey) return; // alt 없으면 일반 스크롤/클릭 동작 유지.
    event.preventDefault();
    parentRef.current?.focus();
    setMarquee({ startX: event.clientX, startY: event.clientY, curX: event.clientX, curY: event.clientY });
  }

  useEffect(() => {
    if (!marquee) return;
    function onMove(e: PointerEvent) {
      setMarquee((prev) => (prev ? { ...prev, curX: e.clientX, curY: e.clientY } : prev));
    }
    function onUp() {
      const m = marquee!;
      const rect: ClientRect = {
        left: Math.min(m.startX, m.curX),
        top: Math.min(m.startY, m.curY),
        right: Math.max(m.startX, m.curX),
        bottom: Math.max(m.startY, m.curY),
      };
      setMarquee(null);
      const significant = rect.right - rect.left > 4 && rect.bottom - rect.top > 4;
      const { reviewItems, reviewListFilter, setSelection } = useAppStore.getState();
      const categoryFilter = reviewListFilter.categories;
      const pages = Array.from(
        window.document.querySelectorAll<HTMLElement>("[data-page-wrapper][data-page-index]"),
      ).map((el) => ({ pageIndex: Number(el.dataset.pageIndex), rect: el.getBoundingClientRect() }));
      const visiblePageIdx = new Set(pages.map((p) => p.pageIndex));
      const items = reviewItems.filter(
        (it) =>
          visiblePageIdx.has(it.page) && (categoryFilter === null || categoryFilter.includes(it.category)),
      );
      const ids = significant ? collectItemsInClientMarquee(rect, pages, items) : [];
      const primary = ids[0] ?? null;
      setSelection(primary, new Set(ids), primary);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [marquee]);

  // 마퀴 시각화(스크롤 콘텐츠 좌표로 환산 — 컨테이너 오프셋·스크롤량 반영).
  const marqueeStyle = (() => {
    if (!marquee) return null;
    const container = parentRef.current;
    if (!container) return null;
    const c = container.getBoundingClientRect();
    const left = Math.min(marquee.startX, marquee.curX) - c.left;
    const top = Math.min(marquee.startY, marquee.curY) - c.top + container.scrollTop;
    return {
      left,
      top,
      width: Math.abs(marquee.curX - marquee.startX),
      height: Math.abs(marquee.curY - marquee.startY),
    };
  })();

  return (
    <div
      ref={parentRef}
      className="scroll-view"
      tabIndex={0}
      onKeyDown={handleViewerNavigationKeyDown}
      onScroll={handleScroll}
      onPointerDown={handlePointerDown}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {marqueeStyle && <div className="redaction-marquee" style={{ position: "absolute", ...marqueeStyle }} />}
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            className="scroll-view-item"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <PageThumb
              path={document.path}
              pageIndex={item.index}
              scale={zoomScale}
              estimatedSize={estimatePageThumbSize(document.pageDimensions, item.index, zoomScale)}
              onMeasured={handleMeasured}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
