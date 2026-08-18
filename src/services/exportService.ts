import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import { buildXlsxRow } from "../utils/xlsxRow";
import { publishStatus } from "./statusBus";
import { getErrorMessage } from "./appError";

const EXPORT_FAILED_MESSAGE = "블랙마킹 정보를 내보내는 중 오류가 발생했습니다.";

/**
 * IO-01(§5.4, §6.6): 현재 목록을 Excel로 내보낸다(`[원본파일명]-블랙마킹목록.xlsx`,
 * 원문과 같은 폴더). 문서가 없으면 내보낼 대상이 없으므로 아무 것도 하지 않는다.
 */
export async function exportReviewItems(): Promise<void> {
  const store = useAppStore.getState();
  const { document, reviewItems } = store;
  if (!document) return;

  // UI-PROGRESS: 내보내기 처리 중 전역 잠금 + 진행률 바/중단 버튼.
  store.setOperationResult(null);
  store.setBusy(true);
  try {
    const rows = reviewItems.map((item) => buildXlsxRow(item, document.filename));
    const exportedPath = await invoke<string | null>("export_review_items", { path: document.path, rows });
    if (!exportedPath) {
      publishStatus("내보내기를 중단했습니다.");
      return;
    }
    // UI-PROGRESS: 완료 후 상태바에 파일명 + '열기'(xlsx) 버튼을 남긴다.
    const filename = exportedPath.split(/[\\/]/).pop() ?? exportedPath;
    store.setOperationResult({
      message: `블랙마킹 정보를 성공적으로 내보냈습니다. | ${filename}`,
      openPath: exportedPath,
    });
  } catch (err) {
    publishStatus(getErrorMessage(err, EXPORT_FAILED_MESSAGE));
  } finally {
    store.setBusy(false);
    store.setOperationProgress(null);
    store.setOperationStartedAt(null);
  }
}
