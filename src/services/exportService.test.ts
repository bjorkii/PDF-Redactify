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

const { exportReviewItems } = await import("./exportService");

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
    busy: false,
    operationProgress: null,
    operationStartedAt: null,
    operationResult: null,
  });
});

describe("exportReviewItems (IO-01)", () => {
  it("문서가 없으면 아무 것도 하지 않는다", async () => {
    await exportReviewItems();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("현재 목록을 xlsx 행으로 변환해 내보내고 완료 요약 + '열기'(xlsx)를 남긴다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [SAMPLE_ITEM] });
    invokeMock.mockResolvedValue("/a/b-블랙마킹목록.xlsx");

    await exportReviewItems();

    expect(invokeMock).toHaveBeenCalledWith("export_review_items", {
      path: "/a/b.pdf",
      rows: [
        {
          filename: "b.pdf",
          category: "전화번호",
          content: "010-1234-5678",
          page: 1,
          bbox: "0.1,0.1,0.2,0.05",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const result = useAppStore.getState().operationResult;
    expect(result?.openPath).toBe("/a/b-블랙마킹목록.xlsx");
    expect(result?.message).toContain("내보냈습니다");
    expect(result?.message).toContain("b-블랙마킹목록.xlsx"); // 파일명(basename) 표시
  });

  it("실패 시 §7.1 표준 에러 메시지를 상태바에 표출한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [] });
    invokeMock.mockRejectedValue({ code: "EXPORT_FAILED", message: "내보내기 실패 메시지" });

    await exportReviewItems();

    expect(useAppStore.getState().statusMessage).toBe("내보내기 실패 메시지");
  });
});
