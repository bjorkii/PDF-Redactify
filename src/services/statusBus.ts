import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store/appStore";

// SPEC §7.1 하단 상태표시줄에 임의 이벤트(프론트 로직 또는 Rust 백엔드)를 표출하는 버스.
export const STATUS_EVENT = "status-message";

export interface StatusMessagePayload {
  message: string;
}

/** 프론트엔드 코드가 임의 이벤트를 상태바에 직접 표출할 때 사용하는 진입점. */
export function publishStatus(message: string): void {
  const store = useAppStore.getState();
  // UI-PROGRESS: 일반 상태 메시지가 뜨면 직전 완료 요약("…열기" 버튼 포함)은 물러난다.
  if (store.operationResult) store.setOperationResult(null);
  store.setStatusMessage(message);
}

/**
 * Rust 백엔드가 emit하는 상태 이벤트(STATUS_EVENT)를 구독해 상태바에 반영한다.
 * 앱 부팅 시 1회 호출하고, 반환된 unlisten 함수는 언마운트 시 정리한다.
 */
export async function subscribeBackendStatus(): Promise<() => void> {
  return listen<StatusMessagePayload>(STATUS_EVENT, (event) => {
    publishStatus(event.payload.message);
  });
}
