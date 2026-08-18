import { describe, expect, it, beforeEach, vi } from "vitest";
import { useAppStore } from "../store/appStore";
import { handleViewerNavigationKeyDown } from "./viewerNavigation";
import type { ReviewItem } from "../types/generated/ReviewItem";

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

/** 핸들러가 쓰는 필드만 채운 가짜 키 이벤트. */
function keyEvent(key: string, mods: Partial<Record<"shiftKey" | "metaKey" | "ctrlKey" | "altKey", boolean>> = {}) {
  return {
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent<HTMLElement>;
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

// B-5(EDIT-16): 뷰포트 z/x = 이전/다음 bbox 선택(단일 선택일 때만).
describe("handleViewerNavigationKeyDown z/x (B-5)", () => {
  it("단일 선택 상태에서 x=다음, z=이전 항목으로 이동한다", () => {
    const a = makeItem({ id: "r-0", page: 0 });
    const b = makeItem({ id: "r-1", page: 1 });
    useAppStore.setState({ reviewItems: [a, b], selectedItemId: "r-0" });

    const ex = keyEvent("x");
    handleViewerNavigationKeyDown(ex);
    expect(ex.preventDefault).toHaveBeenCalled();
    expect(useAppStore.getState().selectedItemId).toBe("r-1");

    handleViewerNavigationKeyDown(keyEvent("z"));
    expect(useAppStore.getState().selectedItemId).toBe("r-0");
  });

  it("선택이 없으면 아무 것도 하지 않는다", () => {
    useAppStore.setState({ reviewItems: [makeItem()], selectedItemId: null });
    const ev = keyEvent("x");
    handleViewerNavigationKeyDown(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedItemId).toBeNull();
  });

  it("다중 선택(2개 이상 마크) 중에는 z/x를 무시한다", () => {
    const a = makeItem({ id: "r-0", page: 0 });
    const b = makeItem({ id: "r-1", page: 1 });
    useAppStore.setState({
      reviewItems: [a, b],
      selectedItemId: "r-0",
      selectedItemIds: new Set(["r-0", "r-1"]),
    });
    const ev = keyEvent("x");
    handleViewerNavigationKeyDown(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedItemId).toBe("r-0"); // 이동 안 함
  });

  it("cmd/ctrl 수식어가 붙으면(z=undo 등) 가로채지 않는다", () => {
    useAppStore.setState({ reviewItems: [makeItem()], selectedItemId: "r-0" });
    const ev = keyEvent("z", { metaKey: true });
    handleViewerNavigationKeyDown(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
});
