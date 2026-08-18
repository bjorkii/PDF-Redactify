import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import type { ReviewItem } from "../types/generated/ReviewItem";
import { publishStatus } from "./statusBus";
import { getErrorMessage } from "./appError";
import { hasAnyText } from "../utils/textLayer";
import { requestDetectionConfirmation } from "./detectionConfirm";
import { excludeDetectedOverlappingUserItems } from "../utils/reviewItemMerge";
import { goToPage } from "./pdfService";

const DETECTION_FAILED_MESSAGE = "자동검출 중 오류가 발생했습니다.";
/** DET-06(§6.3.4/§7.1): 검출 버튼을 눌렀지만 텍스트 레이어가 전혀 없을 때의 알림. */
const NO_TEXT_LAYER_DETECT_MESSAGE =
  "이 파일에는 검출 가능한 텍스트 정보가 없으므로 자동검출은 실시할 수 없습니다.";

/**
 * DET-05(§6.3.1): 현재 문서에 자동검출을 실행한다. 진행 중에는 백엔드가
 * 상태바에 "민감정보를 검출하는 중입니다… (n%)"를 페이지마다 알린다(§7.1).
 * DET-06: 텍스트 레이어가 전혀 없는 문서는 애초에 검출을 시작하지 않는다.
 *
 * 사용자가 직접 만든/가져온 항목(origin: manual/imported — 가져오기는
 * 사용자 추가와 동일 취급, RedactionOverlay.tsx 기존 관례)은 재검출해도
 * 사라지지 않고 그대로 남는다(사용자 요청 — 예전엔 목록 전체를 새 검출
 * 결과로 통째로 덮어써서 수동으로 추가·수정해둔 항목까지 없어졌다).
 * 기존 자동검출(origin: detected) 항목만 새 결과로 교체되고, 그중 사용자
 * 항목과 같은 페이지에서 실제로 겹치는 후보는 중복으로 보고 제외한다
 * (excludeDetectedOverlappingUserItems). 사라질 자동검출 항목이 있을
 * 때만(사용자 항목만 있으면 아무 것도 안 사라지므로) 실행 전 확인을 받는다.
 */
export async function runDetection(): Promise<void> {
  const document = useAppStore.getState().document;
  if (!document) return;

  if (!hasAnyText(document)) {
    publishStatus(NO_TEXT_LAYER_DETECT_MESSAGE);
    return;
  }

  const hasExistingDetectedItems = useAppStore
    .getState()
    .reviewItems.some((item) => item.origin === "detected");
  if (hasExistingDetectedItems) {
    const choice = await requestDetectionConfirmation();
    if (choice === "cancel") return;
  }

  useAppStore.getState().setDetectionInProgress(true);
  try {
    // DET-07: 사용자가 설정한 페이지별 탐지 제외 영역(헤더/푸터 등)도 함께
    // 넘겨, 그 영역의 문자는 애초에 검출 대상에서 빠지게 한다. Tauri는
    // invoke의 최상위 파라미터 이름(exclusionZones → exclusion_zones)만
    // camelCase↔snake_case로 자동 변환하고, 그 안의 필드는 Rust
    // PageExclusionZone 구조체의 이름(page_index) 그대로 맞춰야 한다
    // (sidecarAssembly.ts의 동일 매핑 참고) — camelCase로 보내면 Rust 쪽에서
    // page_index가 항상 0으로 역직렬화돼, 설정한 제외영역이 실제 검출에는
    // 반영되지 않는 채로 조용히 무시됐었다.
    const exclusionZones = useAppStore.getState().exclusionZones.map((z) => ({
      page_index: z.pageIndex,
      margins: z.margins,
    }));
    const detectedAll = await invoke<ReviewItem[]>("detect_review_items", { path: document.path, exclusionZones });

    // DET-OPT: 자동검출 옵션에서 제외한 카테고리는 결과에서 뺀다(전역 설정).
    const excluded = useAppStore.getState().excludedDetectionCategories;
    const detected =
      excluded.length === 0 ? detectedAll : detectedAll.filter((item) => !excluded.includes(item.category));

    const userItems = useAppStore.getState().reviewItems.filter((item) => item.origin !== "detected");
    const newDetectedItems = excludeDetectedOverlappingUserItems(detected, userItems);
    const items = [...userItems, ...newDetectedItems];

    useAppStore.getState().setReviewItems(items);
    publishStatus(`민감정보 검출이 완료되었습니다. ${newDetectedItems.length}건 검출됨.`);

    // 검출된 항목이 현재 보고 있는 페이지에 하나도 없으면(표지 등 항목이
    // 없는 페이지에서 검출을 실행한 경우 흔함) bbox가 화면 어디에도 안
    // 보여 "검출됐는데 안 보인다"고 느껴질 수 있다 — 항목이 있는 첫
    // 페이지로 바로 이동해 결과를 곧장 확인할 수 있게 한다.
    const currentPageIndex = useAppStore.getState().currentPageIndex;
    if (newDetectedItems.length > 0 && !newDetectedItems.some((item) => item.page === currentPageIndex)) {
      const firstItemPage = Math.min(...newDetectedItems.map((item) => item.page));
      void goToPage(firstItemPage);
    }
  } catch (err) {
    const message = getErrorMessage(err, DETECTION_FAILED_MESSAGE);
    publishStatus(message);
  } finally {
    useAppStore.getState().setDetectionInProgress(false);
  }
}

/** 실행 중인 자동검출에 취소를 요청한다(§6.3.1 대용량 문서 취소). */
export async function cancelDetection(): Promise<void> {
  await invoke("cancel_detection");
}
