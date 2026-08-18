import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import { ko } from "../i18n/ko";
import { cancelDetection } from "../services/detectionService";
import { cancelOperation, openResultFile } from "../services/progressBus";
import { publishStatus } from "../services/statusBus";
import { getErrorMessage } from "../services/appError";
import { estimateRemainingMs, formatMmSs } from "../utils/operationFormat";
import "./StatusBar.css";

/** '열기' 클릭 — 결과 파일을 열고, 실패하면 상태바에 이유를 표시(조용히 삼키지 않음). */
function openResult(path: string): void {
  void openResultFile(path).catch((err) => publishStatus(getErrorMessage(err, "파일을 열 수 없습니다.")));
}

// SPEC §7.1 하단 상태표시줄.
// DET-05: 자동검출 중에는 취소 버튼을 함께 보여준다(§6.3.1 대용량 문서 대비).
// UI-PROGRESS: 저장(SAVE-03)/내보내기(IO-01) 중에는 진행률 바 + 예상 잔여시간 + % + 중단,
// 완료 후에는 요약 메시지 + '열기' 버튼(시스템 연결 앱으로 결과 파일 열기)을 보여준다.
export function StatusBar() {
  const statusMessage = useAppStore((s) => s.statusMessage);
  const detectionInProgress = useAppStore((s) => s.detectionInProgress);
  const operationProgress = useAppStore((s) => s.operationProgress);
  const operationStartedAt = useAppStore((s) => s.operationStartedAt);
  const operationResult = useAppStore((s) => s.operationResult);

  // 진행 중에는 1초마다 리렌더해 예상 잔여시간(경과 기반 추정)을 갱신한다.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!operationProgress) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [operationProgress]);

  const percent =
    operationProgress == null
      ? 0
      : operationProgress.total === 0
        ? 100
        : Math.min(100, Math.round((operationProgress.processed * 100) / operationProgress.total));

  const remainingMs =
    operationProgress && operationStartedAt != null
      ? estimateRemainingMs(Date.now() - operationStartedAt, operationProgress.processed, operationProgress.total)
      : null;
  const remainingText = remainingMs == null ? ko.statusBar.calculating : formatMmSs(remainingMs);

  return (
    <div className="status-bar" role="status">
      {operationProgress ? (
        // 진행 중: 예상 잔여시간 + 진행률 바 + %.
        <div className="status-bar-progress">
          <span className="status-bar-progress-label">
            {ko.statusBar.remainingTime} {remainingText}
          </span>
          <div
            className="status-bar-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="status-bar-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="status-bar-progress-percent">{percent}%</span>
        </div>
      ) : operationResult ? (
        <span className="status-bar-message">{operationResult.message}</span>
      ) : (
        <span className="status-bar-message">{statusMessage || ko.statusBar.ready}</span>
      )}

      {operationProgress ? (
        // 중단 — 진행 중 작업(저장/내보내기)을 취소한다.
        <button type="button" className="status-bar-cancel" onClick={() => void cancelOperation()}>
          {ko.statusBar.cancelOperation}
        </button>
      ) : operationResult ? (
        // 열기 — 방금 만든 결과 파일(PDF/xlsx)을 시스템 연결 앱으로 연다.
        <button
          type="button"
          className="status-bar-cancel"
          onClick={() => openResult(operationResult.openPath)}
        >
          {ko.statusBar.open}
        </button>
      ) : (
        detectionInProgress && (
          <button type="button" className="status-bar-cancel" onClick={() => void cancelDetection()}>
            {ko.statusBar.cancelDetection}
          </button>
        )
      )}
    </div>
  );
}
