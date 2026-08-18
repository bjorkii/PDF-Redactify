import { useEffect, useRef, useState } from "react";
import { fetchRenderedPage } from "../services/pdfService";
import type { RenderedPage } from "../store/appStore";
import type { PageThumbSize } from "../utils/scrollEstimate";
import { RedactionOverlay } from "./RedactionOverlay";

interface PageThumbProps {
  path: string;
  pageIndex: number;
  scale: number;
  /** 실제 렌더가 없거나(로딩 중) 재렌더 대기 중일 때 표시할 크기(px). */
  estimatedSize: PageThumbSize;
  /** 실측 크기가 나오면 가상화 컨테이너에 알려 레이아웃을 보정한다. */
  onMeasured?: () => void;
}

/**
 * 줌 도중(핀치·버튼 연타) 화면에 걸쳐 있는 모든 페이지가 매 배율 변화마다
 * 한꺼번에 재렌더를 요청하면, pdfium이 스레드 안전하지 않아 전역 락으로
 * 직렬화되는 구조상(§6.1) 요청이 쌓여 오래 걸리고, 그동안 화면이 비어
 * 보인다("줌하면 검은 화면이 보인 후 뒤늦게 렌더"). 배율이 이 시간 동안
 * 안정될 때까지 기다렸다가 마지막 값 하나만 커밋한다.
 */
const RESCALE_DEBOUNCE_MS = 200;

/**
 * PDF-05: 연속 스크롤 모드의 페이지 한 장. 뷰포트 근접(가상화 범위) 동안만
 * 마운트되어 자체적으로 렌더를 요청하고, 범위를 벗어나 언마운트되면 보유하던
 * 비트맵도 함께 GC되어 메모리가 누적되지 않는다.
 */
export function PageThumb({ path, pageIndex, scale, estimatedSize, onMeasured }: PageThumbProps) {
  const [rendered, setRendered] = useState<RenderedPage | null>(null);
  const renderedForRef = useRef<{ path: string; pageIndex: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isRescale = renderedForRef.current?.path === path && renderedForRef.current?.pageIndex === pageIndex;

    // 페이지 자체가 바뀌면(가상화 슬롯이 다른 인덱스로 재사용된 경우) 다른
    // 페이지의 낡은 비트맵을 계속 보여주면 안 되니 즉시 비운다. 배율만
    // 바뀐 재렌더는 기존 비트맵을 그대로 둔다 — wrapper 크기는 estimatedSize
    // (매 렌더 최신 배율 반영)로 이미 즉시 갱신되므로, 새 비트맵이 도착하기
    // 전까지는 낡은 비트맵이 CSS로 새 크기에 맞춰 늘어나 보이다가(살짝
    // 흐릿함) 도착하면 선명한 비트맵으로 자연스럽게 바뀐다 — "줌하면 잠깐
    // 검은 화면"이 되는 대신 항상 뭔가는 보인다.
    if (!isRescale) setRendered(null);

    const timer = setTimeout(
      () => {
        fetchRenderedPage(path, pageIndex, scale).then((result) => {
          if (cancelled || !result) return;
          renderedForRef.current = { path, pageIndex };
          setRendered(result);
        });
      },
      isRescale ? RESCALE_DEBOUNCE_MS : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, pageIndex, scale]);

  useEffect(() => {
    if (rendered) onMeasured?.();
  }, [rendered, onMeasured]);

  if (!rendered) {
    return (
      <div
        className="page-thumb-placeholder"
        style={{ width: estimatedSize.width, height: estimatedSize.height }}
      />
    );
  }

  return (
    <div
      className="page-thumb-wrapper"
      data-page-wrapper
      data-page-index={pageIndex}
      style={{ width: estimatedSize.width, height: estimatedSize.height }}
    >
      <img
        className="page-thumb"
        src={`data:image/png;base64,${rendered.pngBase64}`}
        alt={`${pageIndex + 1}페이지`}
        draggable={false}
      />
      <RedactionOverlay pageIndex={pageIndex} />
    </div>
  );
}
