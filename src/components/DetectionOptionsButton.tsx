import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { ko } from "../i18n/ko";
import { saveDetectionCategories } from "../services/detectionCategoriesService";
import { FilterPopover } from "./FilterPopover";
import "./DetectionOptionsButton.css";

// DET-OPT: 자동검출 대상 카테고리(사용자 지정은 수동 항목이라 검출 대상이 아니다).
const DETECTABLE = ko.redactionCategories.filter((c) => c.value !== "Custom");

/**
 * DET-OPT: 자동검출 버튼 오른쪽에 붙는 옵션 캐럿. 누르면 각 검출 카테고리를
 * on/off 하는 드롭다운이 펼쳐진다. default는 모두 선택, 최종 선택은 전역 설정으로
 * 저장돼 다음 앱 실행에도 적용된다("제외 목록"으로 저장 — 저장은 서비스가 담당).
 */
export function DetectionOptionsButton() {
  const excluded = useAppStore((s) => s.excludedDetectionCategories);
  const detectionInProgress = useAppStore((s) => s.detectionInProgress);
  const [open, setOpen] = useState(false);

  function toggle(category: string) {
    const next = excluded.includes(category)
      ? excluded.filter((c) => c !== category)
      : [...excluded, category];
    void saveDetectionCategories(next);
  }

  function setAll(enabled: boolean) {
    void saveDetectionCategories(enabled ? [] : DETECTABLE.map((c) => c.value));
  }

  return (
    <span className="detection-options">
      <button
        type="button"
        className="detection-options-trigger"
        title="자동검출 옵션"
        aria-label="자동검출 옵션"
        disabled={detectionInProgress}
        onClick={() => setOpen((v) => !v)}
      >
        ▾
      </button>
      {open && (
        <FilterPopover onClose={() => setOpen(false)}>
          {DETECTABLE.map((c) => (
            <label key={c.value} className="filter-popover-option">
              <input type="checkbox" checked={!excluded.includes(c.value)} onChange={() => toggle(c.value)} />
              {c.label}
            </label>
          ))}
          <div className="filter-popover-actions">
            <button type="button" onClick={() => setAll(true)}>
              전체 선택
            </button>
            <button type="button" onClick={() => setAll(false)}>
              전체 해제
            </button>
          </div>
        </FilterPopover>
      )}
    </span>
  );
}
