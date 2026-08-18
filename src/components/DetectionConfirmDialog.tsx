import { useAppStore } from "../store/appStore";
import { confirmDetection, cancelDetectionConfirm } from "../services/detectionConfirm";
import "./DetectionConfirmDialog.css";

// DET-05: 이미 자동검출된(origin: detected) 항목이 있는 상태에서 다시
// 실행하면 그 항목들만 새 결과로 교체된다(사용자 지정/가져온 항목은 그대로
// 유지 — detectionService.ts) — 그래도 자동검출 항목 자체는 사라지므로
// 실행 전 경고한다.
export function DetectionConfirmDialog() {
  const open = useAppStore((s) => s.detectionConfirmDialogOpen);
  if (!open) return null;

  return (
    <div className="detection-confirm-backdrop">
      <div className="detection-confirm-dialog" role="alertdialog" aria-modal="true">
        <p className="detection-confirm-message">
          사용자 지정 항목을 제외한 현재의 민감정보 자동검출 목록이 모두 사라집니다. 계속하시겠습니까?
        </p>
        <div className="detection-confirm-actions">
          <button type="button" onClick={confirmDetection}>
            실행
          </button>
          <button type="button" onClick={cancelDetectionConfirm}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
