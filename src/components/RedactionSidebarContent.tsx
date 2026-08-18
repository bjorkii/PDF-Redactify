import { useAppStore } from "../store/appStore";
import { ko } from "../i18n/ko";
import { deleteAllReviewItems, deleteSelectedReviewItem } from "../services/reviewItemActions";
import { RedactionList } from "./RedactionList";
import { DeleteAllRedactionIcon, DeleteRedactionIcon, PinIcon } from "./icons";
import { useSidebarDockDrag } from "../hooks/useSidebarDockDrag";

/**
 * SPEC §6.4 블랙마킹 목록표. 도킹/플로팅 두 컨테이너(RedactionSidebar,
 * FloatingRedactionPanel)가 이 내용을 공유한다. 항목이 있으면 LIST-01
 * 가상화 테이블을, 없으면 안내 문구를 보여준다. 헤더의 삭제/모두삭제/제외
 * 아이콘 버튼(LIST-09, §8)은 각각 Del/Option+Del/Space와 같은 동작이다.
 * 클릭이 뷰어/목록 행의 DOM 포커스를 빼앗지 않도록 onMouseDown에서
 * preventDefault한다(preserveFocus.ts와 동일한 기법 — 클릭 직전 포커스가
 * 그대로 유지돼야 방향키 등 포커스 기반 단축키가 끊기지 않는다).
 */
export function RedactionSidebarContent() {
  const floating = useAppStore((s) => s.redactionSidebar.floating);
  const toggleFloating = useAppStore((s) => s.toggleRedactionFloating);
  const reviewItems = useAppStore((s) => s.reviewItems);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const selectedItem = reviewItems.find((item) => item.id === selectedItemId) ?? null;
  // SIDE-02/03: 도킹 상태일 때만 이름표시줄을 도킹 드래그 핸들로 쓴다 —
  // 플로팅 중엔 FloatingPanel 자신의 제목표시줄이 이동을 담당하므로
  // 겹치면 안 된다.
  const handleHeaderPointerDown = useSidebarDockDrag("redaction");

  function preserveFocus(event: React.MouseEvent) {
    event.preventDefault();
  }

  return (
    <>
      <div
        className={`sidebar-header${floating ? "" : " sidebar-header-draggable"}`}
        onPointerDown={floating ? undefined : handleHeaderPointerDown}
      >
        <span>{ko.redactionSidebar.title}</span>
        {reviewItems.length > 0 && (
          <>
            <button
              type="button"
              className="icon-button"
              title={ko.redactionSidebar.delete}
              aria-label={ko.redactionSidebar.delete}
              disabled={!selectedItem}
              onMouseDown={preserveFocus}
              onClick={deleteSelectedReviewItem}
            >
              <DeleteRedactionIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              title={ko.redactionSidebar.deleteAll}
              aria-label={ko.redactionSidebar.deleteAll}
              onMouseDown={preserveFocus}
              onClick={deleteAllReviewItems}
            >
              <DeleteAllRedactionIcon />
            </button>
          </>
        )}
        {!floating && (
          <button
            type="button"
            className="icon-button"
            title={ko.redactionSidebar.float}
            aria-label={ko.redactionSidebar.float}
            onClick={toggleFloating}
          >
            <PinIcon />
          </button>
        )}
      </div>
      {reviewItems.length === 0 ? (
        <div className="sidebar-body">{ko.redactionSidebar.empty}</div>
      ) : (
        <RedactionList />
      )}
    </>
  );
}
