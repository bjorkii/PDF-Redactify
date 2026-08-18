import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../store/appStore";

const APP_NAME = "PDF-Redactify";

/**
 * UI-01(§7.1): "[앱 이름 및 버전] - [현재 열린 PDF 파일명]" 형식. 문서가
 * 없으면 파일명 부분을 생략한다. 창이 좁아 잘릴 때의 '…' + 툴팁은 OS
 * 네이티브 타이틀바가 그리는 영역이라 앱에서 커스터마이즈할 수 없고,
 * 각 OS가 자체 방식대로 처리한다.
 */
export function buildWindowTitle(version: string, filename: string | null): string {
  const base = `${APP_NAME} v${version}`;
  return filename ? `${base} - ${filename}` : base;
}

let cachedVersion: string | null = null;

async function resolveVersion(): Promise<string> {
  if (!cachedVersion) cachedVersion = await getVersion();
  return cachedVersion;
}

async function applyWindowTitle(filename: string | null): Promise<void> {
  const version = await resolveVersion();
  await getCurrentWindow().setTitle(buildWindowTitle(version, filename));
}

/**
 * UI-01: store의 document(파일명)가 바뀔 때마다 OS 창 제목을 갱신한다.
 * 앱 부팅 시 한 번 호출하고, 반환된 함수로 구독을 해제한다.
 */
export function startWindowTitleSync(): () => void {
  let previousFilename = useAppStore.getState().document?.filename ?? null;
  void applyWindowTitle(previousFilename);

  return useAppStore.subscribe((state) => {
    const filename = state.document?.filename ?? null;
    if (filename === previousFilename) return;
    previousFilename = filename;
    void applyWindowTitle(filename);
  });
}
