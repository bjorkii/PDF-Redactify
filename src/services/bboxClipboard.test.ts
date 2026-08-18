// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";
import {
  copySelectedBBoxes,
  pasteBBoxes,
  hasClipboardBBoxes,
  resetBboxClipboard,
} from "./bboxClipboard";
import type { ReviewItem } from "../types/generated/ReviewItem";

const DOC = {
  path: "/a/b.pdf",
  filename: "b.pdf",
  pageCount: 4,
  pageDimensions: [
    { pageNumber: 1, pageWidth: 612, pageHeight: 792, textLayerStatus: "HasText" as const },
  ],
  textFingerprint: "sha256:test",
};

const RENDERED = {
  pageIndex: 2,
  width: 800,
  height: 1000,
  pageWidthPt: 612,
  pageHeightPt: 792,
  pngBase64: "",
};

function item(id: string, overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id,
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
    ...overrides,
  };
}

beforeEach(() => {
  resetBboxClipboard();
  useAppStore.setState({
    document: DOC,
    viewMode: "paginated",
    renderedPage: RENDERED,
    reviewItems: [],
    selectedItemId: null,
    selectedItemIds: new Set(),
    selectionAnchorId: null,
    history: { cursor: 0, entries: [] },
  });
});

describe("copySelectedBBoxes (EDIT-12)", () => {
  it("선택이 없으면 false", () => {
    expect(copySelectedBBoxes()).toBe(false);
    expect(hasClipboardBBoxes()).toBe(false);
  });

  it("선택된 항목의 bbox·구분·내용을 클립보드에 담고 true", () => {
    useAppStore.setState({
      reviewItems: [item("r-0")],
      selectedItemId: "r-0",
      selectedItemIds: new Set(["r-0"]),
    });
    expect(copySelectedBBoxes()).toBe(true);
    expect(hasClipboardBBoxes()).toBe(true);
  });
});

describe("pasteBBoxes (EDIT-12)", () => {
  it("클립보드가 비면 false", () => {
    expect(pasteBBoxes()).toBe(false);
  });

  it("복사한 항목을 현재 페이지에 '내용 없는' manual 항목으로 붙이고 새로 선택한다", () => {
    useAppStore.setState({
      reviewItems: [
        item("r-0", { content: "비밀", category: "RRN", bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.05 } }),
      ],
      selectedItemId: "r-0",
      selectedItemIds: new Set(["r-0"]),
    });
    copySelectedBBoxes();

    expect(pasteBBoxes()).toBe(true);

    const state = useAppStore.getState();
    expect(state.reviewItems).toHaveLength(2);
    const pasted = state.reviewItems.find((i) => i.id !== "r-0")!;
    expect(pasted.origin).toBe("manual");
    expect(pasted.page).toBe(RENDERED.pageIndex);
    // 사이즈(크기)만 유지되고 내용/구분은 복사되지 않는다.
    expect(pasted.bbox.width).toBe(0.2);
    expect(pasted.bbox.height).toBe(0.05);
    expect(pasted.content).toBe("");
    expect(pasted.category).toBe("Custom");
    // 붙여넣은 항목이 새로 선택됨
    expect(state.selectedItemId).toBe(pasted.id);
    expect(state.selectedItemIds.has(pasted.id)).toBe(true);
  });

  it("연속 스크롤 모드에서도 현재 페이지에 붙인다(마우스가 페이지 밖이면 폴백)", () => {
    useAppStore.setState({
      reviewItems: [item("r-0")],
      selectedItemId: "r-0",
      selectedItemIds: new Set(["r-0"]),
      viewMode: "scroll",
      currentPageIndex: 1,
    });
    copySelectedBBoxes();
    expect(pasteBBoxes()).toBe(true);
    const state = useAppStore.getState();
    expect(state.reviewItems).toHaveLength(2);
    const pasted = state.reviewItems.find((i) => i.id !== "r-0")!;
    expect(pasted.origin).toBe("manual");
    expect(pasted.page).toBe(1); // 폴백: currentPageIndex
  });

  it("문서가 없으면 false", () => {
    useAppStore.setState({
      reviewItems: [item("r-0")],
      selectedItemId: "r-0",
      selectedItemIds: new Set(["r-0"]),
    });
    copySelectedBBoxes();
    useAppStore.setState({ document: null });
    expect(pasteBBoxes()).toBe(false);
  });

  it("여러 건을 복사하면 하나의 그룹으로 붙어 undo 한 번에 전부 사라진다", () => {
    useAppStore.setState({
      reviewItems: [
        item("r-0", { bbox: { x: 0.1, y: 0.1, width: 0.1, height: 0.05 } }),
        item("r-1", { bbox: { x: 0.3, y: 0.3, width: 0.1, height: 0.05 } }),
      ],
      selectedItemId: "r-0",
      selectedItemIds: new Set(["r-0", "r-1"]),
    });
    copySelectedBBoxes();
    pasteBBoxes();

    expect(useAppStore.getState().reviewItems).toHaveLength(4);
    useAppStore.getState().undo();
    // 붙여넣은 2건이 한 번의 undo로 전부 복원 취소됨
    expect(useAppStore.getState().reviewItems).toHaveLength(2);
  });
});
