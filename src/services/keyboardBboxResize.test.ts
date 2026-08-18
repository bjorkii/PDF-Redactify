import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";
import {
  applyKeyboardResize,
  noteResizeModifierDown,
  heldResizeEdges,
  clearHeldResizeEdges,
  ARROW_RESIZE_STEP,
} from "./keyboardBboxResize";
import type { ReviewItem } from "../types/generated/ReviewItem";

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "r-0",
    origin: "manual",
    page: 0,
    bbox: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 },
    original_bbox: null,
    category: "Custom",
    content: "x",
    pattern_type: null,
    confidence: 1,
    validation: "ChecksumNotApplicable",
    modified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  clearHeldResizeEdges();
  useAppStore.setState({
    document: null,
    reviewItems: [],
    exclusionZones: [],
    history: { cursor: 0, entries: [] },
    selectedItemId: null,
    selectedItemIds: new Set(),
    selectionAnchorId: null,
    positionUncertainItemIds: new Set(),
  });
});

describe("noteResizeModifierDown / heldResizeEdges", () => {
  it("a/f/s/d를 변으로 매핑해 홀드하고 그 외 키는 무시한다", () => {
    expect(noteResizeModifierDown({ key: "a" })).toBe(true);
    expect(noteResizeModifierDown({ key: "d" })).toBe(true);
    expect(noteResizeModifierDown({ key: "k" })).toBe(false);
    expect(new Set(heldResizeEdges())).toEqual(new Set(["left", "bottom"]));
  });

  it("한글 입력 상태(event.key='ㅁ')여도 물리 키(code='KeyA')로 왼변에 매핑한다", () => {
    expect(noteResizeModifierDown({ key: "ㅁ", code: "KeyA" })).toBe(true);
    expect(heldResizeEdges()).toEqual(["left"]);
  });
});

describe("applyKeyboardResize (B-6 단일)", () => {
  it("a(왼변) 홀드 + →면 왼변을 오른쪽으로 밀어 축소하고 modified/original_bbox를 남긴다", () => {
    useAppStore.setState({ reviewItems: [makeItem()], selectedItemId: "r-0" });
    noteResizeModifierDown({ key: "a" });

    expect(applyKeyboardResize("ArrowRight")).toBe(true);

    const item = useAppStore.getState().reviewItems[0];
    expect(item.bbox.x).toBeCloseTo(0.3 + ARROW_RESIZE_STEP);
    expect(item.bbox.width).toBeCloseTo(0.2 - ARROW_RESIZE_STEP);
    expect(item.modified).toBe(true);
    expect(item.original_bbox).toEqual({ x: 0.3, y: 0.3, width: 0.2, height: 0.2 });
  });

  it("각 수식어는 좌우·상하 화살표를 모두 받는다 — a(왼변)+↑ = a+← (extend left)", () => {
    useAppStore.setState({ reviewItems: [makeItem()], selectedItemId: "r-0" });
    noteResizeModifierDown({ key: "a" });
    // ↑도 ←와 같은 부호(−) → 왼변을 왼쪽으로 밀어 x 감소·width 증가.
    expect(applyKeyboardResize("ArrowUp")).toBe(true);
    const item = useAppStore.getState().reviewItems[0];
    expect(item.bbox.x).toBeCloseTo(0.3 - ARROW_RESIZE_STEP);
    expect(item.bbox.width).toBeCloseTo(0.2 + ARROW_RESIZE_STEP);
  });

  it("선택이 없으면 아무 것도 하지 않는다", () => {
    useAppStore.setState({ reviewItems: [makeItem()], selectedItemId: null });
    noteResizeModifierDown({ key: "a" });
    expect(applyKeyboardResize("ArrowRight")).toBe(false);
  });
});

describe("applyKeyboardResize (B-7 다중 group undo)", () => {
  it("다중 선택은 같은 group_id로 묶여 한 번의 undo로 함께 복원된다", () => {
    const a = makeItem({ id: "r-0" });
    const b = makeItem({ id: "r-1", bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } });
    useAppStore.setState({
      reviewItems: [a, b],
      selectedItemId: "r-0",
      selectedItemIds: new Set(["r-0", "r-1"]),
    });
    noteResizeModifierDown({ key: "f" }); // 오른변

    expect(applyKeyboardResize("ArrowRight")).toBe(true);
    const widened = useAppStore.getState().reviewItems.map((i) => i.bbox.width);
    expect(widened[0]).toBeCloseTo(0.2 + ARROW_RESIZE_STEP);
    expect(widened[1]).toBeCloseTo(0.2 + ARROW_RESIZE_STEP);

    // group_id로 묶였으므로 undo 한 번에 둘 다 원복.
    useAppStore.getState().undo();
    const restored = useAppStore.getState().reviewItems.map((i) => i.bbox.width);
    expect(restored[0]).toBeCloseTo(0.2);
    expect(restored[1]).toBeCloseTo(0.2);
  });
});
