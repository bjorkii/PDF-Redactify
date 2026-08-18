import { useAppStore } from "../store/appStore";
import { confirmImport, cancelImport } from "../services/importConfirm";
import "./ImportConfirmDialog.css";

// IO-02(§6.6): 기존 목록이 있을 때 가져오기 전 경고. 스펙 문구를 그대로 쓴다.
export function ImportConfirmDialog() {
  const open = useAppStore((s) => s.importConfirmDialogOpen);
  if (!open) return null;

  return (
    <div className="import-confirm-backdrop">
      <div className="import-confirm-dialog" role="alertdialog" aria-modal="true">
        <p className="import-confirm-message">
          수정 중인 내용은 사라집니다. 정말 가져오시겠습니까?
        </p>
        <div className="import-confirm-actions">
          <button type="button" onClick={confirmImport}>
            확인
          </button>
          <button type="button" onClick={cancelImport}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
