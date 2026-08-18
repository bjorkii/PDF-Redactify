import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";

const listenMock = vi.fn();
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// 모킹 후 임포트해야 vi.mock이 적용된 모듈을 사용한다.
const { PROGRESS_EVENT, subscribeOperationProgress, cancelOperation } = await import("./progressBus");

beforeEach(() => {
  listenMock.mockReset();
  invokeMock.mockReset();
  useAppStore.setState({ operationProgress: null });
});

describe("subscribeOperationProgress", () => {
  it("active 이벤트는 store 진행률에 반영하고, active=false는 바를 숨긴다(null)", async () => {
    let handler: ((event: { payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();
    listenMock.mockImplementation((eventName: string, h: typeof handler) => {
      expect(eventName).toBe(PROGRESS_EVENT);
      handler = h;
      return Promise.resolve(unlisten);
    });

    const returned = await subscribeOperationProgress();
    expect(handler).toBeDefined();

    handler!({ payload: { kind: "save", processed: 3, total: 10, active: true } });
    expect(useAppStore.getState().operationProgress).toEqual({ kind: "save", processed: 3, total: 10 });

    handler!({ payload: { kind: "save", processed: 0, total: 0, active: false } });
    expect(useAppStore.getState().operationProgress).toBeNull();

    expect(returned).toBe(unlisten);
  });
});

describe("cancelOperation", () => {
  it("cancel_operation 커맨드를 호출한다", async () => {
    invokeMock.mockResolvedValue(undefined);
    await cancelOperation();
    expect(invokeMock).toHaveBeenCalledWith("cancel_operation");
  });
});
