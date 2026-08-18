import { describe, expect, it } from "vitest";
import type { BookmarkNode } from "../store/appStore";
import {
  computeFoldTarget,
  computeNextActiveNode,
  expandAncestorsOf,
  findActiveBookmarkNode,
  findParentBookmarkNode,
  flattenBookmarks,
  flattenVisibleBookmarks,
} from "./bookmarkActive";

const node = (title: string, pageIndex: number | null, children: BookmarkNode[] = []): BookmarkNode => ({
  title,
  pageIndex,
  children,
});

describe("flattenBookmarks", () => {
  it("깊이 우선 전위 순서로 평탄화한다", () => {
    const tree = [
      node("A", 0, [node("A1", 1), node("A2", 2)]),
      node("B", 3),
    ];

    expect(flattenBookmarks(tree).map((n) => n.title)).toEqual(["A", "A1", "A2", "B"]);
  });
});

describe("findActiveBookmarkNode (BM-02)", () => {
  const tree = [
    node("표지", 0),
    node("서론", 3, [node("서론-1", 4), node("서론-2", 6)]),
    node("결론", 9),
  ];

  it("정확히 그 페이지를 가리키는 노드를 찾는다", () => {
    expect(findActiveBookmarkNode(tree, 4)?.title).toBe("서론-1");
  });

  it("페이지 사이에 있으면 그 이전 가장 가까운 노드를 찾는다", () => {
    expect(findActiveBookmarkNode(tree, 5)?.title).toBe("서론-1");
    expect(findActiveBookmarkNode(tree, 8)?.title).toBe("서론-2");
  });

  it("첫 노드 이전 페이지면 null을 반환한다", () => {
    // 이 트리엔 없지만, 방어적으로 -1 같은 값에도 null이어야 함
    expect(findActiveBookmarkNode(tree, -1)).toBeNull();
  });

  it("마지막 노드 이후 페이지는 마지막 노드를 가리킨다", () => {
    expect(findActiveBookmarkNode(tree, 100)?.title).toBe("결론");
  });

  it("페이지 목적지가 없는 노드(null)는 무시한다", () => {
    const withUnlinked = [node("외부링크", null), node("본문", 2)];
    expect(findActiveBookmarkNode(withUnlinked, 5)?.title).toBe("본문");
  });

  it("북마크가 없으면 null을 반환한다", () => {
    expect(findActiveBookmarkNode([], 0)).toBeNull();
  });
});

describe("flattenVisibleBookmarks (BM-03)", () => {
  it("접힌 노드가 없으면 flattenBookmarks와 동일하다", () => {
    const tree = [node("A", 0, [node("A1", 1)]), node("B", 2)];
    expect(flattenVisibleBookmarks(tree, new Set()).map((n) => n.title)).toEqual([
      "A",
      "A1",
      "B",
    ]);
  });

  it("접힌 노드의 자손은 제외한다(노드 자신은 포함)", () => {
    const a1 = node("A1", 1);
    const a = node("A", 0, [a1]);
    const b = node("B", 2);

    expect(flattenVisibleBookmarks([a, b], new Set([a])).map((n) => n.title)).toEqual(["A", "B"]);
  });
});

describe("computeNextActiveNode (BM-03 ↑/↓)", () => {
  const a = node("A", 0);
  const b = node("B", 1);
  const c = node("C", 2);
  const visible = [a, b, c];

  it("아래로(direction=1) 다음 노드를 선택한다", () => {
    expect(computeNextActiveNode(visible, a, 1)).toBe(b);
  });

  it("위로(direction=-1) 이전 노드를 선택한다", () => {
    expect(computeNextActiveNode(visible, b, -1)).toBe(a);
  });

  it("맨 끝에서는 더 이상 움직이지 않는다(경계 고정)", () => {
    expect(computeNextActiveNode(visible, c, 1)).toBe(c);
    expect(computeNextActiveNode(visible, a, -1)).toBe(a);
  });

  it("페이지 목적지가 없는 노드는 건너뛴다", () => {
    const unlinked = node("링크없음", null);
    const withUnlinked = [a, unlinked, b];
    expect(computeNextActiveNode(withUnlinked, a, 1)).toBe(b);
  });

  it("선택된 노드가 없으면 첫 번째 노드를 선택한다", () => {
    expect(computeNextActiveNode(visible, null, 1)).toBe(a);
  });

  it("보이는 노드가 없으면 null을 반환한다", () => {
    expect(computeNextActiveNode([], null, 1)).toBeNull();
  });
});

describe("findParentBookmarkNode (BM-03 ←/→)", () => {
  it("직계 부모를 찾는다", () => {
    const child = node("자식", 1);
    const parent = node("부모", 0, [child]);
    expect(findParentBookmarkNode([parent], child)).toBe(parent);
  });

  it("중첩된 트리에서도 부모를 찾는다", () => {
    const grandchild = node("손자", 2);
    const child = node("자식", 1, [grandchild]);
    const parent = node("부모", 0, [child]);
    expect(findParentBookmarkNode([parent], grandchild)).toBe(child);
  });

  it("최상위 노드는 부모가 없다(null)", () => {
    const top = node("최상위", 0);
    expect(findParentBookmarkNode([top], top)).toBeNull();
  });
});

describe("expandAncestorsOf (BM-02: activeNode가 보이도록 접힌 조상 펼치기)", () => {
  it("activeNode의 접힌 조상들을 모두 뺀 새 Set을 돌려준다(조부모까지)", () => {
    const grandchild = node("손자", 2);
    const child = node("자식", 1, [grandchild]);
    const parent = node("부모", 0, [child]);
    const collapsed = new Set([parent, child]);

    const result = expandAncestorsOf([parent], collapsed, grandchild);

    expect(result.has(parent)).toBe(false);
    expect(result.has(child)).toBe(false);
  });

  it("이미 다 펼쳐져 있으면 원래 Set을 그대로 돌려준다(참조 동일성 유지)", () => {
    const child = node("자식", 1);
    const parent = node("부모", 0, [child]);
    const collapsed = new Set<typeof parent>();

    expect(expandAncestorsOf([parent], collapsed, child)).toBe(collapsed);
  });

  it("activeNode와 무관한(조상이 아닌) 접힌 노드는 그대로 둔다", () => {
    const child = node("자식", 1);
    const parent = node("부모", 0, [child]);
    const other = node("다른가지", 5);
    const collapsed = new Set([other]);

    const result = expandAncestorsOf([parent, other], collapsed, child);

    expect(result).toBe(collapsed);
    expect(result.has(other)).toBe(true);
  });

  it("activeNode가 없으면 원래 Set을 그대로 돌려준다", () => {
    const collapsed = new Set<BookmarkNode>();
    expect(expandAncestorsOf([], collapsed, null)).toBe(collapsed);
  });
});

describe("computeFoldTarget (BM-03 ←/→)", () => {
  it("자식이 있는 노드가 기준이면 ←는 자기 자신을 접는다(자신의 토글 버튼과 동일)", () => {
    const child = node("자식", 1);
    const parent = node("부모", 0, [child]);

    const result = computeFoldTarget([parent], parent, [parent, child], "left");

    expect(result.target).toBe(parent);
    expect(result.nextBasis).toBe(parent);
    expect(result.collapsed).toBe(true);
  });

  it("자식이 있는 노드가 기준이면 →는 자기 자신을 펼친다", () => {
    const child = node("자식", 1);
    const parent = node("부모", 0, [child]);

    const result = computeFoldTarget([parent], parent, [parent], "right");

    expect(result.target).toBe(parent);
    expect(result.nextBasis).toBe(parent);
    expect(result.collapsed).toBe(false);
  });

  it("자식 없는(리프) 노드가 기준이면 ←는 부모를 접고 기준점도 부모로 옮긴다", () => {
    const child = node("자식", 1);
    const parent = node("부모", 0, [child]);

    const result = computeFoldTarget([parent], child, [parent, child], "left");

    expect(result.target).toBe(parent);
    expect(result.nextBasis).toBe(parent);
    expect(result.collapsed).toBe(true);
  });

  it("리프가 기준이고 부모가 없으면(최상위 리프) ←는 아무것도 하지 않는다", () => {
    const top = node("최상위", 0);
    const result = computeFoldTarget([top], top, [top], "left");

    expect(result.target).toBeNull();
    expect(result.nextBasis).toBe(top);
  });

  it("리프가 기준이면 →는 아무것도 하지 않는다(보인다는 건 부모가 이미 펼쳐졌다는 뜻)", () => {
    const child = node("자식", 1);
    const parent = node("부모", 0, [child]);

    const result = computeFoldTarget([parent], child, [parent, child], "right");

    expect(result.target).toBeNull();
    expect(result.nextBasis).toBe(child);
  });

  it("basis가 없으면(최초 상태) 첫 번째로 보이는 노드를 기준으로 세운다", () => {
    const child = node("자식", 1);
    const parent = node("부모", 0, [child]);
    const visible = [parent, child];

    // visibleNodes[0]은 항상 최상위 노드다(문서 순서 평탄화). 이 노드에
    // 자식이 있으면 그 자신을 접는다.
    const result = computeFoldTarget([parent], null, visible, "left");

    expect(result.nextBasis).toBe(parent);
    expect(result.target).toBe(parent);
    expect(result.collapsed).toBe(true);
  });

  it("보이는 노드가 하나도 없으면 기준점도 null이다", () => {
    const result = computeFoldTarget([], null, [], "left");
    expect(result.nextBasis).toBeNull();
    expect(result.target).toBeNull();
  });

  it("이미 접힌 부모를 기준으로 다시 ←를 눌러도 그대로 접힌 채 멱등하다", () => {
    const grandchild = node("손자", 2);
    const child = node("자식", 1, [grandchild]);
    const parent = node("부모", 0, [child]);

    // 리프(grandchild)에서 ←로 접어 기준이 child로 옮겨온 상태를 가정.
    const first = computeFoldTarget([parent], grandchild, [parent, child, grandchild], "left");
    expect(first.nextBasis).toBe(child);

    // child 자신에게 자식(grandchild)이 있으므로, 이어서 ←를 누르면
    // child 자신을 접는다(조부모로 건너뛰지 않는다).
    const second = computeFoldTarget([parent], first.nextBasis, [parent, child], "left");
    expect(second.target).toBe(child);
    expect(second.nextBasis).toBe(child);
    expect(second.collapsed).toBe(true);
  });
});
