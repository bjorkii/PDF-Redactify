import type { ReviewItem } from "../types/generated/ReviewItem";
import type { ReviewListFilter } from "../store/appStore";

/**
 * LIST-08(신규): 블랙마킹 목록의 '구분'/'위치' 컬럼 필터. `filter.categories`/
 * `filter.pages`가 null이면 그 축은 필터링하지 않는다(전체 표시) — 빈 배열
 * `[]`과는 의미가 다르다(빈 배열이면 아무 것도 안 보임).
 */
export function filterReviewItems(items: ReviewItem[], filter: ReviewListFilter): ReviewItem[] {
  return items.filter((item) => {
    if (filter.categories && !filter.categories.includes(item.category)) return false;
    if (filter.pages && !filter.pages.includes(item.page + 1)) return false;
    return true;
  });
}

/**
 * 위치 필터 입력창(콤마/공백 구분 페이지 번호 직접 입력)을 파싱한다. 숫자가
 * 아닌 조각은 무시하고, 정수만 남긴다. 빈 입력이면 빈 배열(필터 없음은
 * 호출부가 null로 별도 처리).
 */
export function parsePageFilterInput(input: string): number[] {
  return input
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => Number.parseInt(token, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}
