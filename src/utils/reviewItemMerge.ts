import type { ReviewItem } from "../types/generated/ReviewItem";
import type { RelativeBBox } from "../types/generated/RelativeBBox";

function bboxesOverlap(a: RelativeBBox, b: RelativeBBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * DET-05: 재검출 시 사용자가 직접 만든/가져온 항목(origin이 "manual" 또는
 * "imported" — RedactionOverlay.tsx의 기존 관례대로 가져오기는 사용자 추가와
 * 동일 취급)은 그대로 두고, 새로 검출된(detected) 후보 중 그런 항목과 같은
 * 페이지에서 실제로 겹치는 것만 걸러낸다(같은 자리를 사용자가 이미 수동으로
 * 표시해뒀다는 뜻이므로 중복 후보로 취급).
 */
export function excludeDetectedOverlappingUserItems(
  detectedCandidates: ReviewItem[],
  userItems: ReviewItem[],
): ReviewItem[] {
  return detectedCandidates.filter(
    (candidate) =>
      !userItems.some((user) => user.page === candidate.page && bboxesOverlap(user.bbox, candidate.bbox)),
  );
}
