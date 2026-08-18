import { useAppStore } from "../store/appStore";
import { chooseCancel, chooseOpenAnyway, chooseRedetect } from "../services/identityMismatch";
import "./IdentityMismatchDialog.css";

// STATE-05(§4.4): sidecar와 현재 PDF가 불일치할 때 뜨는 경고 다이얼로그.
// [무시하고 열기]는 정식 워크플로(동일 내용의 다른 버전 교차 적용)이지 오류가 아니다.
export function IdentityMismatchDialog() {
  const open = useAppStore((s) => s.identityMismatchDialogOpen);
  if (!open) return null;

  return (
    <div className="identity-mismatch-backdrop">
      <div className="identity-mismatch-dialog" role="alertdialog" aria-modal="true">
        <p className="identity-mismatch-message">
          저장된 블랙마킹 정보(sidecar)가 현재 PDF 내용과 일치하지 않습니다.
        </p>
        <p className="identity-mismatch-detail">
          같은 내용의 다른 버전(예: OCR 텍스트 삭제본)이라면 [무시하고 열기]를 선택해 목록을 그대로
          가져올 수 있습니다.
        </p>
        <div className="identity-mismatch-actions">
          <button type="button" onClick={chooseOpenAnyway}>
            무시하고 열기
          </button>
          <button type="button" onClick={chooseRedetect}>
            재검출
          </button>
          <button type="button" onClick={chooseCancel}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
