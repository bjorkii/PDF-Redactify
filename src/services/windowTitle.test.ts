import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAppStore } from "../store/appStore";

const getVersionMock = vi.fn();
const setTitleMock = vi.fn();
const getCurrentWindowMock = vi.fn(() => ({ setTitle: setTitleMock }));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: (...args: unknown[]) => getVersionMock(...args),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => getCurrentWindowMock(),
}));

const { buildWindowTitle, startWindowTitleSync } = await import("./windowTitle");

const DOC_B = {
  path: "/a/b.pdf",
  filename: "b.pdf",
  pageCount: 1,
  pageDimensions: [],
  textFingerprint: "sha256:b",
};

const DOC_C = {
  path: "/a/c.pdf",
  filename: "c.pdf",
  pageCount: 1,
  pageDimensions: [],
  textFingerprint: "sha256:c",
};

beforeEach(() => {
  getVersionMock.mockReset().mockResolvedValue("0.1.0");
  setTitleMock.mockReset();
  useAppStore.setState({ document: null });
});

describe("buildWindowTitle (UI-01, §7.1)", () => {
  it("문서가 없으면 앱 이름과 버전만 표시한다", () => {
    expect(buildWindowTitle("0.1.0", null)).toBe("PDF-Redactify v0.1.0");
  });

  it("문서가 있으면 파일명을 이어붙인다", () => {
    expect(buildWindowTitle("0.1.0", "테스트.pdf")).toBe("PDF-Redactify v0.1.0 - 테스트.pdf");
  });
});

describe("startWindowTitleSync (UI-01)", () => {
  it("시작 시 현재 상태 기준으로 제목을 한 번 설정한다", async () => {
    useAppStore.setState({ document: DOC_B });
    const stop = startWindowTitleSync();

    await vi.waitFor(() =>
      expect(setTitleMock).toHaveBeenCalledWith("PDF-Redactify v0.1.0 - b.pdf"),
    );
    stop();
  });

  it("문서가 바뀌면 제목을 다시 갱신한다", async () => {
    const stop = startWindowTitleSync();
    await vi.waitFor(() => expect(setTitleMock).toHaveBeenCalledWith("PDF-Redactify v0.1.0"));
    setTitleMock.mockClear();

    useAppStore.setState({ document: DOC_C });

    await vi.waitFor(() =>
      expect(setTitleMock).toHaveBeenCalledWith("PDF-Redactify v0.1.0 - c.pdf"),
    );
    stop();
  });

  it("문서를 닫으면 파일명 없는 제목으로 되돌린다", async () => {
    useAppStore.setState({ document: DOC_B });
    const stop = startWindowTitleSync();
    await vi.waitFor(() =>
      expect(setTitleMock).toHaveBeenCalledWith("PDF-Redactify v0.1.0 - b.pdf"),
    );
    setTitleMock.mockClear();

    useAppStore.setState({ document: null });

    await vi.waitFor(() => expect(setTitleMock).toHaveBeenCalledWith("PDF-Redactify v0.1.0"));
    stop();
  });
});
