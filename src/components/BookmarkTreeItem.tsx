import { useEffect, useRef } from "react";
import type { BookmarkNode } from "../store/appStore";
import { goToPage } from "../services/pdfService";
import { computeAutoScrollTop } from "../utils/autoScroll";
import { TruncatedText } from "./TruncatedText";
import "./BookmarkTreeItem.css";

interface BookmarkTreeItemProps {
  node: BookmarkNode;
  /** BM-02/BM-03: 화면에 강조 표시할 노드(참조 동일성으로 비교). */
  selectedNode: BookmarkNode | null;
  /** BM-03: 접힌 노드 집합(참조 동일성 기준) — 키보드 ←/→로도 조작되므로 상위에서 관리. */
  collapsedNodes: ReadonlySet<BookmarkNode>;
  onSetCollapsed: (node: BookmarkNode, collapsed: boolean) => void;
  /** BM-03: 클릭으로 선택하면 방향키 탐색 기준점도 이 노드로 맞춘다(상위 BookmarkSidebar). */
  onSelect: (node: BookmarkNode) => void;
}

// SPEC §6.2 북마크 트리의 한 노드. 자식이 있으면 접기/펼치기 가능하고,
// 뷰어 이동으로 선택된 노드는 강조 표시 + 화면 밖이면 오토스크롤된다(BM-02).
// 접힌 조상을 자동으로 펼치는 로직은 상위(BookmarkSidebar)가 activeNode가
// 바뀔 때만 한 번 처리한다 — 여기서 매 렌더 반응형으로 처리하면 collapsedNodes
// 변화 자체에도 반응해, 사용자가 방금 접은 조상을 곧바로 되펼쳐버린다.
export function BookmarkTreeItem({
  node,
  selectedNode,
  collapsedNodes,
  onSetCollapsed,
  onSelect,
}: BookmarkTreeItemProps) {
  const hasChildren = node.children.length > 0;
  const collapsed = collapsedNodes.has(node);
  const isActive = node === selectedNode;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive || !rowRef.current) return;

    const container = rowRef.current.closest<HTMLElement>(".sidebar-content");
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const itemRect = rowRef.current.getBoundingClientRect();
    const itemOffsetTop = itemRect.top - containerRect.top + container.scrollTop;

    const newScrollTop = computeAutoScrollTop(
      itemOffsetTop,
      itemRect.height,
      container.scrollTop,
      container.clientHeight,
    );

    if (newScrollTop !== null) {
      container.scrollTo({ top: newScrollTop, behavior: "smooth" });
    }
  }, [isActive]);

  function handleClick() {
    onSelect(node);
    if (node.pageIndex !== null) void goToPage(node.pageIndex);
  }

  return (
    <li className="bookmark-node">
      <div
        ref={rowRef}
        className={`bookmark-node-row${isActive ? " active" : ""}`}
        onClick={handleClick}
      >
        {hasChildren ? (
          <button
            type="button"
            className="bookmark-node-toggle"
            onClick={(event) => {
              event.stopPropagation();
              onSetCollapsed(node, !collapsed);
            }}
          >
            {collapsed ? "▶" : "▼"}
          </button>
        ) : (
          <span className="bookmark-node-toggle-placeholder" />
        )}
        <TruncatedText text={node.title} className="bookmark-node-title" />
      </div>
      {hasChildren && !collapsed && (
        <ul className="bookmark-node-children">
          {node.children.map((child, index) => (
            <BookmarkTreeItem
              key={index}
              node={child}
              selectedNode={selectedNode}
              collapsedNodes={collapsedNodes}
              onSetCollapsed={onSetCollapsed}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
