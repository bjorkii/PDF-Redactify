import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import type { OperationKind } from "../store/appStore";

// UI-PROGRESS: 저장(SAVE-03)/내보내기(IO-01) 진행률·중단 이벤트 버스. 백엔드
// (commands/save.rs·commands/xlsx.rs)가 페이지/행 루프에서 emit하는 진행률을
// 구독해 상태바의 progress bar + %에 반영하고, 중단 버튼은 cancel_operation을 부른다.
export const PROGRESS_EVENT = "operation-progress";

export interface OperationProgressPayload {
  kind: OperationKind;
  processed: number;
  total: number;
  /** false면 작업 종료(완료·취소·오류) → 바를 숨긴다. */
  active: boolean;
}

/**
 * 백엔드 진행률 이벤트(PROGRESS_EVENT)를 구독해 store에 반영한다. 앱 부팅 시 1회
 * 호출하고, 반환된 unlisten은 언마운트 시 정리한다(statusBus와 동일 수명 패턴).
 */
export async function subscribeOperationProgress(): Promise<() => void> {
  return listen<OperationProgressPayload>(PROGRESS_EVENT, (event) => {
    const { kind, processed, total, active } = event.payload;
    const store = useAppStore.getState();
    if (active) {
      // 이 작업(또는 단계)의 첫 진행 이벤트에서 시작 시각을 기록한다(남은 시간 추정 기준).
      if (store.operationStartedAt == null) store.setOperationStartedAt(Date.now());
      store.setOperationProgress({ kind, processed, total });
    } else {
      // 종료(완료·취소·오류) → 바·시작시각 초기화(다음 단계가 새로 시작 시각을 잡는다).
      store.setOperationProgress(null);
      store.setOperationStartedAt(null);
    }
  });
}

/** 진행 중인 저장/내보내기에 중단을 요청한다(UI-PROGRESS 중단 버튼). */
export async function cancelOperation(): Promise<void> {
  await invoke("cancel_operation");
}

/**
 * UI-PROGRESS '열기': 방금 만든 결과 파일(PDF/xlsx)을 시스템 연결 앱으로 연다.
 * opener 플러그인 JS(openPath)는 경로 스코프를 요구해 조용히 실패하므로, 스코프 검사
 * 없는 전용 커맨드(open_path_external)로 연다.
 */
export async function openResultFile(path: string): Promise<void> {
  await invoke("open_path_external", { path });
}
