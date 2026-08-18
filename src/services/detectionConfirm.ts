import { useAppStore } from "../store/appStore";

/** DET-05: 기존 블랙마킹 목록을 덮어쓰는 자동검출 확인 다이얼로그의 두 선택지. */
export type DetectionConfirmChoice = "run" | "cancel";

let pendingResolve: ((choice: DetectionConfirmChoice) => void) | null = null;

/**
 * "현재의 민감정보 검출목록이 모두 사라집니다. 계속하시겠습니까?" 다이얼로그를
 * 열고 사용자가 [실행]/[취소] 중 하나를 고를 때까지 기다린다.
 */
export function requestDetectionConfirmation(): Promise<DetectionConfirmChoice> {
  return new Promise((resolve) => {
    pendingResolve = resolve;
    useAppStore.getState().setDetectionConfirmDialogOpen(true);
  });
}

function resolveWith(choice: DetectionConfirmChoice): void {
  useAppStore.getState().setDetectionConfirmDialogOpen(false);
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(choice);
}

export function confirmDetection(): void {
  resolveWith("run");
}

export function cancelDetectionConfirm(): void {
  resolveWith("cancel");
}
