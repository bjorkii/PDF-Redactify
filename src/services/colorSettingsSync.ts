import { useAppStore } from "../store/appStore";
import { saveColorSettings, saveGlobalColorSettings } from "./colorSettingsService";

/** 색상 피커 조작은 STATE-03의 자동저장보다 드물게 일어나므로 짧은 디바운스면 충분하다. */
export const COLOR_SETTINGS_DEBOUNCE_MS = 400;

/**
 * COLOR-02(§7.3, §9.4): colorSettings가 바뀔 때마다 디바운스 후 파일로
 * 저장한다("설정 변경 즉시 반영·재구동 후 유지"). 앱 전역 기본값(문서
 * 없이도 곧바로 반영되게, colorSettingsService.ts 참고)은 문서 유무와
 * 무관하게 항상 저장하고, 문서/폴더 단위 설정(§9.4)은 문서가 열려 있을
 * 때만 추가로 저장한다. 앱 부팅 시 한 번만 호출한다.
 */
export function startColorSettingsSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let previous = useAppStore.getState().colorSettings;

  const unsubscribe = useAppStore.subscribe((state) => {
    if (state.colorSettings === previous) return;
    previous = state.colorSettings;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const { document, colorSettings } = useAppStore.getState();
      void saveGlobalColorSettings(colorSettings);
      if (document) void saveColorSettings(document.path, colorSettings);
    }, COLOR_SETTINGS_DEBOUNCE_MS);
  });

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
