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

const { runDetection, cancelDetection } = await import("./detectionService");
const { confirmDetection, cancelDetectionConfirm } = await import("./detectionConfirm");

const SAMPLE_DOC = {
  path: "/a/b.pdf",
  filename: "b.pdf",
  pageCount: 4,
  pageDimensions: [
    { pageNumber: 1, pageWidth: 612, pageHeight: 792, textLayerStatus: "HasText" as const },
  ],
  textFingerprint: "sha256:test",
};

const NO_TEXT_DOC = {
  ...SAMPLE_DOC,
  pageDimensions: [
    { pageNumber: 1, pageWidth: 612, pageHeight: 792, textLayerStatus: "NoText" as const },
  ],
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
    statusMessage: "",
    reviewItems: [],
    detectionInProgress: false,
    excludedDetectionCategories: [],
  });
});

describe("runDetection (DET-05)", () => {
  it("문서가 없으면 아무 것도 하지 않는다", async () => {
    await runDetection();

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("DET-OPT: 제외 카테고리(excludedDetectionCategories)는 결과에서 뺀다", async () => {
    const phone = { ...SAMPLE_ITEM, id: "r-0", category: "PhoneNumber" };
    const rrn = { ...SAMPLE_ITEM, id: "r-1", category: "RRN" };
    useAppStore.setState({ document: SAMPLE_DOC, excludedDetectionCategories: ["RRN"] });
    invokeMock.mockResolvedValue([phone, rrn]);

    await runDetection();

    expect(useAppStore.getState().reviewItems.map((i) => i.category)).toEqual(["PhoneNumber"]);
  });

  it("성공 시 reviewItems를 결과로 교체하고 완료 메시지를 표시한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC });
    invokeMock.mockResolvedValue([SAMPLE_ITEM]);

    await runDetection();

    expect(invokeMock).toHaveBeenCalledWith("detect_review_items", { path: "/a/b.pdf", exclusionZones: [] });
    expect(useAppStore.getState().reviewItems).toEqual([SAMPLE_ITEM]);
    expect(useAppStore.getState().statusMessage).toContain("1건");
    expect(useAppStore.getState().detectionInProgress).toBe(false);
  });

  it("실행 중에는 detectionInProgress가 true다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC });
    let resolveInvoke: (items: ReviewItem[]) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );

    const promise = runDetection();
    expect(useAppStore.getState().detectionInProgress).toBe(true);

    resolveInvoke([]);
    await promise;

    expect(useAppStore.getState().detectionInProgress).toBe(false);
  });

  it("DET-06: 텍스트 레이어가 전혀 없으면 알림만 표시하고 검출을 시작하지 않는다", async () => {
    useAppStore.setState({ document: NO_TEXT_DOC });

    await runDetection();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().statusMessage).toBe(
      "이 파일에는 검출 가능한 텍스트 정보가 없으므로 자동검출은 실시할 수 없습니다.",
    );
    expect(useAppStore.getState().detectionInProgress).toBe(false);
  });

  it("실패 시 §7.1 표준 에러 메시지를 상태바에 표출하고 detectionInProgress를 되돌린다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC });
    invokeMock.mockRejectedValue({ code: "DETECTION_FAILED", message: "자동검출 중 오류가 발생했습니다." });

    await runDetection();

    expect(useAppStore.getState().statusMessage).toBe("자동검출 중 오류가 발생했습니다.");
    expect(useAppStore.getState().detectionInProgress).toBe(false);
    expect(useAppStore.getState().reviewItems).toEqual([]);
  });
});

describe("runDetection — 기존 목록 덮어쓰기 확인 (DET-05)", () => {
  const EXISTING_ITEM: ReviewItem = { ...SAMPLE_ITEM, id: "r-existing" };

  it("기존 목록이 있으면 확인 다이얼로그를 띄우고, [실행]해야 검출을 진행한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [EXISTING_ITEM] });
    invokeMock.mockResolvedValue([SAMPLE_ITEM]);

    const promise = runDetection();
    await vi.waitFor(() => expect(useAppStore.getState().detectionConfirmDialogOpen).toBe(true));
    expect(invokeMock).not.toHaveBeenCalled();

    confirmDetection();
    await promise;

    expect(useAppStore.getState().detectionConfirmDialogOpen).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("detect_review_items", { path: "/a/b.pdf", exclusionZones: [] });
    expect(useAppStore.getState().reviewItems).toEqual([SAMPLE_ITEM]);
  });

  it("확인 다이얼로그에서 [취소]하면 기존 목록을 그대로 두고 검출을 실행하지 않는다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [EXISTING_ITEM] });

    const promise = runDetection();
    await vi.waitFor(() => expect(useAppStore.getState().detectionConfirmDialogOpen).toBe(true));

    cancelDetectionConfirm();
    await promise;

    expect(invokeMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().reviewItems).toEqual([EXISTING_ITEM]);
  });

  it("기존 목록이 비어 있으면 확인 없이 바로 검출한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [] });
    invokeMock.mockResolvedValue([SAMPLE_ITEM]);

    await runDetection();

    expect(useAppStore.getState().detectionConfirmDialogOpen).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("detect_review_items", { path: "/a/b.pdf", exclusionZones: [] });
  });

  it("기존 목록에 사용자 지정(manual) 항목만 있으면 확인 없이 바로 검출한다(사라질 게 없으므로)", async () => {
    const manualOnly = { ...SAMPLE_ITEM, id: "m-1", origin: "manual" as const };
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [manualOnly] });
    invokeMock.mockResolvedValue([]);

    await runDetection();

    expect(useAppStore.getState().detectionConfirmDialogOpen).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("detect_review_items", { path: "/a/b.pdf", exclusionZones: [] });
  });
});

describe("runDetection — 사용자 지정 항목 보존 + 겹침 제외 (DET-05)", () => {
  it("재검출해도 manual/imported 항목은 그대로 남고, 새 검출 결과와 합쳐진다", async () => {
    const manualItem = {
      ...SAMPLE_ITEM,
      id: "m-1",
      origin: "manual" as const,
      page: 1,
      bbox: { x: 0.6, y: 0.6, width: 0.1, height: 0.1 },
    };
    const importedItem = { ...SAMPLE_ITEM, id: "i-1", origin: "imported" as const, page: 2 };
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [manualItem, importedItem] });
    const newDetected = { ...SAMPLE_ITEM, id: "d-new" };
    invokeMock.mockResolvedValue([newDetected]);

    await runDetection();

    const items = useAppStore.getState().reviewItems;
    expect(items).toContainEqual(manualItem);
    expect(items).toContainEqual(importedItem);
    expect(items).toContainEqual(newDetected);
    expect(items).toHaveLength(3);
  });

  it("기존 자동검출(detected) 항목은 재검출 결과로 교체되고 남지 않는다", async () => {
    const oldDetected = { ...SAMPLE_ITEM, id: "d-old" };
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [oldDetected] });
    const newDetected = { ...SAMPLE_ITEM, id: "d-new" };
    invokeMock.mockResolvedValue([newDetected]);

    const promise = runDetection();
    await vi.waitFor(() => expect(useAppStore.getState().detectionConfirmDialogOpen).toBe(true));
    confirmDetection();
    await promise;

    const items = useAppStore.getState().reviewItems;
    expect(items).not.toContainEqual(oldDetected);
    expect(items).toEqual([newDetected]);
  });

  it("새 검출 후보가 사용자 지정 항목과 같은 자리에 겹치면 제외한다", async () => {
    const manualItem = {
      ...SAMPLE_ITEM,
      id: "m-1",
      origin: "manual" as const,
      page: 0,
      bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
    };
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [manualItem] });
    // manualItem과 정확히 같은 자리(page 0, 같은 bbox)에 새로 검출된 후보 — 겹침.
    const overlappingDetected = { ...SAMPLE_ITEM, id: "d-overlap", page: 0 };
    invokeMock.mockResolvedValue([overlappingDetected]);

    await runDetection();

    const items = useAppStore.getState().reviewItems;
    expect(items).toEqual([manualItem]);
    expect(useAppStore.getState().statusMessage).toContain("0건");
  });
});

describe("runDetection — 검출 결과가 현재 페이지에 없으면 첫 항목 페이지로 이동 (DET-05)", () => {
  it("현재 페이지(0)에 검출 항목이 없으면 항목이 있는 첫 페이지로 이동한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [], currentPageIndex: 0 });
    const itemOnPage2: ReviewItem = { ...SAMPLE_ITEM, page: 2 };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "detect_review_items") return Promise.resolve([itemOnPage2]);
      if (cmd === "render_page") {
        return Promise.resolve({
          pageIndex: 2,
          width: 612,
          height: 792,
          pageWidthPt: 612,
          pageHeightPt: 792,
          pngBase64: "",
        });
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await runDetection();

    expect(useAppStore.getState().currentPageIndex).toBe(2);
  });

  it("현재 페이지에 이미 검출 항목이 있으면 페이지를 옮기지 않는다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, reviewItems: [], currentPageIndex: 0 });
    invokeMock.mockResolvedValue([SAMPLE_ITEM]); // SAMPLE_ITEM.page === 0

    await runDetection();

    expect(useAppStore.getState().currentPageIndex).toBe(0);
  });
});

describe("runDetection — 탐지 제외영역을 함께 전달 (DET-07)", () => {
  it("exclusionZones 항목은 page_index(snake_case)로 전달된다 — pageIndex(camelCase)로 보내면 Rust PageExclusionZone이 항상 0으로 역직렬화돼 제외영역이 무시된다", async () => {
    useAppStore.setState({
      document: SAMPLE_DOC,
      exclusionZones: [{ pageIndex: 2, margins: { top: 0.1, bottom: 0, left: 0, right: 0 } }],
    });
    invokeMock.mockResolvedValue([]);

    await runDetection();

    expect(invokeMock).toHaveBeenCalledWith("detect_review_items", {
      path: "/a/b.pdf",
      exclusionZones: [{ page_index: 2, margins: { top: 0.1, bottom: 0, left: 0, right: 0 } }],
    });
  });
});

describe("cancelDetection (DET-05)", () => {
  it("cancel_detection command를 호출한다", async () => {
    invokeMock.mockResolvedValue(undefined);

    await cancelDetection();

    expect(invokeMock).toHaveBeenCalledWith("cancel_detection");
  });
});
