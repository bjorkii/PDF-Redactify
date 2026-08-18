import type { BookmarkNode } from "../store/appStore";

/** 트리를 문서 순서(깊이 우선, 전위)로 평탄화한다. */
export function flattenBookmarks(nodes: BookmarkNode[]): BookmarkNode[] {
  const result: BookmarkNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenBookmarks(node.children));
  }
  return result;
}

/**
 * BM-02: 현재 페이지에 해당하는 북마크 노드를 찾는다(§6.2 뷰어→북마크 동기화).
 * "해당하는 노드"는 페이지 목적지가 currentPageIndex 이하인 노드 중 가장 뒤쪽
 * (가장 큰 페이지, 동률이면 문서상 더 뒤에 있는 노드)이다 — 목차에서 현재
 * 읽고 있는 절을 가리키는 것과 같은 규칙.
 */
export function findActiveBookmarkNode(
  bookmarks: BookmarkNode[],
  currentPageIndex: number,
): BookmarkNode | null {
  let active: BookmarkNode | null = null;
  let bestPageIndex = -1;

  for (const node of flattenBookmarks(bookmarks)) {
    if (node.pageIndex === null) continue;
    if (node.pageIndex <= currentPageIndex && node.pageIndex >= bestPageIndex) {
      active = node;
      bestPageIndex = node.pageIndex;
    }
  }

  return active;
}

/** 접힌 조상 아래의 노드를 제외하고, 현재 화면에 보이는 노드만 문서 순서로 나열한다(BM-03). */
export function flattenVisibleBookmarks(
  nodes: BookmarkNode[],
  collapsedNodes: ReadonlySet<BookmarkNode>,
): BookmarkNode[] {
  const result: BookmarkNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (!collapsedNodes.has(node)) {
      result.push(...flattenVisibleBookmarks(node.children, collapsedNodes));
    }
  }
  return result;
}

/**
 * BM-03(§8.2 ↑/↓): 보이는 노드 목록 기준으로 현재 선택 노드의 이전/다음
 * 노드를 찾는다. 페이지 목적지가 없는 노드(외부 링크 등)는 건너뛴다.
 * 경계에 도달하면 더 이상 움직이지 않는다(순환하지 않음).
 */
export function computeNextActiveNode(
  visibleNodes: BookmarkNode[],
  activeNode: BookmarkNode | null,
  direction: 1 | -1,
): BookmarkNode | null {
  const navigable = visibleNodes.filter((node) => node.pageIndex !== null);
  if (navigable.length === 0) return null;

  const currentIndex = activeNode ? navigable.indexOf(activeNode) : -1;
  const nextIndex = Math.max(0, Math.min(navigable.length - 1, currentIndex + direction));

  return navigable[nextIndex];
}

/** target의 직계 부모 노드를 찾는다. 최상위 노드거나 트리에 없으면 null(BM-03 ←/→). */
export function findParentBookmarkNode(
  nodes: BookmarkNode[],
  target: BookmarkNode,
): BookmarkNode | null {
  for (const node of nodes) {
    if (node.children.includes(target)) return node;
    const found = findParentBookmarkNode(node.children, target);
    if (found) return found;
  }
  return null;
}

export interface BookmarkFoldTarget {
  /** 이 접기/펼치기 이후 방향키 탐색이 이어갈 기준점. 보이는 노드가 하나도 없으면 null. */
  nextBasis: BookmarkNode | null;
  /** 접거나 펼칠 대상(자식이 있는 기준 노드 자신, 또는 리프일 때의 부모). 대상이 없으면 null. */
  target: BookmarkNode | null;
  collapsed: boolean;
}

/**
 * BM-03(←/→): 기준 노드에 자식이 있으면 그 노드 자신을 접거나 펼친다(자기
 * 자신의 ▶/▼ 토글 버튼을 누른 것과 동일). 기준 노드가 리프(자식 없음)면
 * 스스로 접을 게 없으므로, 부모를 접으면서 선택(nextBasis)도 부모로 옮긴다
 * — 리프에서 →는 할 게 없다(리프가 보인다는 건 부모가 이미 펼쳐져 있다는
 * 뜻이므로).
 *
 * - basis가 없으면(아직 아무것도 선택 안 한 최초 상태) ↑/↓와 마찬가지로
 *   첫 번째로 보이는 노드를 기준으로 삼는다 — 그렇지 않으면 조용히
 *   아무 반응도 없이 끝난다.
 */
export function computeFoldTarget(
  bookmarks: BookmarkNode[],
  basis: BookmarkNode | null,
  visibleNodes: BookmarkNode[],
  direction: "left" | "right",
): BookmarkFoldTarget {
  const target = basis ?? visibleNodes[0] ?? null;
  if (!target) return { nextBasis: null, target: null, collapsed: false };

  if (target.children.length > 0) {
    return { nextBasis: target, target, collapsed: direction === "left" };
  }

  if (direction === "right") {
    // 리프는 스스로 펼칠 게 없다(보인다는 건 부모가 이미 펼쳐진 상태).
    return { nextBasis: target, target: null, collapsed: false };
  }

  const parent = findParentBookmarkNode(bookmarks, target);
  if (!parent) return { nextBasis: target, target: null, collapsed: false };

  return { nextBasis: parent, target: parent, collapsed: true };
}

/**
 * BM-02: activeNode(현재 페이지에 해당하는 노드)가 보이도록, 접힌 조상들만
 * 골라 collapsedNodes에서 뺀 새 Set을 돌려준다. 뺄 것이 없으면(이미 다
 * 펼쳐져 있으면) 원래 Set을 그대로 돌려줘(참조 동일성 유지) 불필요한
 * 리렌더를 막는다.
 *
 * 이 계산은 activeNode가 "바뀔 때"만 해야 한다 — collapsedNodes 자체가
 * 바뀔 때마다 매번 다시 실행하면, 사용자가 방금 수동으로 접은 조상을
 * activeNode가 그 안에 있다는 이유로 곧바로 되펼쳐버려 접기 동작이
 * 즉시 취소된 것처럼 보인다(호출부가 activeNode만 의존성으로 둬야 하는 이유).
 */
export function expandAncestorsOf(
  bookmarks: BookmarkNode[],
  collapsedNodes: Set<BookmarkNode>,
  activeNode: BookmarkNode | null,
): Set<BookmarkNode> {
  if (!activeNode) return collapsedNodes;

  let next: Set<BookmarkNode> | null = null;
  let ancestor = findParentBookmarkNode(bookmarks, activeNode);
  while (ancestor) {
    if (collapsedNodes.has(ancestor)) {
      if (!next) next = new Set(collapsedNodes);
      next.delete(ancestor);
    }
    ancestor = findParentBookmarkNode(bookmarks, ancestor);
  }

  return next ?? collapsedNodes;
}
