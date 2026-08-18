import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/appStore";
import { ko } from "../i18n/ko";
import type { ReviewItem } from "../types/generated/ReviewItem";
import { categoryLabel } from "../utils/reviewItemCategory";
import { buildEditedReviewItem, type EditableField } from "../utils/reviewItemEdit";
import { TruncatedText } from "./TruncatedText";

// 편집 드롭박스 옵션: 오검출 정정을 위해 **모든** 카테고리를 보여주되, 자모순
// 정렬하고 '사용자 지정'(Custom)은 항상 맨 아래로 둔다(사용자 요청).
const EDIT_CATEGORY_OPTIONS = [...ko.redactionCategories].sort((a, b) => {
  if (a.value === "Custom") return 1;
  if (b.value === "Custom") return -1;
  return a.label.localeCompare(b.label, "ko");
});

interface RedactionListRowProps {
  item: ReviewItem;
  index: number;
  /** 활성(primary) 항목 — 포커스·편집·뷰어 연동 기준. */
  isActive: boolean;
  /** LIST-10: 다중선택 집합에 포함되는지(선택 강조용). */
  isSelected: boolean;
  height: number;
  offsetY: number;
  /** LIST-15: 구분·위치 컬럼 고정폭(px). 헤더와 동일 값을 받아 정렬을 맞춘다. */
  columnWidths: { category: number; page: number };
  /** 마우스 down — modifier(shift/cmd) 판정·드래그 시작은 부모가 한다. */
  onPointerSelect: (event: React.MouseEvent, index: number) => void;
  /** 드래그 중 이 행 위로 진입(범위 확장). event.buttons로 실제 드래그인지 판정. */
  onPointerEnter: (event: React.MouseEvent, index: number) => void;
}

/**
 * LIST-03/04/06/EDIT-01/IO-03(§6.3.2/§6.3.3, §8.3, §5.4): 행 하나. 구분
 * 셀은 선택되지 않은 상태에서 클릭하면 선택만 되고, 이미 선택된 행에서
 * 다시 클릭("재클릭")해야 수정모드로 들어간다(드롭박스, §5.3). 내용 셀은
 * 클릭 한 번으로 선택+수정모드 진입을 함께 한다(텍스트 입력). Enter(포커스
 * 위치 무관, App.tsx)도 선택된 항목의 내용 셀을 수정모드로 연다. Space는
 * 제외/포함을 토글하고, 제외
 * 항목은 회색으로 표시한다(§6.4). ↑/↓는 선택을 이전/다음 항목으로 옮긴다
 * (실제 이동 계산은 부모가 한다 — 가상화로 화면 밖 행은 언마운트되므로).
 * ←/→는 뷰어와 동일하게 앞/뒤 페이지 이동이다(§8.1 — 뷰어와 이 목록은
 * 이제 하나의 키보드 도메인이라, 이 목록에 포커스가 있어도 뷰어와 똑같이
 * 동작한다. 그래서 이 목록 자체는 Tab의 대상도, SIDE-05 포커스 테두리
 * 대상도 아니다 — §7.4/§8.4).
 * 선택되면(마운트 시 포함) 스스로 DOM 포커스를 가져가 키보드 탐색이 끊기지
 * 않게 한다. 뷰어에서 방금 드래그로 만든 항목이면(pendingEditItemId) 곧바로
 * 내용 편집모드로 들어간다. 가져오기 재탐색에 실패한 항목은 위치 옆에
 * 경고 표시(⚠, 위치확인 필요)가 붙는다.
 * 모든 변경은 recordHistoryChange(...)로 store에 반영되어 undo 가능하다
 * (STATE-06), sidecar 자동저장(STATE-03)도 그 변화를 그대로 감지한다.
 */
export function RedactionListRow({
  item,
  index,
  isActive,
  isSelected,
  height,
  offsetY,
  columnWidths,
  onPointerSelect,
  onPointerEnter,
}: RedactionListRowProps) {
  const categoryStyle = { flex: `0 0 ${columnWidths.category}px` } as const;
  const pageStyle = { flex: `0 0 ${columnWidths.page}px` } as const;
  const recordHistoryChange = useAppStore((s) => s.recordHistoryChange);
  const pendingEditItemId = useAppStore((s) => s.pendingEditItemId);
  const setPendingEditItemId = useAppStore((s) => s.setPendingEditItemId);
  const positionUncertain = useAppStore((s) => s.positionUncertainItemIds.has(item.id));
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

  // LIST(사용자 요청): '내용'은 사용자지정(manual) 항목만 편집 가능 — 자동검출
  // 항목은 검출된 실제 텍스트를 그대로 유지해야 블랙마킹이 원문과 어긋나지 않는다.
  const contentEditable = item.origin === "manual";

  // §8.1 뷰어 포커스 중 ↑/↓로도 selectedItemId가 바뀐다(뷰어와 이 목록이
  // selectAdjacentReviewItem을 공유 — 이제 뷰어와 블랙마킹 목록은 하나의
  // 키보드 도메인이다). 그때까지 여기서 무조건 focus()하면 뷰어에서
  // 방향키를 눌렀을 뿐인데 포커스가 목록으로 뺏겨버린다 — 그래서 이미
  // 포커스가 이 목록 안에 있을 때만(=이 목록 자체를 키보드/클릭으로 탐색
  // 중일 때만) 다음 행으로 focus를 옮긴다.
  useEffect(() => {
    if (!isActive) return;
    if (!document.activeElement?.closest('[data-sidebar-id="redaction"]')) return;
    rowRef.current?.focus();
  }, [isActive]);

  // EDIT-01(§6.3.2)/KEY-01: 드래그로 방금 만든 항목이면, 또는 Enter를
  // 눌러(포커스 위치 무관 — App.tsx) 편집을 요청받으면 내용 편집모드로
  // 바로 들어간다(placeholder "사용자 추가"는 입력창 쪽에서 보여준다).
  useEffect(() => {
    if (pendingEditItemId === item.id) {
      // 자동검출/가져오기 항목은 내용 편집을 막으므로 Enter로도 열지 않는다.
      if (contentEditable) setEditingField("content");
      setPendingEditItemId(null);
    }
  }, [pendingEditItemId, item.id, setPendingEditItemId, contentEditable]);

  // KEY-01: 편집모드를 벗어나면(Enter로 커밋·Escape로 취소·다른 셀 blur 등)
  // 포커스가 어디로도 안 옮겨진다 — 방금까지 있던 <input>/<select>가
  // 사라지면서 그냥 body로 떨어진다(사용자 재현: "엔터로 편집모드를 벗어난
  // 후 뷰어에 포커스가 안 잡혀 방향키가 스크롤로 동작함"). 이 행 자체가
  // 뷰어와 하나의 키보드 도메인이므로(§8.1), 편집모드가 "새로 꺼졌을 때"
  // (계속 null이었던 게 아니라 무언가 편집 중이다가 끝났을 때)만 이 행으로
  // 포커스를 되돌려 방향키 등이 곧바로 이어지게 한다.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && editingField === null && isActive) {
      rowRef.current?.focus();
    }
    wasEditing.current = editingField !== null;
  }, [editingField, isActive]);

  // 구분 커스텀 드롭다운이 열린 동안 바깥 클릭·Escape로 닫는다.
  useEffect(() => {
    if (editingField !== "category") return;
    function onDocMouseDown(event: MouseEvent) {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setEditingField(null);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setEditingField(null);
    }
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [editingField]);

  function commit(field: EditableField, value: string) {
    const edited = buildEditedReviewItem(item, field, value, new Date().toISOString());
    if (edited) recordHistoryChange("edit", item.id, item, edited);
    setEditingField(null);
  }

  // 선택은 부모의 pointer-down(modifier·드래그 판정)이 담당한다. 여기서는
  // modifier(cmd/shift) 클릭이면 편집으로 들어가지 않고 선택 조작만 남긴다.
  function isSelectionModifier(event: React.MouseEvent) {
    return event.shiftKey || event.metaKey || event.ctrlKey;
  }

  // KEY-01(사용자 요청): '내용' 셀은 클릭 한 번으로 곧바로 편집모드에 들어간다
  // (선택은 pointer-down이 이미 했다). modifier 클릭이면 편집하지 않는다.
  function handleContentClick(event: React.MouseEvent) {
    if (isSelectionModifier(event)) return;
    if (!contentEditable) return; // 자동검출/가져오기 항목은 선택만, 편집 불가.
    // 사용자 요청: 선택하자마자 편집모드로 들어가지 말고, "이미 선택된(활성)
    // 상태에서 한 번 더 클릭"할 때 편집으로 들어간다(구분 셀과 동일한 2단계).
    // 첫 클릭 즉시 편집으로 들어가면, pointer-down 선택으로 isActive가
    // false→true가 되며 포커스 이펙트가 입력창 포커스를 뺏어 즉시 blur·커밋되는
    // 버그가 있었다(사용자 재현: "사용자지정 항목도 편집이 막힘").
    if (!isActive) return;
    setEditingField("content");
  }

  // §반복 재현 버그: 이 행이 DOM 포커스를 가진 채 가상화로 언마운트되면
  // (스크롤아웃) 포커스가 body로 떨어져 ↑/↓이 먹통이 됐다. 언마운트 시
  // 포커스를 부모 스크롤 컨테이너로 넘겨, 컨테이너(RedactionList의
  // handleListKeyboard)가 계속 방향키를 처리하게 한다. 클린업은 React가 DOM을
  // 제거하기 전에 실행되므로 이 시점엔 아직 closest로 조상을 찾을 수 있다.
  useEffect(() => {
    const row = rowRef.current;
    return () => {
      if (document.activeElement === row) {
        row?.closest<HTMLElement>("[data-redaction-scroll]")?.focus();
      }
    };
  }, []);

  return (
    <div
      ref={rowRef}
      role="row"
      tabIndex={0}
      data-review-item-id={item.id}
      className={`redaction-list-row${isActive ? " active" : ""}${isSelected ? " selected" : ""}${editingField === "category" ? " editing-category" : ""}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: `${height}px`,
        transform: `translateY(${offsetY}px)`,
      }}
      onMouseDown={(event) => onPointerSelect(event, index)}
      onMouseEnter={(event) => onPointerEnter(event, index)}
    >
      {editingField === "category" ? (
        <div
          ref={categoryDropdownRef}
          className="redaction-list-cell redaction-list-cell-category redaction-category-edit"
          style={categoryStyle}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className="redaction-category-current">{categoryLabel(item.category)}</span>
          <ul className="redaction-category-dropdown" role="listbox">
            {EDIT_CATEGORY_OPTIONS.map((option) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === item.category}
                className={`redaction-category-option${option.value === item.category ? " selected" : ""}`}
                // mousedown 단계에서 선택+커밋 — 바깥클릭 닫기 리스너보다 먼저 처리.
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  commit("category", option.value);
                }}
              >
                <span className="redaction-category-check">{option.value === item.category ? "✓" : ""}</span>
                {option.label}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <TruncatedText
          text={categoryLabel(item.category)}
          className="redaction-list-cell redaction-list-cell-category"
          style={categoryStyle}
          // 구분 드롭다운은 mousedown에서 연다(클릭 이벤트는 행 드래그선택과
          // 얽혀 이따금 눌러도 안 열렸다 — 사용자 재현 "재클릭 무반응"). 이미
          // 선택된(활성) 행에서 누를 때만 펼치고, 비활성이면 행 mousedown이
          // 선택만 하게 둔다(첫 클릭 선택 → 재클릭 펼침, 2단계).
          onMouseDown={(event) => {
            if (event.shiftKey || event.metaKey || event.ctrlKey) return;
            if (isActive) {
              event.stopPropagation();
              setEditingField("category");
            }
          }}
        />
      )}

      {editingField === "content" ? (
        <input
          type="text"
          className="redaction-list-cell redaction-list-cell-content redaction-list-cell-input"
          autoFocus
          placeholder={ko.redactionSidebar.newItemPlaceholder}
          defaultValue={item.content}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => commit("content", event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") commit("content", event.currentTarget.value);
            else if (event.key === "Escape") setEditingField(null);
          }}
        />
      ) : (
        <TruncatedText
          // 내용이 빈 사용자 지정 항목은 placeholder를 보여 클릭 타깃(편집 진입)을
          // 확보한다 — 빈 문자열이면 셀 폭이 0이 되어 클릭할 수 없던 문제 대응.
          text={contentEditable && item.content === "" ? ko.redactionSidebar.newItemPlaceholder : item.content}
          className={`redaction-list-cell redaction-list-cell-content${
            contentEditable && item.content === "" ? " redaction-list-cell-placeholder" : ""
          }`}
          onClick={(event) => {
            event.stopPropagation();
            handleContentClick(event);
          }}
        />
      )}

      <span className="redaction-list-cell redaction-list-cell-page" style={pageStyle}>
        {item.page + 1}
        {/* IO-03(§5.4): 가져오기 재탐색 실패 → $bbox 폴백, 위치 확인 필요 안내. */}
        {positionUncertain && <span title="위치확인 필요">⚠</span>}
      </span>
    </div>
  );
}
