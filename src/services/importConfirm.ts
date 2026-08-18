import { useAppStore } from "../store/appStore";

/** IO-02(§6.6): 가져오기 경고 다이얼로그의 두 선택지. */
export type ImportConfirmChoice = "confirm" | "cancel";

let pendingResolve: ((choice: ImportConfirmChoice) => void) | null = null;

/**
 * "수정 중인 내용은 사라집니다. 정말 가져오시겠습니까?" 다이얼로그를 열고
 * 사용자가 [확인]/[취소] 중 하나를 고를 때까지 기다린다.
 */
export function requestImportConfirmation(): Promise<ImportConfirmChoice> {
  return new Promise((resolve) => {
    pendingResolve = resolve;
    useAppStore.getState().setImportConfirmDialogOpen(true);
  });
}

function resolveWith(choice: ImportConfirmChoice): void {
  useAppStore.getState().setImportConfirmDialogOpen(false);
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(choice);
}

export function confirmImport(): void {
  resolveWith("confirm");
}

export function cancelImport(): void {
  resolveWith("cancel");
}
