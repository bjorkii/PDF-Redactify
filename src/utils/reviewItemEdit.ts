import type { ReviewItem } from "../types/generated/ReviewItem";

export type EditableField = "category" | "content";

/**
 * LIST-03(§6.3.3): 셀 편집 결과로 만들 새 ReviewItem 스냅샷을 구성한다. 값은
 * 항상 앞뒤 공백을 다듬어 저장한다(" 홍길동 " → "홍길동"). 값이 그대로면 null —
 * 기록할 변경이 없다는 뜻이다.
 *
 * 빈 값 처리(사용자 요청 — "null/공백만"과 "앞뒤 공백"을 구분):
 * - `content`는 **빈 값 저장을 허용**한다(내용 없는 사용자 지정 bbox). 즉 내용을
 *   모두 지우고 커밋하면 실제로 빈 문자열로 지워진다.
 * - `category`는 드롭박스라 빈 값이 될 수 없고 의미도 없으므로 빈 값은 무시한다.
 *
 * 실제 store 반영·history 기록(undo 가능)은 호출부가
 * `recordHistoryChange("edit", item.id, item, result)`로 한다.
 */
export function buildEditedReviewItem(
  item: ReviewItem,
  field: EditableField,
  value: string,
  now: string,
): ReviewItem | null {
  const next = value.trim();
  if (next === item[field]) return null; // 변경 없음
  if (field === "category" && next === "") return null; // 구분은 빈 값 불가

  return { ...item, [field]: next, modified: true, updated_at: now };
}
