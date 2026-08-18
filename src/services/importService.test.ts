import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";
import { confirmImport, cancelImport } from "./importConfirm";
import type { ReviewItem } from "../types/generated/ReviewItem";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const { importReviewItems } = await import("./importService");

const SAMPLE_DOC = {
  path: "/a/b.pdf",
  filename: "b.pdf",
  pageCount: 4,
  pageDimensions: [],
  textFingerprint: "sha256:test",
};

const EXISTING_ITEM: ReviewItem = {
  id: "r-0",
  origin: "detected",
  page: 0,
  bbox: { x: 0, y: 0, width: 0.1, height: 0.02 },
  original_bbox: null,
  category: "PhoneNumber",
  content: "010-1234-5678",
  pattern_type: "PhoneNumber",
  confidence: 0.5,
  validation: "ChecksumNotApplicable",
  modified: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const SAMPLE_ROW = {
  filename: "b.pdf",
  category: "전화번호",
  content: "010-9999-8888",
  page: 2,
  bbox: "0.1,0.1,0.2,0.05",
  excluded: "N",
  updated_at: "2026-02-02T00:00:00.000Z",
};

beforeEach(() => {
  invokeMock.mockReset();
  useAppStore.setState({
    document: null,
    reviewItems: [],
    history: { cursor: 0, entries: [] },
    statusMessage: "",
    importConfirmDialogOpen: false,
    positionUncertainItemIds: new Set(),
  });
});

/** 재탐색은 항상 "찾음"으로 응답하는 기본 mock. */
function mockImportFound() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "import_review_items") return Promise.resolve([SAMPLE_ROW]);
    if (cmd === "reanchor_review_item_bboxes") {
      return Promise.resolve([{ x: 0.2, y: 0.2, width: 0.2, height: 0.05 }]);
    }
    throw new Error(`unexpected command: ${cmd}`);
  });
}

describe("importReviewItems (IO-02/03, §5.4/§6.6)", () => {
  it("문서가 없으면 아무 것도 하지 않는다", async () => {
    await importReviewItems();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("기존 목록이 없으면 경고 없이 바로 파일 선택으로 진행한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [] });
    mockImportFound();

    await importReviewItems();

    expect(invokeMock).toHaveBeenCalledWith("import_review_items");
    expect(useAppStore.getState().reviewItems).toHaveLength(1);
    expect(useAppStore.getState().reviewItems[0].content).toBe("010-9999-8888");
    expect(useAppStore.getState().reviewItems[0].bbox).toEqual({
      x: 0.2,
      y: 0.2,
      width: 0.2,
      height: 0.05,
    });
    expect(useAppStore.getState().statusMessage).toContain("가져왔습니다");
    expect(useAppStore.getState().positionUncertainItemIds.size).toBe(0);
  });

  it("재탐색에 실패하면 $bbox로 폴백하고 '위치확인 필요'로 표시한다(IO-03)", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [] });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "import_review_items") return Promise.resolve([SAMPLE_ROW]);
      if (cmd === "reanchor_review_item_bboxes") return Promise.resolve([null]);
      throw new Error(`unexpected command: ${cmd}`);
    });

    await importReviewItems();

    const state = useAppStore.getState();
    expect(state.reviewItems[0].bbox).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.05 });
    expect(state.positionUncertainItemIds.has(state.reviewItems[0].id)).toBe(true);
  });

  it("기존 목록이 있으면 경고 다이얼로그를 띄우고, [확인]하면 가져온다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [EXISTING_ITEM] });
    mockImportFound();

    const promise = importReviewItems();
    await vi.waitFor(() => expect(useAppStore.getState().importConfirmDialogOpen).toBe(true));

    confirmImport();
    await promise;

    expect(useAppStore.getState().importConfirmDialogOpen).toBe(false);
    expect(useAppStore.getState().reviewItems).toHaveLength(1);
    expect(useAppStore.getState().reviewItems[0].content).toBe("010-9999-8888");
    expect(useAppStore.getState().history).toEqual({ cursor: 0, entries: [] });
  });

  it("경고 다이얼로그에서 [취소]하면 기존 목록을 그대로 유지한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [EXISTING_ITEM] });

    const promise = importReviewItems();
    await vi.waitFor(() => expect(useAppStore.getState().importConfirmDialogOpen).toBe(true));

    cancelImport();
    await promise;

    expect(invokeMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().reviewItems).toEqual([EXISTING_ITEM]);
  });

  it("파일 선택을 취소하면(null) 목록을 바꾸지 않는다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [] });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "import_review_items") return Promise.resolve(null);
      throw new Error(`unexpected command: ${cmd}`);
    });

    await importReviewItems();

    expect(useAppStore.getState().reviewItems).toEqual([]);
    expect(useAppStore.getState().statusMessage).toBe("");
  });

  it("실패 시 §7.1 표준 에러 메시지를 상태바에 표출한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [] });
    invokeMock.mockRejectedValue({ code: "IMPORT_FAILED", message: "가져오기 실패 메시지" });

    await importReviewItems();

    expect(useAppStore.getState().statusMessage).toBe("가져오기 실패 메시지");
  });
});
