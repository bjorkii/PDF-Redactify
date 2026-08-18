import { describe, expect, it, beforeEach } from "vitest";
import { clearRenderCache, getCachedRenderedPage, setCachedRenderedPage } from "./renderCache";
import type { RenderedPage } from "../store/appStore";

function makePage(overrides: Partial<RenderedPage> = {}): RenderedPage {
  return {
    pageIndex: 0,
    width: 100,
    height: 150,
    pageWidthPt: 200,
    pageHeightPt: 300,
    pngBase64: "iVBORw0KGgo=",
    ...overrides,
  };
}

beforeEach(() => {
  clearRenderCache();
});

describe("renderCache", () => {
  it("없는 항목은 undefined를 반환한다", () => {
    expect(getCachedRenderedPage("/a.pdf", 0, 1.0)).toBeUndefined();
  });

  it("저장한 항목을 같은 (path, pageIndex, scale)로 그대로 돌려준다", () => {
    const page = makePage();
    setCachedRenderedPage("/a.pdf", 0, 1.0, page);
    expect(getCachedRenderedPage("/a.pdf", 0, 1.0)).toBe(page);
  });

  it("path·pageIndex·scale 중 하나라도 다르면 별개 항목이다", () => {
    const page = makePage();
    setCachedRenderedPage("/a.pdf", 0, 1.0, page);

    expect(getCachedRenderedPage("/b.pdf", 0, 1.0)).toBeUndefined();
    expect(getCachedRenderedPage("/a.pdf", 1, 1.0)).toBeUndefined();
    expect(getCachedRenderedPage("/a.pdf", 0, 2.0)).toBeUndefined();
  });

  it("최대 개수를 넘으면 가장 오래전에 쓰인 항목부터 지운다(LRU)", () => {
    for (let i = 0; i < 41; i++) {
      setCachedRenderedPage("/a.pdf", i, 1.0, makePage({ pageIndex: i }));
    }

    expect(getCachedRenderedPage("/a.pdf", 0, 1.0)).toBeUndefined();
    expect(getCachedRenderedPage("/a.pdf", 40, 1.0)).toBeDefined();
  });

  it("다시 저장하면(재사용) 삭제 순번에서 가장 뒤로 밀린다", () => {
    for (let i = 0; i < 40; i++) {
      setCachedRenderedPage("/a.pdf", i, 1.0, makePage({ pageIndex: i }));
    }
    // 0번을 다시 사용 — 가장 최근 사용으로 취급되어야 한다.
    setCachedRenderedPage("/a.pdf", 0, 1.0, makePage({ pageIndex: 0 }));
    // 41번째 항목을 추가하면, 재사용 안 한 1번이 먼저 밀려나야 한다.
    setCachedRenderedPage("/a.pdf", 40, 1.0, makePage({ pageIndex: 40 }));

    expect(getCachedRenderedPage("/a.pdf", 0, 1.0)).toBeDefined();
    expect(getCachedRenderedPage("/a.pdf", 1, 1.0)).toBeUndefined();
  });

  it("clearRenderCache로 전부 비운다", () => {
    setCachedRenderedPage("/a.pdf", 0, 1.0, makePage());
    clearRenderCache();
    expect(getCachedRenderedPage("/a.pdf", 0, 1.0)).toBeUndefined();
  });
});
