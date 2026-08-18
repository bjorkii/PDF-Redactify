import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useAppStore } from "../store/appStore";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const { startAutosave, AUTOSAVE_DEBOUNCE_MS } = await import("./autosave");

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
  useAppStore.setState({
    document: null,
    sidecarCreatedAt: null,
    currentPageIndex: 0,
    zoomScale: 1.0,
    selectedItemId: null,
    sort: { column: "position", direction: "asc" },
    bookmarkSidebar: { visible: true, dock: "left", width: 240 },
    redactionSidebar: { visible: true, dock: "right", floating: false, rect: null, width: 240 },
  });
  stop = startAutosave();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe("startAutosave (STATE-03)", () => {
  it("문서가 없을 때는 필드가 바뀌어도 저장하지 않는다", async () => {
    useAppStore.getState().setZoomScale(1.5);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("view_state 관련 필드가 바뀌면 디바운스 후 sidecar를 저장한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);

    useAppStore.getState().setZoomScale(2.0);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 100);
    expect(invokeMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(invokeMock).toHaveBeenCalledWith(
      "save_sidecar",
      expect.objectContaining({
        path: "/a/b.pdf",
        document: expect.objectContaining({
          view_state: expect.objectContaining({ zoom: 2.0 }),
        }),
      }),
    );
  });

  it("디바운스 시간 내에 여러 번 바뀌면 한 번만 저장한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);

    useAppStore.getState().setCurrentPageIndex(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS / 2);
    useAppStore.getState().setCurrentPageIndex(2);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith(
      "save_sidecar",
      expect.objectContaining({
        document: expect.objectContaining({
          view_state: expect.objectContaining({ current_page: 2 }),
        }),
      }),
    );
  });

  it("해제(unsubscribe) 후에는 변동이 있어도 저장하지 않는다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC });
    stop?.();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);

    useAppStore.getState().setZoomScale(3.0);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);

    expect(invokeMock).not.toHaveBeenCalled();
  });
});
