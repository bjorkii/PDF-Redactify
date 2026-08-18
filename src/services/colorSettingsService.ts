import { invoke } from "@tauri-apps/api/core";
import type { RedactifySettings } from "../types/generated/RedactifySettings";
import { publishStatus } from "./statusBus";
import { getErrorMessage } from "./appError";

const COLOR_SETTINGS_ERROR_MESSAGE = "색상 설정을 저장/불러오는 중 오류가 발생했습니다.";

/** COLOR-02(§7.3, §9.4): 색상 설정을 저장한다(원문 PDF와 같은 폴더, 파일명은 폴더 고정). */
export async function saveColorSettings(path: string, settings: RedactifySettings): Promise<boolean> {
  try {
    await invoke("save_color_settings", { path, settings });
    return true;
  } catch (err) {
    publishStatus(getErrorMessage(err, COLOR_SETTINGS_ERROR_MESSAGE));
    return false;
  }
}

/** 색상 설정을 불러온다. 파일이 없으면 정상적으로 null(아직 커스터마이즈한 적 없음). */
export async function loadColorSettings(path: string): Promise<RedactifySettings | null> {
  try {
    return await invoke<RedactifySettings | null>("load_color_settings", { path });
  } catch (err) {
    publishStatus(getErrorMessage(err, COLOR_SETTINGS_ERROR_MESSAGE));
    return null;
  }
}

/**
 * COLOR-02 전역 기본값: 문서/폴더 단위 저장(§9.4)과 별개로, 아직 문서를
 * 하나도 안 연 상태에서도 마지막으로 쓰던 색이 곧바로 반영되도록 OS 앱
 * 설정 폴더에 저장한다. App.tsx(부팅 시 로드)·colorSettingsSync.ts(변경 시
 * 저장)가 사용한다.
 */
export async function saveGlobalColorSettings(settings: RedactifySettings): Promise<boolean> {
  try {
    await invoke("save_global_color_settings", { settings });
    return true;
  } catch (err) {
    publishStatus(getErrorMessage(err, COLOR_SETTINGS_ERROR_MESSAGE));
    return false;
  }
}

/** 전역 기본값을 불러온다. 파일이 없으면 정상적으로 null(아직 저장한 적 없음). */
export async function loadGlobalColorSettings(): Promise<RedactifySettings | null> {
  try {
    return await invoke<RedactifySettings | null>("load_global_color_settings");
  } catch (err) {
    publishStatus(getErrorMessage(err, COLOR_SETTINGS_ERROR_MESSAGE));
    return null;
  }
}
