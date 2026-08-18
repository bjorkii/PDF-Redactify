import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";
import type { ReviewItem } from "../types/generated/ReviewItem";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const { saveRedactedDocument } = await import("./saveService");
const { confirmSaveWithFilter, cancelSaveWithFilter } = await import("./saveFilterConfirm");

const SAMPLE_DOC = {
  path: "/a/b.pdf",
  filename: "b.pdf",
  pageCount: 4,
  pageDimensions: [],
  textFingerprint: "sha256:test",
};

const SAMPLE_ITEM: ReviewItem = {
  id: "r-0",
  origin: "detected",
  page: 0,
  bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
  original_bbox: null,
  category: "PhoneNumber",
  content: "010-1234-5678",
  pattern_type: "PhoneNumber",
  confidence: 0.7,
  validation: "ChecksumNotApplicable",
  modified: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  invokeMock.mockReset();
  useAppStore.setState({
    document: null,
    reviewItems: [],
    statusMessage: "",
    reviewListFilter: { categories: null, pages: null },
    saveFilterWarningDialogOpen: false,
    busy: false,
    operationProgress: null,
    operationStartedAt: null,
    operationResult: null,
  });
});

describe("saveRedactedDocument (SAVE-03, §6.7/§8.4)", () => {
  it("문서가 없으면 아무 것도 하지 않는다", async () => {
    await saveRedactedDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("반영 저장과 Excel 내보내기를 함께 호출하고 완료 요약 + '열기'(PDF)를 남긴다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [SAMPLE_ITEM] });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "save_redacted_document") {
        // UI-PROGRESS: SaveCompletion(path·쪽수·소요시간·용량) 반환.
        return Promise.resolve({
          path: "/a/b-redacted.pdf",
          pageCount: 4,
          elapsedMs: 83_000,
          originalBytes: 1_000_000,
          outputBytes: 2_048_576,
        });
      }
      if (cmd === "export_review_items") return Promise.resolve("/a/b-블랙마킹목록.xlsx");
      throw new Error(`unexpected command: ${cmd}`);
    });

    await saveRedactedDocument();

    expect(invokeMock).toHaveBeenCalledWith("save_redacted_document", {
      path: "/a/b.pdf",
      items: [SAMPLE_ITEM],
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "export_review_items",
      expect.objectContaining({ path: "/a/b.pdf" }),
    );
    const result = useAppStore.getState().operationResult;
    expect(result?.openPath).toBe("/a/b-redacted.pdf");
    expect(result?.message).toContain("블랙마킹이 적용 완료됐습니다.");
    expect(result?.message).toContain("4쪽");
    expect(result?.message).toContain("소요시간 총 01:23");
    expect(result?.message).toContain("1.0MB 증가");
  });

  it("SAVE-05: 저장 다이얼로그를 취소하면(null) Excel 내보내기를 호출하지 않고 취소 메시지를 표시한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [SAMPLE_ITEM] });
    invokeMock.mockResolvedValue(null);

    await saveRedactedDocument();

    expect(invokeMock).toHaveBeenCalledWith("save_redacted_document", {
      path: "/a/b.pdf",
      items: [SAMPLE_ITEM],
    });
    expect(invokeMock).not.toHaveBeenCalledWith("export_review_items", expect.anything());
    expect(useAppStore.getState().statusMessage).toBe("저장을 취소했습니다.");
  });

  it("저장 실패 시 §7.1 표준 에러 메시지를 상태바에 표출한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [] });
    invokeMock.mockRejectedValue({ code: "SAVE_FAILED", message: "저장 실패 메시지" });

    await saveRedactedDocument();

    expect(useAppStore.getState().statusMessage).toBe("저장 실패 메시지");
  });

  it("PDF 저장은 성공했지만 Excel 내보내기가 실패하면 에러를 표시한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [] });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "save_redacted_document") return Promise.resolve("/a/b-redacted.pdf");
      if (cmd === "export_review_items") {
        return Promise.reject({ code: "EXPORT_FAILED", message: "내보내기 실패 메시지" });
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await saveRedactedDocument();

    expect(useAppStore.getState().statusMessage).toBe("내보내기 실패 메시지");
  });

  it("LIST-14: 구분 필터로 숨긴 항목이 있으면 경고 후 [그대로 저장] 시 보이는 카테고리만 반영한다", async () => {
    const phone = { ...SAMPLE_ITEM, id: "r-0", category: "PhoneNumber" };
    const rrn = { ...SAMPLE_ITEM, id: "r-1", category: "RRN", content: "901231-1234563" };
    useAppStore.setState({
      document: SAMPLE_DOC,
      reviewItems: [phone, rrn],
      reviewListFilter: { categories: ["PhoneNumber"], pages: null }, // RRN 숨김
    });
    invokeMock.mockResolvedValue("/a/b-redacted.pdf");

    const savePromise = saveRedactedDocument();
    // 경고 다이얼로그가 열린다.
    expect(useAppStore.getState().saveFilterWarningDialogOpen).toBe(true);
    confirmSaveWithFilter(); // [그대로 저장]
    await savePromise;

    const saveCall = invokeMock.mock.calls.find((c) => c[0] === "save_redacted_document");
    expect(saveCall?.[1].items).toEqual([phone]); // 숨긴 RRN 제외
  });

  it("LIST-14: 경고에서 [취소]하면 저장하지 않는다", async () => {
    const phone = { ...SAMPLE_ITEM, id: "r-0", category: "PhoneNumber" };
    const rrn = { ...SAMPLE_ITEM, id: "r-1", category: "RRN" };
    useAppStore.setState({
      document: SAMPLE_DOC,
      reviewItems: [phone, rrn],
      reviewListFilter: { categories: ["PhoneNumber"], pages: null },
    });

    const savePromise = saveRedactedDocument();
    cancelSaveWithFilter();
    await savePromise;

    expect(invokeMock.mock.calls.some((c) => c[0] === "save_redacted_document")).toBe(false);
    expect(useAppStore.getState().statusMessage).toBe("저장을 취소했습니다.");
  });
});
