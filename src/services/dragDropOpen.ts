import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useAppStore } from "../store/appStore";
import { pickPdfPath } from "../utils/pdfDropPaths";
import { openPdfFromPath } from "./pdfService";
import { publishStatus } from "./statusBus";

const NOT_A_PDF_MESSAGE = "PDF 파일만 열 수 있습니다.";

/**
 * UX 편의: 앱 창 위로 파일을 드래그 앤 드롭하면 다이얼로그 없이 바로 연다
 * (스펙 명시 항목은 아니지만 데스크톱 앱의 일반적인 기대 동작). Tauri는
 * 기본적으로 OS 레벨 드래그 앤 드롭을 웹뷰가 가로채므로(dragDropEnabled),
 * HTML5 drop 이벤트가 아니라 onDragDropEvent를 써야 한다. 여러 파일을
 * 놓으면 그중 첫 PDF만 연다. 앱 부팅 시 한 번 호출하고, 반환된 함수로
 * 구독을 해제한다.
 */
export function startDragDropOpen(): () => void {
  let unlisten: (() => void) | undefined;
  let cancelled = false;

  getCurrentWebview()
    .onDragDropEvent((event) => {
      const { setDragOverActive, busy } = useAppStore.getState();

      // UI-PROGRESS: 저장/내보내기 처리 중에는 파일 드롭 열기도 막는다(OS 레벨
      // 드롭이라 busy 오버레이가 못 잡으므로 여기서 직접 게이트). 진행 오버레이만
      // 내리고 아무 것도 열지 않는다.
      if (busy) {
        if (event.payload.type === "leave" || event.payload.type === "drop") {
          setDragOverActive(false);
        }
        return;
      }

      // 파일 드래그(payload.paths가 있음)일 때만 오버레이를 켠다. 뷰포트 안에서
      // 시작한 내부 드래그(PDF 이미지·텍스트 드래그 등)도 OS 드래그로 잡혀
      // enter/over가 오는데, 이때는 paths가 비어 있으므로 무시한다(사용자 요청:
      // "drag 시작 지점이 뷰포트 내면 파일 열기 모드로 진입하지 않도록"). over는
      // paths를 싣지 않으므로 enter에서만 판정하고, over에서는 상태를 바꾸지 않는다.
      if (event.payload.type === "enter") {
        if (event.payload.paths.length > 0) setDragOverActive(true);
        return;
      }

      if (event.payload.type === "over") {
        return;
      }

      if (event.payload.type === "leave") {
        setDragOverActive(false);
        return;
      }

      // type === "drop"
      setDragOverActive(false);
      const path = pickPdfPath(event.payload.paths);
      if (!path) {
        publishStatus(NOT_A_PDF_MESSAGE);
        return;
      }
      void openPdfFromPath(path);
    })
    .then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}
