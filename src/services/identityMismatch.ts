import { useAppStore } from "../store/appStore";

/** STATE-05(§4.4): 불일치 다이얼로그의 세 선택지. */
export type IdentityMismatchChoice = "openAnyway" | "redetect" | "cancel";

let pendingResolve: ((choice: IdentityMismatchChoice) => void) | null = null;

/**
 * 불일치 다이얼로그를 열고, 사용자가 [무시하고 열기]/[재검출]/[취소] 중 하나를
 * 고를 때까지 기다린다. pdfService가 이 Promise를 await해 다음 동작을 분기한다.
 */
export function requestIdentityMismatchDecision(): Promise<IdentityMismatchChoice> {
  return new Promise((resolve) => {
    pendingResolve = resolve;
    useAppStore.getState().setIdentityMismatchDialogOpen(true);
  });
}

function resolveWith(choice: IdentityMismatchChoice): void {
  useAppStore.getState().setIdentityMismatchDialogOpen(false);
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(choice);
}

export function chooseOpenAnyway(): void {
  resolveWith("openAnyway");
}

export function chooseRedetect(): void {
  resolveWith("redetect");
}

export function chooseCancel(): void {
  resolveWith("cancel");
}
