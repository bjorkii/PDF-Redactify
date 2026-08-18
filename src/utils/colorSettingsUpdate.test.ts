import { describe, expect, it } from "vitest";
import { updateOriginColor, updateFocusBorderColor, updateSidebarSelectionColor } from "./colorSettingsUpdate";
import { DEFAULT_COLOR_SETTINGS } from "../store/appStore";

describe("updateOriginColor (COLOR-01, §7.3)", () => {
  it("detected 선택 배경만 바꾸고 나머지는 그대로 둔다", () => {
    const result = updateOriginColor(DEFAULT_COLOR_SETTINGS, "detected", "selected", "background", "#ff0000");

    expect(result.detected.selected.background).toBe("#ff0000");
    expect(result.detected.selected.border).toBe(DEFAULT_COLOR_SETTINGS.detected.selected.border);
    expect(result.detected.unselected).toEqual(DEFAULT_COLOR_SETTINGS.detected.unselected);
    expect(result.manual).toEqual(DEFAULT_COLOR_SETTINGS.manual);
  });

  it("manual 비선택 테두리만 바꾼다", () => {
    const result = updateOriginColor(DEFAULT_COLOR_SETTINGS, "manual", "unselected", "border", "#00ff00");

    expect(result.manual.unselected.border).toBe("#00ff00");
    expect(result.detected).toEqual(DEFAULT_COLOR_SETTINGS.detected);
  });

  it("원본 객체를 변경하지 않는다", () => {
    const before = JSON.stringify(DEFAULT_COLOR_SETTINGS);
    updateOriginColor(DEFAULT_COLOR_SETTINGS, "detected", "selected", "background", "#ff0000");
    expect(JSON.stringify(DEFAULT_COLOR_SETTINGS)).toBe(before);
  });
});

describe("updateFocusBorderColor (COLOR-01, §7.3/§7.4)", () => {
  it("focus_border_color만 바꾼다", () => {
    const result = updateFocusBorderColor(DEFAULT_COLOR_SETTINGS, "#123456");
    expect(result.focus_border_color).toBe("#123456");
    expect(result.detected).toEqual(DEFAULT_COLOR_SETTINGS.detected);
  });
});

describe("updateSidebarSelectionColor (COLOR-01, §7.3)", () => {
  it("배경만 바꾼다", () => {
    const result = updateSidebarSelectionColor(DEFAULT_COLOR_SETTINGS, "background", "#abcdef");
    expect(result.sidebar_selection.background).toBe("#abcdef");
    expect(result.sidebar_selection.font).toBe(DEFAULT_COLOR_SETTINGS.sidebar_selection.font);
  });

  it("폰트만 바꾼다", () => {
    const result = updateSidebarSelectionColor(DEFAULT_COLOR_SETTINGS, "font", "#000000");
    expect(result.sidebar_selection.font).toBe("#000000");
  });
});
