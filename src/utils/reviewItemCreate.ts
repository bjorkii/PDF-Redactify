import type { ReviewItem } from "../types/generated/ReviewItem";
import type { RelativeBBox } from "../types/generated/RelativeBBox";

/**
 * EDIT-01(§6.3.2): 뷰어에서 드래그로 새로 그린 bbox로 사용자 지정 항목을
 * 만든다. content는 일부러 빈 문자열로 둔다 — 목록 셀의 placeholder
 * "사용자 추가"는 화면에만 보이는 안내이지 실제로 저장할 값이 아니다.
 */
export function buildNewManualReviewItem(
  id: string,
  page: number,
  bbox: RelativeBBox,
  now: string,
): ReviewItem {
  return {
    id,
    origin: "manual",
    page,
    bbox,
    original_bbox: null,
    category: "Custom",
    content: "",
    pattern_type: null,
    confidence: null,
    validation: "NotValidated",
    modified: false,
    created_at: now,
    updated_at: now,
  };
}
