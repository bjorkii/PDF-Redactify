import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import { buildXlsxRow } from "../utils/xlsxRow";
import { publishStatus } from "./statusBus";
import { getErrorMessage } from "./appError";
import { requestSaveFilterConfirmation } from "./saveFilterConfirm";
import { formatMmSs, formatSizeDelta } from "../utils/operationFormat";

const SAVE_FAILED_MESSAGE = "블랙마킹 반영 저장 중 오류가 발생했습니다.";

/** UI-PROGRESS: 저장 커맨드(save_redacted_document)의 완료 요약 반환형(SaveCompletion). */
interface SaveCompletion {
  path: string;
  pageCount: number;
  elapsedMs: number;
  originalBytes: number;
  outputBytes: number;
}

/**
 * SAVE-03/05(§6.7, §8.4): 현재 블랙마킹을 반영해 저장한다. 저장 위치는
 * OS 네이티브 "다른 이름으로 저장" 다이얼로그로 사용자가 직접 고른다
 * (기본값 placeholder는 `[원본]-redacted.pdf`) — 동일한 이름이 이미
 * 있으면 조용히 덮어쓰는 대신 OS가 자체적으로 "대체하시겠습니까?"를
 * 확인한다. 저장에 성공하면 그 폴더에 `[원본]-블랙마킹목록.xlsx`도
 * 함께 생성한다(§5.1, IO-01과 같은 변환) — xlsx는 항상 원본 PDF와 같은
 * 폴더에 저장한다(사용자가 PDF를 다른 이름/폴더로 저장해도 무관). 원문은
 * 그대로 둔다. 문서가 없거나(대상 없음) 사용자가 다이얼로그를 취소하면
 * (`null`) 아무 것도 하지 않는다.
 */
export async function saveRedactedDocument(): Promise<void> {
  const { document, reviewItems, reviewListFilter } = useAppStore.getState();
  if (!document) return;

  // LIST-14: '구분' 필터로 숨긴 카테고리가 있으면, 그 항목들은 이번 저장에서
  // 제외된다. 사용자가 모르고 저장하지 않도록 경고하고, [그대로 저장]을 고르면
  // 숨겨진 카테고리를 뺀 나머지만 반영한다. (페이지 필터는 저장과 무관.)
  const categories = reviewListFilter.categories;
  const itemsToSave =
    categories === null ? reviewItems : reviewItems.filter((item) => categories.includes(item.category));
  const hasHidden = itemsToSave.length < reviewItems.length;

  if (hasHidden) {
    const choice = await requestSaveFilterConfirmation();
    if (choice === "cancel") {
      publishStatus("저장을 취소했습니다.");
      return;
    }
  }

  // UI-PROGRESS: 웹뷰 확인(필터 경고)을 모두 지난 뒤부터 처리 시작 — 이 시점에
  // busy를 켜서 중단 버튼 외 모든 조작을 차단한다. 저장 커맨드 내부의 OS 네이티브
  // 다이얼로그(경로 선택·QP-1 안내)는 별도 창이라 오버레이와 무관하게 동작한다.
  const store = useAppStore.getState();
  store.setOperationResult(null); // 직전 완료 요약이 있으면 새 작업 시작과 함께 지운다.
  store.setBusy(true);
  try {
    const saved = await invoke<SaveCompletion | null>("save_redacted_document", {
      path: document.path,
      items: itemsToSave,
    });
    if (!saved) {
      // 다이얼로그 취소 또는 저장 중 '중단'.
      publishStatus("저장을 취소했습니다.");
      return;
    }

    const rows = itemsToSave.map((item) => buildXlsxRow(item, document.filename));
    const exportedPath = await invoke<string | null>("export_review_items", { path: document.path, rows });

    // UI-PROGRESS: 완료 요약(쪽수·소요시간·용량 증감) + '열기'(PDF) 버튼을 상태바에 남긴다.
    const summary = `${saved.pageCount}쪽 | 소요시간 총 ${formatMmSs(saved.elapsedMs)} | 용량 ${formatSizeDelta(
      saved.originalBytes,
      saved.outputBytes,
    )}`;
    const base = exportedPath
      ? "블랙마킹이 적용 완료됐습니다."
      : "저장은 완료됐지만 블랙마킹 목록 내보내기를 중단했습니다.";
    store.setOperationResult({ message: `${base} | ${summary}`, openPath: saved.path });
  } catch (err) {
    publishStatus(getErrorMessage(err, SAVE_FAILED_MESSAGE));
  } finally {
    store.setBusy(false);
    store.setOperationProgress(null);
    store.setOperationStartedAt(null);
  }
}
