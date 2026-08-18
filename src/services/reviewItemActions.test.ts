import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";
import {
  createManualReviewItem,
  addReviewItemAtDefaultPosition,
  deleteSelectedReviewItem,
  selectAdjacentReviewItem,
  selectAllReviewItemsInList,
  selectAllReviewItemsOnPage,
} from "./reviewItemActions";
import type { ReviewItem } from "../types/generated/ReviewItem";

const SAMPLE_DOC = {
  path: "/a/b.pdf",
  filename: "b.pdf",
  pageCount: 4,
  pageDimensions: [],
  textFingerprint: "sha256:test",
};

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  useAppStore.setState({
    document: null,
    currentPageIndex: 0,
    reviewItems: [],
    history: { cursor: 0, entries: [] },
    selectedItemId: null,
    selectedItemIds: new Set(),
    selectionAnchorId: null,
    pendingEditItemId: null,
  });
});

describe("createManualReviewItem (EDIT-01/03)", () => {
  it("항목을 store에 추가하고 선택 + 편집 대기 상태로 만든다", () => {
    createManualReviewItem(2, { x: 0.1, y: 0.2, width: 0.3, height: 0.05 });

    const state = useAppStore.getState();
    expect(state.reviewItems).toHaveLength(1);
    expect(state.reviewItems[0].page).toBe(2);
    expect(state.reviewItems[0].origin).toBe("manual");
    expect(state.selectedItemId).toBe(state.reviewItems[0].id);
    expect(state.pendingEditItemId).toBe(state.reviewItems[0].id);
    expect(state.history.entries).toHaveLength(1);
    expect(state.history.entries[0].action).toBe("add");
  });

  it("완전포함되는 자동검출 항목을 흡수 삭제하고 상태바 안내를 띄운다", () => {
    // 큰 사용자 영역 안에 detected 항목이 완전히 들어오는 경우.
    const inside = makeItem({
      id: "d-inside",
      origin: "detected",
      page: 0,
      bbox: { x: 0.2, y: 0.2, width: 0.05, height: 0.02 },
    });
    // 영역 밖으로 삐져나온 detected 항목(보존돼야 함).
    const partial = makeItem({
      id: "d-partial",
      origin: "detected",
      page: 0,
      bbox: { x: 0.45, y: 0.2, width: 0.2, height: 0.02 },
    });
    // 사용자 요청: 완전포함되는 **사용자 추가(manual)** 항목도 함께 흡수 삭제.
    const insideManual = makeItem({
      id: "m-inside",
      origin: "manual",
      page: 0,
      bbox: { x: 0.25, y: 0.25, width: 0.05, height: 0.02 },
    });
    // 같은 위치지만 다른 페이지(영향 없음).
    const otherPage = makeItem({ id: "d-other", origin: "detected", page: 1, bbox: { x: 0.2, y: 0.2, width: 0.05, height: 0.02 } });
    useAppStore.setState({ reviewItems: [inside, insideManual, partial, otherPage], statusMessage: "" });

    createManualReviewItem(0, { x: 0.1, y: 0.1, width: 0.4, height: 0.4 });

    const state = useAppStore.getState();
    const ids = state.reviewItems.map((i) => i.id);
    expect(ids).not.toContain("d-inside"); // 완전포함 자동검출 → 흡수 삭제
    expect(ids).not.toContain("m-inside"); // 완전포함 사용자 추가 → 흡수 삭제
    expect(ids).toContain("d-partial"); // 삐져나옴 → 보존
    expect(ids).toContain("d-other"); // 다른 페이지 → 보존
    expect(state.statusMessage).toBe("새 영역에 완전히 포함된 기존 블랙마킹은 이 영역으로 대체됩니다.");
  });

  it("흡수 삭제는 add와 한 group이라 undo 한 번에 자동검출이 복원된다", () => {
    const inside = makeItem({ id: "d-inside", origin: "detected", page: 0, bbox: { x: 0.2, y: 0.2, width: 0.05, height: 0.02 } });
    useAppStore.setState({ reviewItems: [inside] });

    createManualReviewItem(0, { x: 0.1, y: 0.1, width: 0.4, height: 0.4 });
    expect(useAppStore.getState().reviewItems.map((i) => i.id)).not.toContain("d-inside");

    useAppStore.getState().undo();
    const after = useAppStore.getState().reviewItems.map((i) => i.id);
    expect(after).toContain("d-inside"); // 자동검출 복원
    expect(after.some((id) => id.startsWith("m-"))).toBe(false); // 사용자 추가도 취소
  });
});

describe("addReviewItemAtDefaultPosition (EDIT-03, §7.1)", () => {
  it("문서가 없으면 아무 것도 하지 않는다", () => {
    addReviewItemAtDefaultPosition();
    expect(useAppStore.getState().reviewItems).toEqual([]);
  });

  it("현재 페이지에 기본 위치로 항목을 추가한다", () => {
    useAppStore.setState({ document: SAMPLE_DOC, currentPageIndex: 3 });

    addReviewItemAtDefaultPosition();

    const items = useAppStore.getState().reviewItems;
    expect(items).toHaveLength(1);
    expect(items[0].page).toBe(3);
    expect(items[0].category).toBe("Custom");
  });
});

describe("deleteSelectedReviewItem (EDIT-03, §7.1)", () => {
  it("선택된 항목이 없으면 아무 것도 하지 않는다", () => {
    useAppStore.setState({ reviewItems: [makeItem()] });
    deleteSelectedReviewItem();
    expect(useAppStore.getState().reviewItems).toHaveLength(1);
  });

  it("선택된 항목을 지우고 선택을 해제한다(undo 가능)", () => {
    const item = makeItem({ id: "r-0" });
    useAppStore.setState({ reviewItems: [item], selectedItemId: "r-0" });

    deleteSelectedReviewItem();

    const state = useAppStore.getState();
    expect(state.reviewItems).toEqual([]);
    expect(state.selectedItemId).toBeNull();
    expect(state.history.entries[0]).toMatchObject({ action: "delete", item_id: "r-0" });

    state.undo();
    expect(useAppStore.getState().reviewItems).toEqual([item]);
  });
});

describe("selectAdjacentReviewItem (LIST-06/KEY-01, §8.1/§8.3 ↑/↓)", () => {
  it("목록이 비어 있으면 아무 것도 하지 않는다", () => {
    expect(selectAdjacentReviewItem(1)).toBeNull();
    expect(useAppStore.getState().selectedItemId).toBeNull();
  });

  it("선택된 항목이 없으면 위치순 정렬 기준 첫 항목을 선택한다", () => {
    const a = makeItem({ id: "r-0", page: 0 });
    const b = makeItem({ id: "r-1", page: 1 });
    // store 배열 순서가 위치순과 반대여도 정렬 기준으로 골라야 한다.
    useAppStore.setState({ reviewItems: [b, a], selectedItemId: null });

    const next = selectAdjacentReviewItem(1);

    expect(next?.id).toBe("r-0");
    expect(useAppStore.getState().selectedItemId).toBe("r-0");
  });

  it("다음/이전 방향으로 선택을 옮긴다", () => {
    const a = makeItem({ id: "r-0", page: 0 });
    const b = makeItem({ id: "r-1", page: 1 });
    useAppStore.setState({ reviewItems: [a, b], selectedItemId: "r-0" });

    expect(selectAdjacentReviewItem(1)?.id).toBe("r-1");
    expect(useAppStore.getState().selectedItemId).toBe("r-1");

    expect(selectAdjacentReviewItem(-1)?.id).toBe("r-0");
    expect(useAppStore.getState().selectedItemId).toBe("r-0");
  });

  it("커서 이동 시 Space로 마킹해 둔 다중선택 집합은 보존한다(사용자 요청)", () => {
    const a = makeItem({ id: "r-0", page: 0 });
    const b = makeItem({ id: "r-1", page: 1 });
    const c = makeItem({ id: "r-2", page: 2 });
    useAppStore.setState({
      reviewItems: [a, b, c],
      selectedItemId: "r-0",
      selectedItemIds: new Set(["r-0", "r-2"]), // 마킹된 집합
    });

    selectAdjacentReviewItem(1);

    const state = useAppStore.getState();
    expect(state.selectedItemId).toBe("r-1"); // 커서만 이동
    expect(state.selectedItemIds).toEqual(new Set(["r-0", "r-2"])); // 마크 보존
  });
});

describe("selectAllReviewItemsInList / selectAllReviewItemsOnPage (EDIT-13 전체선택)", () => {
  const items = [
    makeItem({ id: "r-0", page: 0, category: "RRN", bbox: { x: 0, y: 0.1, width: 0.1, height: 0.02 } }),
    makeItem({ id: "r-1", page: 0, category: "PhoneNumber", bbox: { x: 0, y: 0.2, width: 0.1, height: 0.02 } }),
    makeItem({ id: "r-2", page: 1, category: "RRN", bbox: { x: 0, y: 0.3, width: 0.1, height: 0.02 } }),
  ];

  beforeEach(() => {
    useAppStore.setState({
      reviewItems: items,
      selectedItemId: null,
      selectedItemIds: new Set(),
      selectionAnchorId: null,
      reviewListFilter: { categories: null, pages: null },
      sort: { column: "position", direction: "asc" },
      statusMessage: "",
    });
  });

  it("목록 전체선택: 문서의 모든(필터로 보이는) 항목을 선택하고 상태바 안내를 띄운다", () => {
    selectAllReviewItemsInList();
    const state = useAppStore.getState();
    expect(state.selectedItemIds).toEqual(new Set(["r-0", "r-1", "r-2"]));
    expect(state.selectedItemId).not.toBeNull();
    expect(state.statusMessage).toBe("이 문서 전체의 대상 정보가 모두 선택됐습니다.");
  });

  it("목록 전체선택: 구분 필터로 숨겨진 항목은 제외한다", () => {
    useAppStore.setState({ reviewListFilter: { categories: ["RRN"], pages: null } });
    selectAllReviewItemsInList();
    expect(useAppStore.getState().selectedItemIds).toEqual(new Set(["r-0", "r-2"]));
  });

  it("페이지 전체선택: 해당 페이지의 항목만 선택하고 상태바 안내를 띄운다", () => {
    selectAllReviewItemsOnPage(0);
    expect(useAppStore.getState().selectedItemIds).toEqual(new Set(["r-0", "r-1"]));
    expect(useAppStore.getState().statusMessage).toBe("이 쪽의 대상 정보가 모두 선택됐습니다.");
  });

  it("페이지 전체선택: 구분 필터를 반영한다(뷰어 표시와 일치)", () => {
    useAppStore.setState({ reviewListFilter: { categories: ["RRN"], pages: null } });
    selectAllReviewItemsOnPage(0);
    expect(useAppStore.getState().selectedItemIds).toEqual(new Set(["r-0"]));
  });

  it("페이지 전체선택: 항목이 없는 페이지는 선택을 바꾸지 않는다", () => {
    useAppStore.setState({ selectedItemId: "r-0", selectedItemIds: new Set(["r-0"]) });
    selectAllReviewItemsOnPage(3);
    expect(useAppStore.getState().selectedItemIds).toEqual(new Set(["r-0"]));
  });
});
