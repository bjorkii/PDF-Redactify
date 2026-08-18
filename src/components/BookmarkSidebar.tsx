import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore, type BookmarkNode } from "../store/appStore";
import { ko } from "../i18n/ko";
import { goToPage } from "../services/pdfService";
import { SidebarShell } from "./SidebarShell";
import { BookmarkTreeItem } from "./BookmarkTreeItem";
import { useSidebarDockDrag } from "../hooks/useSidebarDockDrag";
import {
  computeFoldTarget,
  computeNextActiveNode,
  expandAncestorsOf,
  findActiveBookmarkNode,
  flattenVisibleBookmarks,
} from "../utils/bookmarkActive";

// SPEC §6.2 북마크 트리 사이드바. 노드 클릭 시 해당 페이지로 이동(BM-01),
// 현재 페이지에 해당하는 노드는 선택 표시+오토스크롤(BM-02),
// ↑/↓ 선택 이동·←/→ 부모 노드 접기/펼치기(BM-03, §8.2).
export function BookmarkSidebar() {
  const dock = useAppStore((s) => s.bookmarkSidebar.dock);
  const width = useAppStore((s) => s.bookmarkSidebar.width);
  const bookmarks = useAppStore((s) => s.bookmarks);
  const currentPageIndex = useAppStore((s) => s.currentPageIndex);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<BookmarkNode>>(new Set());
  // SIDE-02/03: 얇은 핸들뿐 아니라 이름표시줄 전체도 드래그 핸들로 쓴다 —
  // 사용자 피드백(핸들을 찾기 어려움)에 따라 훨씬 넓은 영역을 제공한다.
  const handleHeaderPointerDown = useSidebarDockDrag("bookmark");

  const activeNode = useMemo(
    () => findActiveBookmarkNode(bookmarks, currentPageIndex),
    [bookmarks, currentPageIndex],
  );

  const visibleNodes = useMemo(
    () => flattenVisibleBookmarks(bookmarks, collapsedNodes),
    [bookmarks, collapsedNodes],
  );

  const handleSetCollapsed = useCallback((node: BookmarkNode, collapsed: boolean) => {
    setCollapsedNodes((prev) => {
      const isCollapsed = prev.has(node);
      if (collapsed === isCollapsed) return prev;
      const next = new Set(prev);
      if (collapsed) next.add(node);
      else next.delete(node);
      return next;
    });
  }, []);

  // BM-02: activeNode가 "바뀔 때"만 접힌 조상을 펼친다. collapsedNodes
  // 자체가 바뀔 때마다(예: ←로 방금 접었을 때) 다시 실행하면, activeNode가
  // 여전히 그 조상 안에 있다는 이유로 방금 접은 걸 곧바로 되펼쳐버린다
  // (←로 접어도 바로 다시 펴지는 것처럼 보이는 원인이었다).
  useEffect(() => {
    setCollapsedNodes((prev) => expandAncestorsOf(bookmarks, prev, activeNode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNode]);

  // BM-02/BM-03: 화면에 강조 표시할 노드. currentPageIndex(→activeNode)만
  // 따라가면 부족하다 — 같은 페이지를 가리키는 형제/부모 노드가 TOC에 흔한데,
  // 그럴 땐 goToPage가 "이미 그 페이지"라 페이지 번호가 안 바뀌고, 그러면
  // activeNode의 useMemo도 다시 안 돌아서(deps 불변) 방향키로 실제로는 다른
  // 노드로 옮겨갔는데도 이전 노드가 계속 강조 표시로 남는다. 그래서 방향키/
  // 클릭으로 옮긴 노드는 이 state에 바로 반영하고, activeNode는 "뷰어를 직접
  // 스크롤/이동해서 바뀐 경우"만 별도 effect로 따라가게 한다.
  const [selectedNode, setSelectedNode] = useState<BookmarkNode | null>(activeNode);

  useEffect(() => {
    setSelectedNode(activeNode);
    // bookmarks가 바뀌면(새 문서) activeNode 참조가 우연히 이전과 같은 값(둘
    // 다 null)일 수 있어 deps에 bookmarks도 포함해, 이전 문서의 죽은 노드
    // 참조가 selectedNode에 남지 않게 한다.
  }, [activeNode, bookmarks]);

  function handleNodeSelected(node: BookmarkNode) {
    setSelectedNode(node);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const basis = selectedNode;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = computeNextActiveNode(visibleNodes, basis, event.key === "ArrowDown" ? 1 : -1);
      if (next && next.pageIndex !== null) {
        setSelectedNode(next);
        void goToPage(next.pageIndex);
      }
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const fold = computeFoldTarget(
        bookmarks,
        basis,
        visibleNodes,
        event.key === "ArrowLeft" ? "left" : "right",
      );
      if (!fold.nextBasis) return;
      setSelectedNode(fold.nextBasis);
      // 선택(nextBasis)이 리프 → 부모로 옮겨간 경우, 뷰어도 그 페이지로
      // 이동한다 — ↑/↓와 동일한 방식.
      if (fold.nextBasis !== basis && fold.nextBasis.pageIndex !== null) {
        void goToPage(fold.nextBasis.pageIndex);
      }
      if (fold.target) handleSetCollapsed(fold.target, fold.collapsed);
    }
  }

  return (
    <SidebarShell sidebarId="bookmark" dock={dock} width={width} onKeyDown={handleKeyDown}>
      <div className="sidebar-header sidebar-header-draggable" onPointerDown={handleHeaderPointerDown}>
        {ko.bookmarkSidebar.title}
      </div>
      {bookmarks.length === 0 ? (
        <div className="sidebar-body">{ko.bookmarkSidebar.empty}</div>
      ) : (
        <ul className="bookmark-tree">
          {bookmarks.map((node, index) => (
            <BookmarkTreeItem
              key={index}
              node={node}
              selectedNode={selectedNode}
              collapsedNodes={collapsedNodes}
              onSetCollapsed={handleSetCollapsed}
              onSelect={handleNodeSelected}
            />
          ))}
        </ul>
      )}
    </SidebarShell>
  );
}
