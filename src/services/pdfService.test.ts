import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";
import { chooseCancel, chooseOpenAnyway, chooseRedetect } from "./identityMismatch";
import { clearRenderCache } from "./renderCache";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const {
  openPdf,
  openPdfFromPath,
  fetchAndStoreBookmarks,
  renderCurrentPage,
  fetchRenderedPage,
  goToPage,
  goToNextPage,
  goToPreviousPage,
  setZoom,
  zoomIn,
  zoomOut,
  registerScrollToPage,
} = await import("./pdfService");

const SAMPLE_DOC = {
  path: "/a/b.pdf",
  filename: "b.pdf",
  pageCount: 4,
  pageDimensions: [
    { pageNumber: 1, pageWidth: 612, pageHeight: 792, textLayerStatus: "HasText" as const },
  ],
  textFingerprint: "sha256:test",
};
const SAMPLE_RENDER = {
  pageIndex: 0,
  width: 100,
  height: 150,
  pageWidthPt: 200,
  pageHeightPt: 300,
  pngBase64: "iVBORw0KGgo=",
};

beforeEach(() => {
  invokeMock.mockReset();
  registerScrollToPage(null);
  clearRenderCache();
  useAppStore.setState({
    statusMessage: "",
    document: null,
    bookmarks: [],
    renderedPage: null,
    currentPageIndex: 0,
    zoomScale: 1.0,
    viewMode: "paginated",
    identityMismatchDialogOpen: false,
  });
});

const SAMPLE_BOOKMARKS = [{ title: "표지", pageIndex: 0, children: [] }];

describe("openPdf", () => {
  it("sidecar가 없으면(최초 실행) 첫 페이지·100%로 시작하고 북마크를 요청한다", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "open_pdf") return Promise.resolve(SAMPLE_DOC);
      if (cmd === "load_sidecar") return Promise.resolve(null);
      if (cmd === "load_color_settings") return Promise.resolve(null);
      if (cmd === "render_page") return Promise.resolve(SAMPLE_RENDER);
      if (cmd === "get_bookmarks") return Promise.resolve(SAMPLE_BOOKMARKS);
      throw new Error(`unexpected command: ${cmd}`);
    });

    await openPdf();

    expect(invokeMock).toHaveBeenCalledWith("open_pdf");
    expect(invokeMock).toHaveBeenCalledWith("load_sidecar", { path: "/a/b.pdf" });
    expect(invokeMock).toHaveBeenCalledWith("render_page", {
      path: "/a/b.pdf",
      pageIndex: 0,
      scale: 1.0,
    });
    expect(invokeMock).toHaveBeenCalledWith("get_bookmarks", { path: "/a/b.pdf" });
    expect(useAppStore.getState().document).toEqual(SAMPLE_DOC);
    expect(useAppStore.getState().renderedPage).toEqual(SAMPLE_RENDER);
    expect(useAppStore.getState().bookmarks).toEqual(SAMPLE_BOOKMARKS);
    expect(useAppStore.getState().statusMessage).toContain("b.pdf");
  });

  it("DET-06: 텍스트 레이어가 전혀 없으면(스캔본) 안내 문구로 덮어쓴다", async () => {
    const noTextDoc = {
      ...SAMPLE_DOC,
      pageDimensions: [
        { pageNumber: 1, pageWidth: 612, pageHeight: 792, textLayerStatus: "NoText" as const },
      ],
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "open_pdf") return Promise.resolve(noTextDoc);
      if (cmd === "load_sidecar") return Promise.resolve(null);
      if (cmd === "load_color_settings") return Promise.resolve(null);
      if (cmd === "render_page") return Promise.resolve(SAMPLE_RENDER);
      if (cmd === "get_bookmarks") return Promise.resolve(SAMPLE_BOOKMARKS);
      throw new Error(`unexpected command: ${cmd}`);
    });

    await openPdf();

    expect(useAppStore.getState().statusMessage).toBe(
      "이 파일에는 검출 가능한 텍스트 정보가 없으므로 자동검출은 실시할 수 없습니다.",
    );
  });

  it("sidecar가 있으면(STATE-04) view_state를 복원하고 그 페이지를 그 배율로 렌더한다", async () => {
    const sidecarDocument = {
      schema_version: 2,
      app: "PDF-Redactify",
      source: {
        filename: SAMPLE_DOC.filename,
        path: SAMPLE_DOC.path,
        page_count: SAMPLE_DOC.pageCount,
        text_fingerprint: SAMPLE_DOC.textFingerprint,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      view_state: {
        current_page: 2,
        zoom: 1.5,
        selected_item_id: "r-1",
        focus: "viewer",
        bookmark_sidebar: { visible: false, dock: "right" },
        redaction_sidebar: { visible: true, dock: "left", floating: false, rect: null },
        sort: { column: "page", direction: "desc" },
      },
      page_dimensions: [
        { page_number: 1, page_width: 612, page_height: 792, unit: "pt", text_layer_status: "HasText" },
      ],
      review_items: [],
      history: { cursor: 0, entries: [] },
      exclusion_zones: [],
    };

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "open_pdf") return Promise.resolve(SAMPLE_DOC);
      if (cmd === "load_sidecar") return Promise.resolve(sidecarDocument);
      if (cmd === "load_color_settings") return Promise.resolve(null);
      if (cmd === "render_page") return Promise.resolve(SAMPLE_RENDER);
      if (cmd === "get_bookmarks") return Promise.resolve(SAMPLE_BOOKMARKS);
      throw new Error(`unexpected command: ${cmd}`);
    });

    await openPdf();

    expect(invokeMock).toHaveBeenCalledWith("render_page", {
      path: "/a/b.pdf",
      pageIndex: 2,
      scale: 1.5,
    });
    const state = useAppStore.getState();
    expect(state.currentPageIndex).toBe(2);
    expect(state.zoomScale).toBe(1.5);
    expect(state.selectedItemId).toBe("r-1");
    expect(state.sort).toEqual({ column: "page", direction: "desc" });
    expect(state.bookmarkSidebar).toEqual({ visible: false, dock: "right", width: 240 });
  });

  it("다이얼로그 취소(null) 시 아무 상태도 바꾸지 않는다", async () => {
    invokeMock.mockResolvedValue(null);

    await openPdf();

    expect(useAppStore.getState().document).toBeNull();
    expect(useAppStore.getState().renderedPage).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe("");
  });

  describe("STATE-05: sidecar와 불일치할 때", () => {
    const mismatchedSidecar = {
      schema_version: 2,
      app: "PDF-Redactify",
      source: {
        filename: "b.pdf",
        path: "/a/b.pdf",
        page_count: 999, // SAMPLE_DOC.pageCount(4)와 불일치
        text_fingerprint: "sha256:test",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      view_state: {
        current_page: 1,
        zoom: 2.0,
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

    function mockInvoke() {
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "open_pdf") return Promise.resolve(SAMPLE_DOC);
        if (cmd === "load_sidecar") return Promise.resolve(mismatchedSidecar);
        if (cmd === "load_color_settings") return Promise.resolve(null);
        if (cmd === "render_page") return Promise.resolve(SAMPLE_RENDER);
        if (cmd === "get_bookmarks") return Promise.resolve(SAMPLE_BOOKMARKS);
        throw new Error(`unexpected command: ${cmd}`);
      });
    }

    it("다이얼로그를 띄우고 [무시하고 열기]를 고르면 sidecar의 view_state를 그대로 적용한다", async () => {
      mockInvoke();
      const openPromise = openPdf();
      await vi.waitFor(() => expect(useAppStore.getState().identityMismatchDialogOpen).toBe(true));

      chooseOpenAnyway();
      await openPromise;

      expect(useAppStore.getState().identityMismatchDialogOpen).toBe(false);
      expect(useAppStore.getState().document).toEqual(SAMPLE_DOC);
      expect(useAppStore.getState().currentPageIndex).toBe(1);
      expect(useAppStore.getState().zoomScale).toBe(2.0);
    });

    it("[재검출]을 고르면 sidecar를 버리고 첫 페이지·100%로 시작한다", async () => {
      mockInvoke();
      const openPromise = openPdf();
      await vi.waitFor(() => expect(useAppStore.getState().identityMismatchDialogOpen).toBe(true));

      chooseRedetect();
      await openPromise;

      expect(useAppStore.getState().document).toEqual(SAMPLE_DOC);
      expect(useAppStore.getState().currentPageIndex).toBe(0);
      expect(useAppStore.getState().zoomScale).toBe(1.0);
    });

    it("[취소]를 고르면 문서를 열지 않고 기존 상태를 유지한다", async () => {
      mockInvoke();
      const openPromise = openPdf();
      await vi.waitFor(() => expect(useAppStore.getState().identityMismatchDialogOpen).toBe(true));

      chooseCancel();
      await openPromise;

      expect(useAppStore.getState().identityMismatchDialogOpen).toBe(false);
      expect(useAppStore.getState().document).toBeNull();
      expect(invokeMock).not.toHaveBeenCalledWith("get_bookmarks", expect.anything());
    });
  });

  it("실패 시 §7.1 표준 에러 메시지를 상태바에 표출한다", async () => {
    invokeMock.mockRejectedValue({
      code: "PDF_LOAD_FAILED",
      message: "PDF 파일이 오류로 인해 열리지 않습니다.",
    });

    await openPdf();

    expect(useAppStore.getState().document).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe("PDF 파일이 오류로 인해 열리지 않습니다.");
  });
});

describe("openPdfFromPath (드래그 앤 드롭으로 파일 열기)", () => {
  it("주어진 경로로 open_pdf_path를 호출하고 나머지는 openPdf와 동일하게 처리한다", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "open_pdf_path") return Promise.resolve(SAMPLE_DOC);
      if (cmd === "load_sidecar") return Promise.resolve(null);
      if (cmd === "load_color_settings") return Promise.resolve(null);
      if (cmd === "render_page") return Promise.resolve(SAMPLE_RENDER);
      if (cmd === "get_bookmarks") return Promise.resolve(SAMPLE_BOOKMARKS);
      throw new Error(`unexpected command: ${cmd}`);
    });

    await openPdfFromPath("/a/b.pdf");

    expect(invokeMock).toHaveBeenCalledWith("open_pdf_path", { path: "/a/b.pdf" });
    expect(useAppStore.getState().document).toEqual(SAMPLE_DOC);
    expect(useAppStore.getState().statusMessage).toContain("b.pdf");
  });

  it("실패 시 §7.1 표준 에러 메시지를 상태바에 표출한다", async () => {
    invokeMock.mockRejectedValue({
      code: "PDF_LOAD_FAILED",
      message: "PDF 파일이 오류로 인해 열리지 않습니다.",
    });

    await openPdfFromPath("/a/broken.pdf");

    expect(useAppStore.getState().document).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe("PDF 파일이 오류로 인해 열리지 않습니다.");
  });
});

describe("fetchAndStoreBookmarks (BM-01)", () => {
  it("성공 시 북마크 트리를 store에 반영한다", async () => {
    invokeMock.mockResolvedValue(SAMPLE_BOOKMARKS);

    await fetchAndStoreBookmarks("/a/b.pdf");

    expect(invokeMock).toHaveBeenCalledWith("get_bookmarks", { path: "/a/b.pdf" });
    expect(useAppStore.getState().bookmarks).toEqual(SAMPLE_BOOKMARKS);
  });

  it("북마크가 없는 문서는 빈 배열(정상)로 반영한다", async () => {
    invokeMock.mockResolvedValue([]);

    await fetchAndStoreBookmarks("/a/b.pdf");

    expect(useAppStore.getState().bookmarks).toEqual([]);
  });

  it("실패 시 §7.1 표준 에러 메시지를 상태바에 표출한다", async () => {
    invokeMock.mockRejectedValue({
      code: "PDF_LOAD_FAILED",
      message: "PDF 파일이 오류로 인해 열리지 않습니다.",
    });

    await fetchAndStoreBookmarks("/a/b.pdf");

    expect(useAppStore.getState().statusMessage).toBe("PDF 파일이 오류로 인해 열리지 않습니다.");
  });
});

describe("renderCurrentPage", () => {
  it("성공 시 store에 렌더 결과를 반영한다", async () => {
    invokeMock.mockResolvedValue(SAMPLE_RENDER);

    await renderCurrentPage("/a/b.pdf", 0);

    expect(invokeMock).toHaveBeenCalledWith("render_page", {
      path: "/a/b.pdf",
      pageIndex: 0,
      scale: 1.0,
    });
    expect(useAppStore.getState().renderedPage).toEqual(SAMPLE_RENDER);
  });

  it("실패 시 §7.1 표준 에러 메시지를 상태바에 표출하고 store를 바꾸지 않는다", async () => {
    invokeMock.mockRejectedValue({
      code: "PDF_LOAD_FAILED",
      message: "PDF 파일이 오류로 인해 열리지 않습니다.",
    });

    await renderCurrentPage("/a/b.pdf", 0);

    expect(useAppStore.getState().renderedPage).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe("PDF 파일이 오류로 인해 열리지 않습니다.");
  });

  it("먼저 시작했지만 나중에 끝난 오래된 렌더링 응답은 버린다(줌 연타 등 경쟁 상태 방지)", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    invokeMock.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const firstCall = renderCurrentPage("/a/b.pdf", 0, 0.5);
    const secondCall = renderCurrentPage("/a/b.pdf", 0, 0.75);

    // 나중에 시작한 두 번째 요청이 먼저 끝난다(IPC 응답 순서는 요청 순서와 무관할 수 있음).
    resolveSecond({ ...SAMPLE_RENDER, width: 750 });
    await secondCall;
    expect(useAppStore.getState().renderedPage).toEqual({ ...SAMPLE_RENDER, width: 750 });

    // 먼저 시작한 첫 번째 요청이 뒤늦게 끝나도 이미 반영된 최신 상태를 덮어쓰지 않는다.
    resolveFirst({ ...SAMPLE_RENDER, width: 500 });
    await firstCall;
    expect(useAppStore.getState().renderedPage).toEqual({ ...SAMPLE_RENDER, width: 750 });
  });
});

describe("goToPage / goToNextPage / goToPreviousPage (PDF-03)", () => {
  beforeEach(() => {
    useAppStore.setState({ document: SAMPLE_DOC, currentPageIndex: 1 });
    invokeMock.mockResolvedValue(SAMPLE_RENDER);
  });

  it("goToPage: 유효 범위 내 페이지로 이동하며 해당 페이지를 렌더한다", async () => {
    await goToPage(2);

    expect(useAppStore.getState().currentPageIndex).toBe(2);
    expect(invokeMock).toHaveBeenCalledWith("render_page", {
      path: SAMPLE_DOC.path,
      pageIndex: 2,
      scale: 1.0,
    });
  });

  it("goToPage: 문서 범위를 벗어나면 가장 가까운 유효 페이지로 고정한다", async () => {
    await goToPage(-5);
    expect(useAppStore.getState().currentPageIndex).toBe(0);

    await goToPage(999);
    expect(useAppStore.getState().currentPageIndex).toBe(SAMPLE_DOC.pageCount - 1);
  });

  it("goToPage: 이미 그 페이지면 렌더를 다시 요청하지 않는다", async () => {
    await goToPage(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("문서가 없으면 아무 것도 하지 않는다", async () => {
    useAppStore.setState({ document: null });
    await goToPage(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("goToNextPage/goToPreviousPage는 현재 페이지 기준 ±1로 이동한다", async () => {
    await goToNextPage();
    expect(useAppStore.getState().currentPageIndex).toBe(2);

    await goToPreviousPage();
    expect(useAppStore.getState().currentPageIndex).toBe(1);
  });
});

describe("setZoom / zoomIn / zoomOut (PDF-04)", () => {
  beforeEach(() => {
    useAppStore.setState({ document: SAMPLE_DOC, currentPageIndex: 2, zoomScale: 1.0 });
    invokeMock.mockResolvedValue(SAMPLE_RENDER);
  });

  it("setZoom: 배율을 갱신하고 현재 페이지를 새 배율로 재렌더한다(§6.1 재렌더 방식)", async () => {
    await setZoom(2.0);

    expect(useAppStore.getState().zoomScale).toBe(2.0);
    expect(invokeMock).toHaveBeenCalledWith("render_page", {
      path: SAMPLE_DOC.path,
      pageIndex: 2,
      scale: 2.0,
    });
  });

  it("setZoom: 허용 범위를 벗어나면 clamp한다", async () => {
    await setZoom(100);
    expect(useAppStore.getState().zoomScale).toBe(16.0);

    await setZoom(-1);
    expect(useAppStore.getState().zoomScale).toBe(0.25);
  });

  it("zoomIn/zoomOut: 현재 배율 기준으로 비율(25%)만큼 곱/나눗셈으로 조정한다", async () => {
    await zoomIn();
    expect(useAppStore.getState().zoomScale).toBe(1.25);

    await zoomOut();
    expect(useAppStore.getState().zoomScale).toBe(1.0);
  });

  it("zoomIn: 로그 스케일이라 배율이 높을수록 한 단계의 절대 증가폭도 커진다", async () => {
    useAppStore.setState({ zoomScale: 4.0 });
    await zoomIn();
    expect(useAppStore.getState().zoomScale).toBe(5.0);
  });

  it("문서가 없어도 zoomScale 자체는 갱신된다(재렌더만 생략)", async () => {
    useAppStore.setState({ document: null });
    await setZoom(2.0);

    expect(useAppStore.getState().zoomScale).toBe(2.0);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("fetchRenderedPage (PDF-05: 연속 스크롤의 개별 페이지 렌더)", () => {
  it("성공 시 결과를 반환하고 store는 건드리지 않는다", async () => {
    invokeMock.mockResolvedValue(SAMPLE_RENDER);

    const result = await fetchRenderedPage("/a/b.pdf", 3, 1.0);

    expect(result).toEqual(SAMPLE_RENDER);
    expect(useAppStore.getState().renderedPage).toBeNull();
  });

  it("실패 시 null을 반환하고 §7.1 상태바 메시지를 표출한다", async () => {
    invokeMock.mockRejectedValue({
      code: "PDF_LOAD_FAILED",
      message: "PDF 파일이 오류로 인해 열리지 않습니다.",
    });

    const result = await fetchRenderedPage("/a/b.pdf", 3, 1.0);

    expect(result).toBeNull();
    expect(useAppStore.getState().statusMessage).toBe("PDF 파일이 오류로 인해 열리지 않습니다.");
  });

  it("같은 (path, pageIndex, scale)를 다시 요청하면 캐시로 응답하고 invoke를 다시 부르지 않는다(성능)", async () => {
    invokeMock.mockResolvedValue(SAMPLE_RENDER);

    const first = await fetchRenderedPage("/a/b.pdf", 3, 1.0);
    expect(invokeMock).toHaveBeenCalledTimes(1);

    const second = await fetchRenderedPage("/a/b.pdf", 3, 1.0);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("scale이 다르면 캐시를 재사용하지 않는다", async () => {
    invokeMock.mockResolvedValue(SAMPLE_RENDER);

    await fetchRenderedPage("/a/b.pdf", 3, 1.0);
    await fetchRenderedPage("/a/b.pdf", 3, 2.0);

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});

describe("goToPage in scroll 모드 (PDF-05)", () => {
  it("연속 스크롤 모드에서는 재렌더 대신 등록된 scrollToPage로 이동한다", async () => {
    const scrollToPage = vi.fn();
    registerScrollToPage(scrollToPage);
    useAppStore.setState({ document: SAMPLE_DOC, currentPageIndex: 0, viewMode: "scroll" });

    await goToPage(2);

    expect(scrollToPage).toHaveBeenCalledWith(2);
    expect(useAppStore.getState().currentPageIndex).toBe(2);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("scrollToPage가 등록되지 않았으면 재렌더로 폴백한다", async () => {
    useAppStore.setState({ document: SAMPLE_DOC, currentPageIndex: 0, viewMode: "scroll" });
    invokeMock.mockResolvedValue(SAMPLE_RENDER);

    await goToPage(2);

    expect(invokeMock).toHaveBeenCalledWith("render_page", {
      path: SAMPLE_DOC.path,
      pageIndex: 2,
      scale: 1.0,
    });
  });
});
