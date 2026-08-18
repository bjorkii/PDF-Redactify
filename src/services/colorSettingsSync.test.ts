import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useAppStore, DEFAULT_COLOR_SETTINGS } from "../store/appStore";
import { updateFocusBorderColor } from "../utils/colorSettingsUpdate";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const { startColorSettingsSync, COLOR_SETTINGS_DEBOUNCE_MS } = await import("./colorSettingsSync");

const SAMPLE_DOC = {
  path: "/a/b.pdf",
  filename: "b.pdf",
  pageCount: 2,
  pageDimensions: [],
  textFingerprint: "sha256:aaa",
};

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  useAppStore.setState({ document: null, colorSettings: DEFAULT_COLOR_SETTINGS });
  stop = startColorSettingsSync();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe("startColorSettingsSync (COLOR-02)", () => {
  it("문서가 없어도 전역 기본값은 저장하되, 문서/폴더 단위 저장은 하지 않는다", async () => {
    useAppStore.getState().setColorSettings(updateFocusBorderColor(DEFAULT_COLOR_SETTINGS, "#ff0000"));
    await vi.advanceTimersByTimeAsync(COLOR_SETTINGS_DEBOUNCE_MS + 10);

    expect(invokeMock).toHaveBeenCalledWith("save_global_color_settings", {
      settings: expect.objectContaining({ focus_border_color: "#ff0000" }),
    });
    expect(invokeMock).not.toHaveBeenCalledWith("save_color_settings", expect.anything());
  });

  it("문서가 있으면 디바운스 후 전역 기본값과 문서/폴더 단위 설정 둘 다 저장한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);

    useAppStore.getState().setColorSettings(updateFocusBorderColor(DEFAULT_COLOR_SETTINGS, "#ff0000"));
    await vi.advanceTimersByTimeAsync(COLOR_SETTINGS_DEBOUNCE_MS - 100);
    expect(invokeMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(invokeMock).toHaveBeenCalledWith("save_global_color_settings", {
      settings: expect.objectContaining({ focus_border_color: "#ff0000" }),
    });
    expect(invokeMock).toHaveBeenCalledWith("save_color_settings", {
      path: "/a/b.pdf",
      settings: expect.objectContaining({ focus_border_color: "#ff0000" }),
    });
  });

  it("디바운스 시간 내에 여러 번 바뀌면 한 번만 저장한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);

    useAppStore.getState().setColorSettings(updateFocusBorderColor(DEFAULT_COLOR_SETTINGS, "#111111"));
    await vi.advanceTimersByTimeAsync(COLOR_SETTINGS_DEBOUNCE_MS / 2);
    useAppStore.getState().setColorSettings(updateFocusBorderColor(DEFAULT_COLOR_SETTINGS, "#222222"));
    await vi.advanceTimersByTimeAsync(COLOR_SETTINGS_DEBOUNCE_MS + 10);

    expect(invokeMock).toHaveBeenCalledTimes(2); // 전역 1회 + 문서/폴더 1회
    expect(invokeMock).toHaveBeenCalledWith(
      "save_color_settings",
      expect.objectContaining({ settings: expect.objectContaining({ focus_border_color: "#222222" }) }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "save_global_color_settings",
      expect.objectContaining({ settings: expect.objectContaining({ focus_border_color: "#222222" }) }),
    );
  });

  it("해제(unsubscribe) 후에는 변동이 있어도 저장하지 않는다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC });
    stop?.();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);

    useAppStore.getState().setColorSettings(updateFocusBorderColor(DEFAULT_COLOR_SETTINGS, "#ff0000"));
    await vi.advanceTimersByTimeAsync(COLOR_SETTINGS_DEBOUNCE_MS + 10);

    expect(invokeMock).not.toHaveBeenCalled();
  });
});
