// UI-PROGRESS: 저장/내보내기 진행률·완료 요약 표시용 포맷 유틸(순수 함수).

/** ms를 "MM:SS"로(분은 최소 2자리, 필요하면 그 이상). 예) 92000 → "01:32", 2732000 → "45:32". */
export function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 지금까지 걸린 시간과 진행 비율로 **남은 시간(ms)**을 추정한다. 아직 한 단위도
 * 처리 안 됐으면(processed<=0) 추정 불가로 null(호출부는 "--:--" 표시).
 */
export function estimateRemainingMs(elapsedMs: number, processed: number, total: number): number | null {
  if (processed <= 0 || total <= 0) return null;
  const fraction = processed / total;
  if (fraction <= 0) return null;
  const totalEstMs = elapsedMs / fraction;
  return Math.max(0, totalEstMs - elapsedMs);
}

/** 원본→결과 용량 변화를 "1.2MB 증가"/"0.5MB 감소"/"용량 동일"로. */
export function formatSizeDelta(originalBytes: number, outputBytes: number): string {
  const delta = outputBytes - originalBytes;
  if (delta === 0) return "용량 동일";
  const mb = (Math.abs(delta) / (1024 * 1024)).toFixed(1);
  return delta > 0 ? `${mb}MB 증가` : `${mb}MB 감소`;
}
