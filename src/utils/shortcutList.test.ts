import { describe, expect, it } from "vitest";
import { buildShortcutSections, isKeySeparator } from "./shortcutList";
import { osKeySymbols } from "./platform";

describe("buildShortcutSections (KEY-01, §8 — shortcuts.md 기준)", () => {
  it("shortcuts.md의 5개 섹션 제목을 그대로 따른다", () => {
    const sections = buildShortcutSections(osKeySymbols("mac"));
    expect(sections.map((s) => s.title)).toEqual([
      "파일 / UI",
      "뷰어 > 보기·이동",
      "뷰어 > 블랙마킹 영역 수정",
      "블랙마킹 목록 사이드바",
      "북마크 사이드바",
    ]);
  });

  it("macOS는 ⌘/⌥/⇧/⌫ 기호로 표기한다", () => {
    const s = buildShortcutSections(osKeySymbols("mac"));
    const file = s.find((x) => x.title === "파일 / UI")!;
    expect(file.rows.find((r) => r.action === "PDF 파일 열기")?.keys).toBe("⌘ + O");
    expect(file.rows.find((r) => r.action.startsWith("북마크 사이드바 보기"))?.keys).toBe("⌥ + ⌘ + B");
    const list = s.find((x) => x.title === "블랙마킹 목록 사이드바")!;
    expect(list.rows.find((r) => r.action === "전체 삭제")?.keys).toBe("⌥ + ⌫");
  });

  it("Windows는 Ctrl/Alt/Shift/Del로 대체한다", () => {
    const s = buildShortcutSections(osKeySymbols("windows"));
    const file = s.find((x) => x.title === "파일 / UI")!;
    expect(file.rows.find((r) => r.action === "PDF 파일 열기")?.keys).toBe("Ctrl + O");
    expect(file.rows.find((r) => r.action === "실행 취소 / 다시 실행")?.keys).toBe(
      "Ctrl + Z / Shift + Ctrl + Z",
    );
    const edit = s.find((x) => x.title === "뷰어 > 블랙마킹 영역 수정")!;
    expect(edit.rows.find((r) => r.action === "선택 블랙마킹 영역 삭제")?.keys).toBe("Del");
  });

  it("변별 영역 조정(a/f/s/d) 4행과 보기모드 토글(C)이 포함된다(현행화)", () => {
    const s = buildShortcutSections(osKeySymbols("mac"));
    const edit = s.find((x) => x.title === "뷰어 > 블랙마킹 영역 수정")!;
    expect(edit.rows.filter((r) => r.action.includes("영역 조정")).length).toBe(4);
    const view = s.find((x) => x.title === "뷰어 > 보기·이동")!;
    expect(view.rows.some((r) => r.keys === "C")).toBe(true);
  });

  it("isKeySeparator는 +·/·또는만 구분자로 본다", () => {
    expect(["+", "/", "또는"].every(isKeySeparator)).toBe(true);
    expect(["⌘", "O", "↑", "클릭"].some(isKeySeparator)).toBe(false);
  });
});
