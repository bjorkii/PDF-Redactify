import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import { buildReviewItemFromXlsxRow } from "../utils/xlsxRow";
import { applyReanchorResults } from "../utils/reanchorImport";
import { requestImportConfirmation } from "./importConfirm";
import { publishStatus } from "./statusBus";
import { getErrorMessage } from "./appError";
import type { XlsxRow } from "../types/generated/XlsxRow";
import type { RelativeBBox } from "../types/generated/RelativeBBox";

const IMPORT_FAILED_MESSAGE = "블랙마킹 정보를 가져오는 중 오류가 발생했습니다.";

/**
 * IO-02/03(§5.4, §6.6): Excel에서 블랙마킹 목록을 가져온다. 기존 목록이
 * 있으면 "수정 중인 내용은 사라집니다..." 경고 후 [확인]해야 진행한다(§6.6).
 * 좌표만으로 매칭하지 않고, 각 항목의 (페이지, 내용)으로 텍스트 레이어를
 * 재탐색해 bbox를 재앵커링한다 — 못 찾으면 `$bbox`로 폴백하고 '위치확인
 * 필요'로 표시한다(§5.4). 가져온 목록은 전체 교체이므로 undo 이력도 새로
 * 시작한다(STATE-06과 동일하게, 새 문서를 여는 것과 같은 취급).
 */
export async function importReviewItems(): Promise<void> {
  const { document, reviewItems } = useAppStore.getState();
  if (!document) return;

  if (reviewItems.length > 0) {
    const choice = await requestImportConfirmation();
    if (choice === "cancel") return;
  }

  try {
    const rows = await invoke<XlsxRow[] | null>("import_review_items");
    if (!rows) return; // 파일 선택 다이얼로그 취소

    const prelimItems = rows.map((row) => buildReviewItemFromXlsxRow(row, `i-${crypto.randomUUID()}`));
    const requests = prelimItems.map((item) => ({ page_index: item.page, content: item.content }));
    const reanchored = await invoke<Array<RelativeBBox | null>>("reanchor_review_item_bboxes", {
      path: document.path,
      requests,
    });
    const { items, positionUncertainItemIds } = applyReanchorResults(prelimItems, reanchored);

    useAppStore.getState().setReviewItems(items);
    useAppStore.getState().setHistory({ cursor: 0, entries: [] });
    useAppStore.getState().setPositionUncertainItemIds(positionUncertainItemIds);
    publishStatus("블랙마킹 정보를 성공적으로 가져왔습니다.");
  } catch (err) {
    publishStatus(getErrorMessage(err, IMPORT_FAILED_MESSAGE));
  }
}
