import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";
import type { SidecarDocument } from "../types/generated/SidecarDocument";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const { saveSidecar, loadSidecar } = await import("./sidecarService");

const SAMPLE_DOCUMENT: SidecarDocument = {
  schema_version: 2,
  app: "PDF-Redactify",
  source: {
    filename: "test.pdf",
    path: "/abs/test.pdf",
    page_count: 1,
    text_fingerprint: "sha256:abc",
    created_at: "2026-07-26T00:00:00.000Z",
    updated_at: "2026-07-26T00:00:00.000Z",
  },
  view_state: {
    current_page: 0,
    zoom: 1.0,
    selected_item_id: null,
    focus: "viewer",
    bookmark_sidebar: { visible: true, dock: "left" },
    redaction_sidebar: { visible: true, dock: "right", floating: false, rect: null },
    sort: { column: "position", direction: "asc" },
  },
  page_dimensions: [],
  review_items: [],
  history: { cursor: 0, entries: [] },
  exclusion_zones: [],
};

beforeEach(() => {
  invokeMock.mockReset();
  useAppStore.setState({ statusMessage: "" });
});

describe("saveSidecar (STATE-02)", () => {
  it("성공 시 true를 반환한다", async () => {
    invokeMock.mockResolvedValue(undefined);

    const result = await saveSidecar("/abs/test.pdf", SAMPLE_DOCUMENT);

    expect(invokeMock).toHaveBeenCalledWith("save_sidecar", {
      path: "/abs/test.pdf",
      document: SAMPLE_DOCUMENT,
    });
    expect(result).toBe(true);
  });

  it("실패 시 false를 반환하고 상태바에 안내한다", async () => {
    invokeMock.mockRejectedValue({ code: "SIDECAR_SAVE_FAILED", message: "저장 실패 메시지" });

    const result = await saveSidecar("/abs/test.pdf", SAMPLE_DOCUMENT);

    expect(result).toBe(false);
    expect(useAppStore.getState().statusMessage).toBe("저장 실패 메시지");
  });
});

describe("loadSidecar (STATE-02)", () => {
  it("성공 시 문서를 반환한다", async () => {
    invokeMock.mockResolvedValue(SAMPLE_DOCUMENT);

    const result = await loadSidecar("/abs/test.pdf");

    expect(invokeMock).toHaveBeenCalledWith("load_sidecar", { path: "/abs/test.pdf" });
    expect(result).toEqual(SAMPLE_DOCUMENT);
  });

  it("sidecar가 없으면 null을 반환한다(정상)", async () => {
    invokeMock.mockResolvedValue(null);

    const result = await loadSidecar("/abs/test.pdf");

    expect(result).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe("");
  });

  it("실패 시 null을 반환하고 상태바에 안내한다", async () => {
    invokeMock.mockRejectedValue({ code: "SIDECAR_LOAD_FAILED", message: "로드 실패 메시지" });

    const result = await loadSidecar("/abs/test.pdf");

    expect(result).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe("로드 실패 메시지");
  });
});
