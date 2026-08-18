import { useAppStore } from "../store/appStore";

/** LIST-14: 구분 필터로 일부 검출항목이 숨겨진 채 저장하려 할 때의 두 선택지. */
export type SaveFilterChoice = "save" | "cancel";

let pendingResolve: ((choice: SaveFilterChoice) => void) | null = null;

/**
 * "일부 검출항목이 숨겨진 상태입니다." 경고를 열고 [그대로 저장]/[취소] 중
 * 하나를 고를 때까지 기다린다. requestDetectionConfirmation과 동일한 패턴.
 */
export function requestSaveFilterConfirmation(): Promise<SaveFilterChoice> {
  return new Promise((resolve) => {
    pendingResolve = resolve;
    useAppStore.getState().setSaveFilterWarningDialogOpen(true);
  });
}

function resolveWith(choice: SaveFilterChoice): void {
  useAppStore.getState().setSaveFilterWarningDialogOpen(false);
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(choice);
}

export function confirmSaveWithFilter(): void {
  resolveWith("save");
}

export function cancelSaveWithFilter(): void {
  resolveWith("cancel");
}
