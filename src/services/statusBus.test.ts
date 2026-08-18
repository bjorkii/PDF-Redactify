import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";

const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

// 모킹 후 임포트해야 vi.mock이 적용된 모듈을 사용한다.
const { STATUS_EVENT, publishStatus, subscribeBackendStatus } = await import("./statusBus");

beforeEach(() => {
  listenMock.mockReset();
  useAppStore.setState({ statusMessage: "" });
});

describe("publishStatus", () => {
  it("상태바 store에 메시지를 즉시 반영한다", () => {
    publishStatus("블랙마킹이 적용 완료됐습니다.");
    expect(useAppStore.getState().statusMessage).toBe("블랙마킹이 적용 완료됐습니다.");
  });
});

describe("subscribeBackendStatus", () => {
  it("STATUS_EVENT를 구독하고, Rust에서 emit된 임의 이벤트를 store에 반영한다", async () => {
    let capturedHandler: ((event: { payload: { message: string } }) => void) | undefined;
    const unlisten = vi.fn();
    listenMock.mockImplementation((eventName: string, handler: typeof capturedHandler) => {
      expect(eventName).toBe(STATUS_EVENT);
      capturedHandler = handler;
      return Promise.resolve(unlisten);
    });

    const returnedUnlisten = await subscribeBackendStatus();
    expect(capturedHandler).toBeDefined();

    capturedHandler!({ payload: { message: "민감정보를 검출하는 중입니다… (42%)" } });
    expect(useAppStore.getState().statusMessage).toBe("민감정보를 검출하는 중입니다… (42%)");

    expect(returnedUnlisten).toBe(unlisten);
  });
});
