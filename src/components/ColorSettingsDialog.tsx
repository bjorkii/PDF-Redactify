import { useAppStore } from "../store/appStore";
import {
  updateOriginColor,
  updateFocusBorderColor,
  updateSidebarSelectionColor,
  updateExclusionGuideColor,
} from "../utils/colorSettingsUpdate";
import "./ColorSettingsDialog.css";

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function ColorField({ label, value, onChange }: ColorFieldProps) {
  return (
    <label className="color-settings-field">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/**
 * COLOR-01(§7.3): 색상 설정 팝업. 자동검출/사용자 추가 후보 각각 선택·비선택
 * bbox의 배경·테두리, 포커스 강조 테두리(§7.4), 사이드바 선택 항목의
 * 배경·폰트를 고를 수 있다. 원문 색상 때문에 bbox가 안 보일 가능성에
 * 대비해 배경·테두리를 모두 사용자가 정할 수 있게 한다. 지금은 store에만
 * 반영되고(즉시 화면에 적용) 파일로 저장·재구동 시 복원은 COLOR-02의 몫이다.
 */
export function ColorSettingsDialog() {
  const open = useAppStore((s) => s.colorSettingsDialogOpen);
  const settings = useAppStore((s) => s.colorSettings);
  const setColorSettings = useAppStore((s) => s.setColorSettings);
  const setOpen = useAppStore((s) => s.setColorSettingsDialogOpen);

  if (!open) return null;

  function updateOrigin(
    origin: "detected" | "manual",
    state: "selected" | "unselected",
    field: "background" | "border",
    value: string,
  ) {
    setColorSettings(updateOriginColor(settings, origin, state, field, value));
  }

  function updateSidebarSelection(field: "background" | "font", value: string) {
    setColorSettings(updateSidebarSelectionColor(settings, field, value));
  }

  return (
    <div className="color-settings-backdrop">
      <div className="color-settings-dialog" role="dialog" aria-modal="true">
        <div className="color-settings-header">
          <span>색상 설정</span>
          <button type="button" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>

        <div className="color-settings-body">
          <fieldset>
            <legend>자동검출 후보</legend>
            <ColorField
              label="선택 배경"
              value={settings.detected.selected.background}
              onChange={(v) => updateOrigin("detected", "selected", "background", v)}
            />
            <ColorField
              label="선택 테두리"
              value={settings.detected.selected.border}
              onChange={(v) => updateOrigin("detected", "selected", "border", v)}
            />
            <ColorField
              label="비선택 배경"
              value={settings.detected.unselected.background}
              onChange={(v) => updateOrigin("detected", "unselected", "background", v)}
            />
            <ColorField
              label="비선택 테두리"
              value={settings.detected.unselected.border}
              onChange={(v) => updateOrigin("detected", "unselected", "border", v)}
            />
          </fieldset>

          <fieldset>
            <legend>사용자 추가 후보</legend>
            <ColorField
              label="선택 배경"
              value={settings.manual.selected.background}
              onChange={(v) => updateOrigin("manual", "selected", "background", v)}
            />
            <ColorField
              label="선택 테두리"
              value={settings.manual.selected.border}
              onChange={(v) => updateOrigin("manual", "selected", "border", v)}
            />
            <ColorField
              label="비선택 배경"
              value={settings.manual.unselected.background}
              onChange={(v) => updateOrigin("manual", "unselected", "background", v)}
            />
            <ColorField
              label="비선택 테두리"
              value={settings.manual.unselected.border}
              onChange={(v) => updateOrigin("manual", "unselected", "border", v)}
            />
          </fieldset>

          <fieldset>
            <legend>포커스 · 사이드바</legend>
            <ColorField
              label="선택 영역 테두리(포커스 강조)"
              value={settings.focus_border_color}
              onChange={(v) => setColorSettings(updateFocusBorderColor(settings, v))}
            />
            <ColorField
              label="사이드바 선택 배경"
              value={settings.sidebar_selection.background}
              onChange={(v) => updateSidebarSelection("background", v)}
            />
            <ColorField
              label="사이드바 선택 폰트"
              value={settings.sidebar_selection.font}
              onChange={(v) => updateSidebarSelection("font", v)}
            />
          </fieldset>

          <fieldset>
            <legend>탐지 제외영역</legend>
            <ColorField
              label="가이드선 색상"
              value={settings.exclusion_guide_color}
              onChange={(v) => setColorSettings(updateExclusionGuideColor(settings, v))}
            />
          </fieldset>
        </div>
      </div>
    </div>
  );
}
