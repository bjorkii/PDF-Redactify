import type { RenderedPage } from "../store/appStore";

/**
 * 성능: render_page 한 번이 무겁고(특히 디버그 빌드), pdfium이 스레드
 * 안전하지 않아 전역 락으로 직렬화된다. 같은 (path, pageIndex, scale)
 * 조합을 다시 요청하는 흔한 경우 — 북마크 방향키로 인접 페이지를 오가거나,
 * 연속 스크롤에서 화면 밖으로 나갔다 다시 들어온 페이지 — 는 재렌더 없이
 * 즉시 응답하도록 결과를 캐시해둔다. 큰 base64 PNG를 여럿 들고 있으면
 * 메모리가 계속 늘어나므로 LRU 방식으로 최대 개수를 제한한다.
 */
const MAX_ENTRIES = 40;
const cache = new Map<string, RenderedPage>();

function cacheKey(path: string, pageIndex: number, scale: number): string {
  return `${path}::${pageIndex}::${scale}`;
}

export function getCachedRenderedPage(
  path: string,
  pageIndex: number,
  scale: number,
): RenderedPage | undefined {
  return cache.get(cacheKey(path, pageIndex, scale));
}

export function setCachedRenderedPage(
  path: string,
  pageIndex: number,
  scale: number,
  page: RenderedPage,
): void {
  const key = cacheKey(path, pageIndex, scale);
  // Map은 삽입 순서를 유지하므로, 지웠다 다시 넣으면 "가장 최근 사용"으로
  // 밀려나 다음 그림 삭제 후보에서 제외된다(LRU).
  cache.delete(key);
  cache.set(key, page);

  if (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

export function clearRenderCache(): void {
  cache.clear();
}
