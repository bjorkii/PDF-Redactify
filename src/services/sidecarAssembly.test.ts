import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";
import { assembleSidecarDocument } from "./sidecarAssembly";

const SAMPLE_DOC = {
  path: "/a/b.pdf",
  filename: "b.pdf",
  pageCount: 2,
  pageDimensions: [
    { pageNumber: 0, pageWidth: 200, pageHeight: 300, textLayerStatus: "HasText" as const },
    { pageNumber: 1, pageWidth: 200, pageHeight: 300, textLayerStatus: "NoText" as const },
  ],
  textFingerprint: "sha256:aaa",
};

beforeEach(() => {
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
});

describe("assembleSidecarDocument (STATE-03)", () => {
  it("문서가 없으면 null", () => {
    expect(assembleSidecarDocument()).toBeNull();
  });

  it("현재 store 상태로부터 전체 sidecar JSON을 구성한다", () => {
    useAppStore.setState({
      document: SAMPLE_DOC,
      sidecarCreatedAt: "2026-01-01T00:00:00.000Z",
      currentPageIndex: 1,
      zoomScale: 1.5,
    });

    const result = assembleSidecarDocument();

    expect(result).not.toBeNull();
    expect(result!.schema_version).toBe(2);
    expect(result!.source.path).toBe("/a/b.pdf");
    expect(result!.source.page_count).toBe(2);
    expect(result!.source.text_fingerprint).toBe("sha256:aaa");
    expect(result!.source.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(result!.view_state.current_page).toBe(1);
    expect(result!.view_state.zoom).toBe(1.5);
    expect(result!.page_dimensions).toEqual([
      { page_number: 0, page_width: 200, page_height: 300, unit: "pt", text_layer_status: "HasText" },
      { page_number: 1, page_width: 200, page_height: 300, unit: "pt", text_layer_status: "NoText" },
    ]);
    expect(result!.review_items).toEqual([]);
    expect(result!.history).toEqual({ cursor: 0, entries: [] });
    expect(result!.exclusion_zones).toEqual([]);
  });

  it("DET-07: exclusionZones를 sidecar 스키마(page_index/margins)로 매핑한다", () => {
    useAppStore.setState({
      document: SAMPLE_DOC,
      exclusionZones: [{ pageIndex: 1, margins: { top: 0.1, bottom: 0, left: 0, right: 0 } }],
    });

    const result = assembleSidecarDocument();

    expect(result!.exclusion_zones).toEqual([
      { page_index: 1, margins: { top: 0.1, bottom: 0, left: 0, right: 0 } },
    ]);
  });

  it("sidecarCreatedAt이 없으면(최초 저장) 지금 시각을 created_at으로 쓴다", () => {
    useAppStore.setState({ document: SAMPLE_DOC, sidecarCreatedAt: null });

    const result = assembleSidecarDocument();

    expect(result!.source.created_at).toBe(result!.source.updated_at);
  });
});
