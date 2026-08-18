import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const { loadDetectionCategories, saveDetectionCategories } = await import("./detectionCategoriesService");

beforeEach(() => {
  invokeMock.mockReset();
  useAppStore.setState({ excludedDetectionCategories: [] });
});

describe("detectionCategoriesService (DET-OPT)", () => {
  it("load는 저장된 제외 목록을 store에 반영한다", async () => {
    invokeMock.mockResolvedValue(["RRN", "Email"]);

    await loadDetectionCategories();

    expect(invokeMock).toHaveBeenCalledWith("load_detection_categories");
    expect(useAppStore.getState().excludedDetectionCategories).toEqual(["RRN", "Email"]);
  });

  it("load 결과가 null이면 기본값(빈 목록=전체 검출)을 유지한다", async () => {
    invokeMock.mockResolvedValue(null);

    await loadDetectionCategories();

    expect(useAppStore.getState().excludedDetectionCategories).toEqual([]);
  });

  it("save는 store에 반영하고 전역 파일에도 저장한다", async () => {
    invokeMock.mockResolvedValue(undefined);

    await saveDetectionCategories(["Card"]);

    expect(useAppStore.getState().excludedDetectionCategories).toEqual(["Card"]);
    expect(invokeMock).toHaveBeenCalledWith("save_detection_categories", { excluded: ["Card"] });
  });

  it("save가 실패해도 세션 내 선택은 유지된다", async () => {
    invokeMock.mockRejectedValue(new Error("disk full"));

    await saveDetectionCategories(["Passport"]);

    expect(useAppStore.getState().excludedDetectionCategories).toEqual(["Passport"]);
  });
});
