import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";

/**
 * DET-OPT: 자동검출에서 제외할 카테고리 목록의 전역 영속화. 색상 전역설정과 같은
 * OS 앱 설정 폴더에 저장돼, 다음 앱 실행에도 그대로 적용된다.
 */

/** 앱 시작 시 저장된 제외 목록을 불러와 store에 반영한다(없으면 전체 검출). */
export async function loadDetectionCategories(): Promise<void> {
  try {
    const excluded = await invoke<string[] | null>("load_detection_categories");
    if (excluded) useAppStore.getState().setExcludedDetectionCategories(excluded);
  } catch {
    // 로드 실패는 조용히 무시(전체 검출 기본값 유지).
  }
}

/** 제외 목록을 store에 반영하고 전역 파일에도 저장한다. */
export async function saveDetectionCategories(excluded: string[]): Promise<void> {
  useAppStore.getState().setExcludedDetectionCategories(excluded);
  try {
    await invoke("save_detection_categories", { excluded });
  } catch {
    // 저장 실패해도 세션 내 선택은 유지된다.
  }
}
