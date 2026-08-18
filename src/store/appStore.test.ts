import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "./appStore";

beforeEach(() => {
  useAppStore.setState({
    bookmarkSidebar: { visible: true, dock: "left", width: 240 },
    redactionSidebar: { visible: true, dock: "right", floating: false, rect: null, width: 240 },
    sameSideArrangement: "sideBySide",
    sameSideOrder: ["bookmark", "redaction"],
  });
});

describe("applyDockDrop (SIDE-02 edge / SIDE-03 동일 측 몰림)", () => {
  it("edge: 빈 측으로 단순 도킹만 바뀐다", () => {
    useAppStore.getState().applyDockDrop("redaction", { kind: "edge", dock: "left" });

    const state = useAppStore.getState();
    expect(state.redactionSidebar.dock).toBe("left");
    expect(state.sameSideArrangement).toBe("sideBySide"); // 변경 없음
  });

  it("overlay: 세로 분할로 전환되고 드래그한 쪽이 먼저(위) 온다", () => {
    // redaction을 bookmark가 있는 left로 겹쳐서 놓음
    useAppStore.getState().applyDockDrop("redaction", { kind: "overlay", dock: "left" });

    const state = useAppStore.getState();
    expect(state.redactionSidebar.dock).toBe("left");
    expect(state.sameSideArrangement).toBe("stacked");
    expect(state.sameSideOrder).toEqual(["redaction", "bookmark"]);
  });

  it("insertOuter: 가로 나란히, 드래그한 쪽이 바깥(창 가장자리 쪽)이 된다", () => {
    useAppStore.getState().applyDockDrop("redaction", { kind: "insertOuter", dock: "left" });

    const state = useAppStore.getState();
    expect(state.redactionSidebar.dock).toBe("left");
    expect(state.sameSideArrangement).toBe("sideBySide");
    expect(state.sameSideOrder).toEqual(["redaction", "bookmark"]);
  });

  it("insertInner: 가로 나란히, 드래그한 쪽이 안쪽(뷰어 쪽)이 된다", () => {
    useAppStore.getState().applyDockDrop("redaction", { kind: "insertInner", dock: "left" });

    const state = useAppStore.getState();
    expect(state.redactionSidebar.dock).toBe("left");
    expect(state.sameSideArrangement).toBe("sideBySide");
    expect(state.sameSideOrder).toEqual(["bookmark", "redaction"]);
  });
});

describe("toggleRedactionFloating / setRedactionFloatingRect (SIDE-04)", () => {
  it("플로팅 전환 시 rect가 없으면 기본값을 채운다", () => {
    useAppStore.getState().toggleRedactionFloating();

    const state = useAppStore.getState();
    expect(state.redactionSidebar.floating).toBe(true);
    expect(state.redactionSidebar.rect).not.toBeNull();
  });

  it("재도킹하면 floating이 꺼지고 rect가 null이 된다(§5.2 스키마와 일치)", () => {
    useAppStore.getState().toggleRedactionFloating();
    useAppStore.getState().toggleRedactionFloating();

    const state = useAppStore.getState();
    expect(state.redactionSidebar.floating).toBe(false);
    expect(state.redactionSidebar.rect).toBeNull();
  });

  it("플로팅 중 rect를 갱신하면(이동/리사이즈) 그대로 반영된다", () => {
    useAppStore.getState().toggleRedactionFloating();
    useAppStore.getState().setRedactionFloatingRect({ x: 10, y: 20, width: 300, height: 200 });

    expect(useAppStore.getState().redactionSidebar.rect).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
  });

  it("재도킹 후 다시 플로팅하면 기본 rect로 새로 시작한다(§5.2: 도킹 시 rect=null)", () => {
    useAppStore.getState().toggleRedactionFloating();
    useAppStore.getState().setRedactionFloatingRect({ x: 10, y: 20, width: 300, height: 200 });
    useAppStore.getState().toggleRedactionFloating(); // 재도킹 → rect: null
    useAppStore.getState().toggleRedactionFloating(); // 다시 플로팅 → 기본값

    expect(useAppStore.getState().redactionSidebar.rect).not.toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
  });
});
