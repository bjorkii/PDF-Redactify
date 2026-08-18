import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";

const openPdfFromPathMock = vi.fn();
const publishStatusMock = vi.fn();
let dragDropHandler: ((event: { payload: unknown }) => void) | undefined;
const unlistenMock = vi.fn();
const onDragDropEventMock = vi.fn((handler: (event: { payload: unknown }) => void) => {
  dragDropHandler = handler;
  return Promise.resolve(unlistenMock);
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: onDragDropEventMock }),
}));
vi.mock("./pdfService", () => ({
  openPdfFromPath: (...args: unknown[]) => openPdfFromPathMock(...args),
}));
vi.mock("./statusBus", () => ({
  publishStatus: (...args: unknown[]) => publishStatusMock(...args),
}));

const { startDragDropOpen } = await import("./dragDropOpen");

beforeEach(() => {
  openPdfFromPathMock.mockReset();
  publishStatusMock.mockReset();
  unlistenMock.mockReset();
  dragDropHandler = undefined;
  useAppStore.setState({ dragOverActive: false });
});

describe("startDragDropOpen (드래그 앤 드롭으로 파일 열기)", () => {
  it("파일 드래그(enter+paths)에서만 dragOverActive를 켠다", async () => {
    startDragDropOpen();
    await vi.waitFor(() => expect(dragDropHandler).toBeDefined());

    // 파일 경로가 있는 enter → 오버레이 켬.
    dragDropHandler!({ payload: { type: "enter", paths: ["/a/doc.pdf"], position: {} } });
    expect(useAppStore.getState().dragOverActive).toBe(true);
    // over는 상태를 바꾸지 않는다(계속 켜짐).
    dragDropHandler!({ payload: { type: "over", position: {} } });
    expect(useAppStore.getState().dragOverActive).toBe(true);
  });

  it("내부 드래그(paths 없는 enter)에서는 켜지 않는다", async () => {
    startDragDropOpen();
    await vi.waitFor(() => expect(dragDropHandler).toBeDefined());

    // 뷰포트 내부 드래그(파일 아님)는 paths가 비어 있어 오버레이가 뜨지 않는다.
    dragDropHandler!({ payload: { type: "enter", paths: [], position: {} } });
    expect(useAppStore.getState().dragOverActive).toBe(false);
    dragDropHandler!({ payload: { type: "over", position: {} } });
    expect(useAppStore.getState().dragOverActive).toBe(false);
  });

  it("leave 시 dragOverActive를 끈다", async () => {
    startDragDropOpen();
    await vi.waitFor(() => expect(dragDropHandler).toBeDefined());

    dragDropHandler!({ payload: { type: "enter", paths: ["/a/doc.pdf"], position: {} } });
    expect(useAppStore.getState().dragOverActive).toBe(true);
    dragDropHandler!({ payload: { type: "leave" } });

    expect(useAppStore.getState().dragOverActive).toBe(false);
  });

  it("PDF를 놓으면 dragOverActive를 끄고 그 경로로 연다", async () => {
    startDragDropOpen();
    await vi.waitFor(() => expect(dragDropHandler).toBeDefined());

    dragDropHandler!({
      payload: { type: "drop", paths: ["/a/readme.txt", "/a/doc.pdf"], position: {} },
    });

    expect(useAppStore.getState().dragOverActive).toBe(false);
    expect(openPdfFromPathMock).toHaveBeenCalledWith("/a/doc.pdf");
  });

  it("PDF가 아닌 파일만 놓으면 안내 메시지를 표시하고 열지 않는다", async () => {
    startDragDropOpen();
    await vi.waitFor(() => expect(dragDropHandler).toBeDefined());

    dragDropHandler!({ payload: { type: "drop", paths: ["/a/readme.txt"], position: {} } });

    expect(openPdfFromPathMock).not.toHaveBeenCalled();
    expect(publishStatusMock).toHaveBeenCalledWith("PDF 파일만 열 수 있습니다.");
  });

  it("반환된 함수를 호출하면 구독을 해제한다", async () => {
    const stop = startDragDropOpen();
    await vi.waitFor(() => expect(dragDropHandler).toBeDefined());

    stop();

    expect(unlistenMock).toHaveBeenCalledOnce();
  });
});
