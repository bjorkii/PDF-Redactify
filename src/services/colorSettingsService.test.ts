import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppStore, DEFAULT_COLOR_SETTINGS } from "../store/appStore";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const { saveColorSettings, loadColorSettings, saveGlobalColorSettings, loadGlobalColorSettings } =
  await import("./colorSettingsService");

beforeEach(() => {
  invokeMock.mockReset();
  useAppStore.setState({ statusMessage: "" });
});

describe("saveColorSettings (COLOR-02)", () => {
  it("성공 시 true를 반환한다", async () => {
    invokeMock.mockResolvedValue(undefined);

    const result = await saveColorSettings("/abs/test.pdf", DEFAULT_COLOR_SETTINGS);

    expect(invokeMock).toHaveBeenCalledWith("save_color_settings", {
      path: "/abs/test.pdf",
      settings: DEFAULT_COLOR_SETTINGS,
    });
    expect(result).toBe(true);
  });

  it("실패 시 false를 반환하고 상태바에 안내한다", async () => {
    invokeMock.mockRejectedValue({ code: "SETTINGS_SAVE_FAILED", message: "저장 실패 메시지" });

    const result = await saveColorSettings("/abs/test.pdf", DEFAULT_COLOR_SETTINGS);

    expect(result).toBe(false);
    expect(useAppStore.getState().statusMessage).toBe("저장 실패 메시지");
  });
});

describe("loadColorSettings (COLOR-02)", () => {
  it("성공 시 설정을 반환한다", async () => {
    invokeMock.mockResolvedValue(DEFAULT_COLOR_SETTINGS);

    const result = await loadColorSettings("/abs/test.pdf");

    expect(invokeMock).toHaveBeenCalledWith("load_color_settings", { path: "/abs/test.pdf" });
    expect(result).toEqual(DEFAULT_COLOR_SETTINGS);
  });

  it("설정 파일이 없으면 null을 반환한다(정상)", async () => {
    invokeMock.mockResolvedValue(null);

    const result = await loadColorSettings("/abs/test.pdf");

    expect(result).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe("");
  });

  it("실패 시 null을 반환하고 상태바에 안내한다", async () => {
    invokeMock.mockRejectedValue({ code: "SETTINGS_LOAD_FAILED", message: "로드 실패 메시지" });

    const result = await loadColorSettings("/abs/test.pdf");

    expect(result).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe("로드 실패 메시지");
  });
});

describe("saveGlobalColorSettings/loadGlobalColorSettings (COLOR-02 전역 기본값)", () => {
  it("saveGlobalColorSettings는 path 없이 settings만 넘긴다", async () => {
    invokeMock.mockResolvedValue(undefined);

    const result = await saveGlobalColorSettings(DEFAULT_COLOR_SETTINGS);

    expect(invokeMock).toHaveBeenCalledWith("save_global_color_settings", { settings: DEFAULT_COLOR_SETTINGS });
    expect(result).toBe(true);
  });

  it("loadGlobalColorSettings는 인자 없이 호출하고 결과를 그대로 돌려준다", async () => {
    invokeMock.mockResolvedValue(DEFAULT_COLOR_SETTINGS);

    const result = await loadGlobalColorSettings();

    expect(invokeMock).toHaveBeenCalledWith("load_global_color_settings");
    expect(result).toEqual(DEFAULT_COLOR_SETTINGS);
  });

  it("저장된 적 없으면 null을 반환한다(정상)", async () => {
    invokeMock.mockResolvedValue(null);

    const result = await loadGlobalColorSettings();

    expect(result).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe("");
  });
});
