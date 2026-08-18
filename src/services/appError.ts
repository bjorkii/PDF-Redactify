export interface AppErrorPayload {
  code: string;
  message: string;
}

export function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

/** Rust 표준 에러(§7.1 안내 문구)면 그 메시지를, 아니면 fallback을 반환한다. */
export function getErrorMessage(err: unknown, fallback: string): string {
  return isAppErrorPayload(err) ? err.message : fallback;
}
