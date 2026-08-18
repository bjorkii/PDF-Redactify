import { useAppStore } from "../store/appStore";
import { confirmSaveWithFilter, cancelSaveWithFilter } from "../services/saveFilterConfirm";
import "./DetectionConfirmDialog.css";

/**
 * LIST-14: '구분' 필터로 일부 검출항목이 숨겨진 상태에서 저장하려 하면 경고한다.
 * [그대로 저장]은 숨겨진 카테고리를 제외하고 블랙마킹을 적용한다(사용자 요청).
 * 스타일은 DetectionConfirmDialog와 공유한다.
 */
export function SaveFilterWarningDialog() {
  const open = useAppStore((s) => s.saveFilterWarningDialogOpen);
  if (!open) return null;

  return (
    <div className="detection-confirm-backdrop">
      <div className="detection-confirm-dialog" role="alertdialog" aria-modal="true">
        <p className="detection-confirm-message">
          일부 검출항목이 숨겨진 상태입니다. 숨겨진 항목을 제외하고 블랙마킹을 적용할까요?
        </p>
        <div className="detection-confirm-actions">
          <button type="button" onClick={confirmSaveWithFilter}>
            그대로 저장
          </button>
          <button type="button" onClick={cancelSaveWithFilter}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
