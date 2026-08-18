import { describe, expect, it } from "vitest";
import { isSameSource } from "./sourceIdentity";
import type { PdfDocumentInfo } from "../store/appStore";
import type { SidecarDocument } from "../types/generated/SidecarDocument";

function makeDocument(overrides: Partial<PdfDocumentInfo> = {}): PdfDocumentInfo {
  return {
    path: "/a/b.pdf",
    filename: "b.pdf",
    pageCount: 2,
    pageDimensions: [
      { pageNumber: 0, pageWidth: 200, pageHeight: 300, textLayerStatus: "HasText" },
      { pageNumber: 1, pageWidth: 200, pageHeight: 300, textLayerStatus: "HasText" },
    ],
    textFingerprint: "sha256:aaa",
    ...overrides,
  };
}

function makeSidecar(overrides: Partial<SidecarDocument["source"]> = {}, pageDims?: SidecarDocument["page_dimensions"]): SidecarDocument {
  return {
    schema_version: 2,
    app: "PDF-Redactify",
    source: {
      filename: "b.pdf",
      path: "/a/b.pdf",
      page_count: 2,
      text_fingerprint: "sha256:aaa",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
    view_state: {
      current_page: 0,
      zoom: 1,
      selected_item_id: null,
      focus: "viewer",
      bookmark_sidebar: { visible: true, dock: "left" },
      redaction_sidebar: { visible: true, dock: "right", floating: false, rect: null },
      sort: { column: "position", direction: "asc" },
    },
    page_dimensions:
      pageDims ?? [
        { page_number: 0, page_width: 200, page_height: 300, unit: "pt", text_layer_status: "HasText" },
        { page_number: 1, page_width: 200, page_height: 300, unit: "pt", text_layer_status: "HasText" },
      ],
    review_items: [],
    history: { cursor: 0, entries: [] },
    exclusion_zones: [],
  };
}

describe("isSameSource (STATE-05, §4.4)", () => {
  it("page_count, page_dimensions, text_fingerprint가 모두 같으면 동일하다고 판정한다", () => {
    expect(isSameSource(makeDocument(), makeSidecar())).toBe(true);
  });

  it("page_count가 다르면 불일치", () => {
    expect(isSameSource(makeDocument({ pageCount: 3 }), makeSidecar())).toBe(false);
  });

  it("page_dimensions 항목 하나라도 다르면 불일치", () => {
    const mismatchedDims: SidecarDocument["page_dimensions"] = [
      { page_number: 0, page_width: 999, page_height: 300, unit: "pt", text_layer_status: "HasText" },
      { page_number: 1, page_width: 200, page_height: 300, unit: "pt", text_layer_status: "HasText" },
    ];
    expect(isSameSource(makeDocument(), makeSidecar({}, mismatchedDims))).toBe(false);
  });

  it("text_fingerprint만 달라도 불일치(주석 추가와 무관한 본문 변경 감지)", () => {
    expect(isSameSource(makeDocument(), makeSidecar({ text_fingerprint: "sha256:different" }))).toBe(
      false,
    );
  });

  it("filename/path가 달라도 나머지가 같으면 동일(§4.4: 경로는 판정에 미사용)", () => {
    expect(
      isSameSource(makeDocument(), makeSidecar({ filename: "other.pdf", path: "/z/other.pdf" })),
    ).toBe(true);
  });
});
