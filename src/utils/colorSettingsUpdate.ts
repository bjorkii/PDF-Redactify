import type { RedactifySettings } from "../types/generated/RedactifySettings";

type Origin = "detected" | "manual";
type SelectionState = "selected" | "unselected";
type BoxField = "background" | "border";
type TextField = "background" | "font";

/** COLOR-01(§7.3): 자동검출/사용자 추가 후보의 선택·비선택 배경·테두리 하나를 바꾼다. */
export function updateOriginColor(
  settings: RedactifySettings,
  origin: Origin,
  state: SelectionState,
  field: BoxField,
  value: string,
): RedactifySettings {
  return {
    ...settings,
    [origin]: {
      ...settings[origin],
      [state]: { ...settings[origin][state], [field]: value },
    },
  };
}

/** COLOR-01(§7.3/§7.4): 선택 영역 테두리(포커스 강조) 색을 바꾼다. */
export function updateFocusBorderColor(settings: RedactifySettings, value: string): RedactifySettings {
  return { ...settings, focus_border_color: value };
}

/** COLOR-01(§7.3): 사이드바 선택 항목 하이라이트의 배경·폰트 하나를 바꾼다. */
export function updateSidebarSelectionColor(
  settings: RedactifySettings,
  field: TextField,
  value: string,
): RedactifySettings {
  return { ...settings, sidebar_selection: { ...settings.sidebar_selection, [field]: value } };
}

/** DET-07: 탐지 제외영역 드래그 가이드선 색상을 바꾼다. */
export function updateExclusionGuideColor(settings: RedactifySettings, value: string): RedactifySettings {
  return { ...settings, exclusion_guide_color: value };
}
