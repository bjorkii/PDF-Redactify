import { describe, expect, it } from "vitest";
import { buildNewManualReviewItem } from "./reviewItemCreate";

describe("buildNewManualReviewItem (EDIT-01, §6.3.2)", () => {
  it("origin=manual, category=Custom, content은 빈 문자열인 새 항목을 만든다", () => {
    const bbox = { x: 0.1, y: 0.2, width: 0.3, height: 0.05 };
    const item = buildNewManualReviewItem("m-1", 2, bbox, "2026-01-01T00:00:00.000Z");

    expect(item.origin).toBe("manual");
    expect(item.page).toBe(2);
    expect(item.bbox).toEqual(bbox);
    expect(item.category).toBe("Custom");
    expect(item.content).toBe("");
    expect(item.pattern_type).toBeNull();
    expect(item.confidence).toBeNull();
    expect(item.validation).toBe("NotValidated");
    expect(item.modified).toBe(false);
    expect(item.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(item.updated_at).toBe("2026-01-01T00:00:00.000Z");
  });
});
