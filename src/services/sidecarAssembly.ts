import { useAppStore } from "../store/appStore";
import { assembleViewState } from "./viewState";
import type { SidecarDocument } from "../types/generated/SidecarDocument";

/**
 * STATE-03/06(§5.2): 현재 store 상태로부터 저장할 전체 sidecar JSON을 구성한다.
 * 문서가 열려 있지 않으면 저장할 대상이 없으므로 null. review_items는 아직
 * 이를 채우는 기능(M5 자동검출/M6/M7)이 없어 항상 빈 배열이지만, 필드 자체는
 * store의 실제 값을 그대로 담아 그 기능이 생기면 이 함수를 바꿀 필요가 없다.
 */
export function assembleSidecarDocument(): SidecarDocument | null {
  const state = useAppStore.getState();
  const document = state.document;
  if (!document) return null;

  const now = new Date().toISOString();

  return {
    schema_version: 2,
    app: "PDF-Redactify",
    source: {
      filename: document.filename,
      path: document.path,
      page_count: document.pageCount,
      text_fingerprint: document.textFingerprint,
      created_at: state.sidecarCreatedAt ?? now,
      updated_at: now,
    },
    view_state: assembleViewState(),
    page_dimensions: document.pageDimensions.map((d) => ({
      page_number: d.pageNumber,
      page_width: d.pageWidth,
      page_height: d.pageHeight,
      unit: "pt",
      text_layer_status: d.textLayerStatus,
    })),
    review_items: state.reviewItems,
    history: state.history,
    exclusion_zones: state.exclusionZones.map((z) => ({
      page_index: z.pageIndex,
      margins: z.margins,
    })),
  };
}
