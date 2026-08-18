import { invoke } from "@tauri-apps/api/core";
import type { SidecarDocument } from "../types/generated/SidecarDocument";
import { publishStatus } from "./statusBus";
import { getErrorMessage } from "./appError";

const SIDECAR_ERROR_MESSAGE = "블랙마킹 정보를 저장/불러오는 중 오류가 발생했습니다.";

/**
 * STATE-02: sidecar를 저장한다(§5.1 `[원본].redactify.json`, §9.4 원문과 같은 폴더).
 * 언제 저장을 트리거할지(자동저장 디바운스 등)는 STATE-03의 몫이다.
 */
export async function saveSidecar(path: string, document: SidecarDocument): Promise<boolean> {
  try {
    await invoke("save_sidecar", { path, document });
    return true;
  } catch (err) {
    publishStatus(getErrorMessage(err, SIDECAR_ERROR_MESSAGE));
    return false;
  }
}

/**
 * sidecar를 불러온다. 파일이 없으면 정상적으로 null(최초 실행 등, 에러 아님).
 * 언제 복원할지(구동 시 view_state 반영 등)는 STATE-04의 몫이다.
 */
export async function loadSidecar(path: string): Promise<SidecarDocument | null> {
  try {
    return await invoke<SidecarDocument | null>("load_sidecar", { path });
  } catch (err) {
    publishStatus(getErrorMessage(err, SIDECAR_ERROR_MESSAGE));
    return null;
  }
}
