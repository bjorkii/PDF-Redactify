/**
 * COLOR-02(§7.3): 사용자가 고르는 색은 `<input type="color">`라 불투명한
 * "#rrggbb"뿐이다 — bbox 오버레이는 원문 위에 겹쳐 그려지므로 반투명이
 * 필요해, 고정 alpha를 곱해 rgba()로 바꾼다.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
