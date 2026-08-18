import { useAppStore } from "../store/appStore";
import {
  computeEdgeResizedBbox,
  bboxEquals,
  isDragRectSignificant,
  type BoxEdge,
} from "../utils/dragRect";
import { EMPTY_MARGINS, marginsToDragBounds } from "../utils/exclusionZone";
import { physicalLetter } from "../utils/platform";
import type { ReviewItem } from "../types/generated/ReviewItem";

/**
 * B-6/B-7(EDIT-17): 뷰포트에서 선택된 bbox를 변 단위로 키보드 리사이즈한다.
 * 수식어 키(a=왼변·f=오른변·s=윗변·d=아랫변)를 누른 채 화살표를 누르면 그
 * 변을 한 스텝씩 민다. **좌우·상하 화살표를 모두 받는다**(어느 축인지 헷갈리지
 * 않게 — 사용자 요청): ←/↑는 변을 좌상(−)으로, →/↓는 우하(+)로 민다. 단일
 * 선택이면 그 항목, 다중 선택이면 group_id로 묶어 함께 조정한다(undo 한 번에
 * 복원 — B-7). EDIT-02의 좌상단 원점 규약과 제외영역 bounds를 그대로 따른다.
 * ※ 자동검출 content 재추출(EDIT-10)은 화살표 연타로 백엔드를 난타하지 않도록
 * 키보드 리사이즈에는 넣지 않는다 — 블랙마킹은 bbox 기준이라 저장 결과 정확성에는
 * 영향이 없고, content는 표시/엑셀 라벨이다.
 */

/** 화살표 1회당 미는 양(페이지 상대좌표 0~1). 표 과검출 미세 조정용이라 작게. */
export const ARROW_RESIZE_STEP = 0.004;

/** 눌린 변 수식어(a/f/s/d) → 대상 변. */
const RESIZE_MODIFIER_EDGE: Record<string, BoxEdge> = {
  a: "left",
  f: "right",
  s: "top",
  d: "bottom",
};

// 사용자 요청: 각 변 수식어는 **좌우·상하 화살표를 모두** 받는다(조작 시 어느
// 축인지 헷갈리지 않게). 화살표는 방향만 부호로 쓴다 — ←/↑ = 변을 좌상(−)으로,
// →/↓ = 우하(+)로 민다. 변의 축(수평/수직)은 그 변 자체가 정하므로(왼/오른변은
// x, 윗/아랫변은 y) 같은 부호를 어느 변에 적용하든 그 변의 축을 따라 움직인다.
const ARROW_SIGN: Record<string, 1 | -1> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

const heldEdges = new Set<BoxEdge>();

/**
 * 창 전역 keyup/blur로 홀드 상태를 관리한다 — keydown은 뷰어 핸들러에서
 * 넣지만, keyup은 포커스가 어디에 있든 놓아줘야 하고(전역), 창 포커스를
 * 잃으면 keyup을 못 받을 수 있어 blur에서 리셋한다. App에서 install.
 */
export function installResizeModifierTracking(): () => void {
  function onKeyUp(event: KeyboardEvent) {
    // 한/영 무관: 물리 키 위치로 해제(누를 때와 같은 기준이어야 홀드가 안 샌다).
    const letter = physicalLetter(event) ?? event.key.toLowerCase();
    const edge = RESIZE_MODIFIER_EDGE[letter];
    if (edge) heldEdges.delete(edge);
  }
  function onBlur() {
    heldEdges.clear();
  }
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
  };
}

/**
 * a/f/s/d keydown이면 홀드 집합에 넣고 true를 돌려준다(수식어 자체는 무동작).
 * 한/영 무관: 물리 키 위치(event.code)를 우선 쓰고, 글자 키가 아니면 event.key.
 */
export function noteResizeModifierDown(event: { key: string; code?: string }): boolean {
  const letter = physicalLetter(event) ?? event.key.toLowerCase();
  const edge = RESIZE_MODIFIER_EDGE[letter];
  if (!edge) return false;
  heldEdges.add(edge);
  return true;
}

export function heldResizeEdges(): BoxEdge[] {
  return [...heldEdges];
}

/** 테스트/포커스 리셋용. */
export function clearHeldResizeEdges(): void {
  heldEdges.clear();
}

function pageBounds(pageIndex: number) {
  const margins =
    useAppStore.getState().exclusionZones.find((z) => z.pageIndex === pageIndex)?.margins ?? EMPTY_MARGINS;
  return marginsToDragBounds(margins);
}

/**
 * 눌려 있는 모든 변 수식어를, 선택된 모든 bbox에 이 화살표의 부호로 적용한다
 * (좌우·상하 화살표 모두 허용 — 각 변은 자기 축을 따라 움직인다). 하나라도
 * 실제로 바꿨으면 true(caller가 preventDefault). 눌린 변이 없거나 화살표가
 * 아니면 false(일반 이동 로직으로 넘긴다).
 */
export function applyKeyboardResize(arrowKey: string): boolean {
  const sign = ARROW_SIGN[arrowKey];
  if (sign === undefined) return false;
  const edges = heldResizeEdges();
  if (edges.length === 0) return false;

  const { reviewItems, selectedItemId, selectedItemIds, recordHistoryChange, clearPositionUncertain } =
    useAppStore.getState();
  const targetIds =
    selectedItemIds.size > 0 ? selectedItemIds : selectedItemId ? new Set([selectedItemId]) : new Set<string>();
  if (targetIds.size === 0) return false;

  const targets = reviewItems.filter((item) => targetIds.has(item.id));
  if (targets.length === 0) return false;

  const delta = sign * ARROW_RESIZE_STEP;
  const now = new Date().toISOString();
  const groupId = targets.length > 1 ? `kbresize-${crypto.randomUUID()}` : undefined;

  let changed = false;
  for (const item of targets) {
    const bounds = pageBounds(item.page);
    let bbox = item.bbox;
    for (const edge of edges) {
      bbox = computeEdgeResizedBbox(bbox, edge, delta, bounds);
    }
    if (bboxEquals(bbox, item.bbox) || !isDragRectSignificant(bbox)) continue;
    const after: ReviewItem = {
      ...item,
      bbox,
      // 여러 번 고쳐도 최초 좌표만 보존(EDIT-02와 동일).
      original_bbox: item.original_bbox ?? item.bbox,
      modified: true,
      updated_at: now,
    };
    recordHistoryChange("move", item.id, item, after, groupId);
    clearPositionUncertain(item.id);
    changed = true;
  }
  return changed;
}
