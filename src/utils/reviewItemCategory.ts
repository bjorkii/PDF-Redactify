import { ko } from "../i18n/ko";

/** §5.3: category 코드(예: "PhoneNumber") → 한국어 표시명(예: "전화번호"). */
export function categoryLabel(category: string): string {
  const found = ko.redactionCategories.find((entry) => entry.value === category);
  return found ? found.label : category;
}

/**
 * IO-02(§5.4): 한국어 표시명 → category 코드(categoryLabel의 역방향). Excel을
 * 사람이 직접 편집할 수 있으므로, 알려진 표시명이 아니면(오탈자·사용자 지정
 * 문자열 등) 원본 문자열을 그대로 코드로 쓴다 — category는 자유 문자열이라
 * 임의로 버리지 않는다.
 */
export function categoryCode(label: string): string {
  const found = ko.redactionCategories.find((entry) => entry.label === label);
  return found ? found.value : label;
}
