import type { ReviewItem } from "../types/generated/ReviewItem";
import type { RelativeBBox } from "../types/generated/RelativeBBox";
import type { XlsxRow } from "../types/generated/XlsxRow";
import { categoryLabel, categoryCode } from "./reviewItemCategory";

/** 부동소수점 잔여 오차(0.30000000000000004 류)를 걷어내 파일을 깔끔하게 유지한다. */
function formatBboxString(bbox: ReviewItem["bbox"]): string {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return `${round(bbox.x)},${round(bbox.y)},${round(bbox.width)},${round(bbox.height)}`;
}

/**
 * IO-01(§5.4): ReviewItem을 Excel 한 행으로 변환한다. 구분은 사람이 읽을
 * 한국어 표시명(§5.3), 위치는 1-indexed 페이지 번호로 바꾼다.
 */
export function buildXlsxRow(item: ReviewItem, filename: string): XlsxRow {
  return {
    filename,
    category: categoryLabel(item.category),
    content: item.content,
    page: item.page + 1,
    bbox: formatBboxString(item.bbox),
    updated_at: item.updated_at,
  };
}

/** IO-02(§5.4): "x,y,w,h" 문자열을 파싱한다. 형식이 어긋나면 null(호출부가 재탐색/폴백 처리). */
export function parseBboxString(value: string): RelativeBBox | null {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;

  const [x, y, width, height] = parts;
  return { x, y, width, height };
}

/**
 * IO-02(§5.4): Excel 행을 ReviewItem으로 되돌린다(가져오기, origin="imported").
 * $bbox 파싱에 실패하면 좌표가 없다는 뜻으로 0-크기 bbox를 쓴다 — 실제
 * 내용 기반 재탐색·'위치확인 필요' 표시는 IO-03의 몫이다.
 */
export function buildReviewItemFromXlsxRow(row: XlsxRow, id: string): ReviewItem {
  return {
    id,
    origin: "imported",
    page: Math.max(0, row.page - 1),
    bbox: parseBboxString(row.bbox) ?? { x: 0, y: 0, width: 0, height: 0 },
    original_bbox: null,
    category: categoryCode(row.category),
    content: row.content,
    pattern_type: null,
    confidence: null,
    validation: "NotValidated",
    modified: false,
    created_at: row.updated_at,
    updated_at: row.updated_at,
  };
}
