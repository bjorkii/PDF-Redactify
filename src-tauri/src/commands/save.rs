//! SAVE-01(§4.3, §6.7): 블랙마킹 반영 저장 command.

use crate::commands::operation::OperationCancelToken;
use crate::error::{AppError, AppResult};
use crate::save;
use crate::sidecar::ReviewItem;
use crate::status::{emit_progress, OperationKind};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const SAVE_FAILED_MESSAGE: &str = "블랙마킹 반영 저장 중 오류가 발생했습니다.";

/// UI-PROGRESS: 저장 완료 요약 — 프론트 상태바가 "…쪽 | 소요시간 | 용량 증가" 문구와
/// '열기' 버튼(path)을 그리는 데 쓴다. 소요시간은 페이지 루프 처리 시간만(다이얼로그
/// 제외), 용량은 원본/결과 파일 크기.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCompletion {
    pub path: String,
    pub page_count: u32,
    pub elapsed_ms: u64,
    pub original_bytes: u64,
    pub output_bytes: u64,
}

/// §4.3 "블랙마킹" 반영 색 — 뷰어 미리보기 색(COLOR-*)과는 별개로, 결과물에
/// 실제로 칠하는 색은 고정된 검정이다. 스펙에 이를 위한 설정 항목이 없다.
const REDACTION_FILL_COLOR: &str = "#000000";

/// 다이얼로그 없이 지정한 출력 경로로 실제 저장을 수행하는 순수 로직 —
/// 커맨드(다이얼로그로 경로를 얻은 뒤)와 테스트(경로를 직접 지정) 둘 다
/// 이 함수를 공유한다. `open_pdf_from_path`(commands/pdf.rs)와 동일한
/// "다이얼로그 표시는 커맨드에서만, 실제 로직은 별도 테스트 가능 함수로"
/// 분리 패턴 — 다이얼로그를 띄우는 커맨드 자체는 mock 웹뷰(tauri::test)로
/// IPC 왕복 테스트를 할 수 없어(실제 OS 다이얼로그가 없음), 그 커맨드는
/// 테스트 대상에서 제외하고 이 함수만 테스트한다. (UI-PROGRESS 이후 커맨드는
/// 진행률/중단 콜백을 직접 넘기므로, 이 순수 래퍼는 테스트에서만 쓴다.)
#[cfg(test)]
fn save_redacted_document_to_path(
    pdf_path: &Path,
    output_path: &Path,
    items: &[ReviewItem],
) -> AppResult<String> {
    save::save_redacted_document_to(pdf_path, output_path, items, REDACTION_FILL_COLOR)
        .map(|_| output_path.to_string_lossy().into_owned())
        .map_err(|_| AppError::new("SAVE_FAILED", SAVE_FAILED_MESSAGE))
}

/// SAVE-05: 동일한 이름의 결과 파일이 이미 있을 때 조용히 덮어쓰던 것 대신,
/// OS 네이티브 "다른 이름으로 저장" 다이얼로그를 띄운다 — 기본 파일명은
/// 여전히 `[원본파일명]-redacted.pdf`(placeholder로 채워짐, 수정 가능)이고,
/// 같은 이름을 그대로 두고 저장을 누르면 OS가 자체적으로 "대체하시겠습니까?"
/// 확인을 담당한다(파일 열기 다이얼로그와 동일한 tauri-plugin-dialog 경로,
/// commands/pdf.rs의 open_pdf 참고). 사용자가 다이얼로그를 취소하면
/// `Ok(None)` — 아무 것도 저장하지 않는다.
#[tauri::command]
pub async fn save_redacted_document<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    items: Vec<ReviewItem>,
    cancel_token: State<'_, OperationCancelToken>,
) -> AppResult<Option<SaveCompletion>> {
    let pdf_path = Path::new(&path);
    let default_path = save::redacted_path_for(pdf_path);
    let default_name = default_path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();

    let mut dialog = app.dialog().file().add_filter("PDF", &["pdf"]).set_file_name(default_name);
    if let Some(dir) = default_path.parent() {
        dialog = dialog.set_directory(dir);
    }

    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };

    let output_path = picked.into_path().map_err(|err| {
        AppError::new("SAVE_FAILED", format!("저장 경로를 확인할 수 없습니다: {err}"))
    })?;

    // QP-1: 저장 직전, 이 시스템의 가용 메모리로 다운샘플될 페이지가 있으면 실제
    // 계산값으로 안내하고 [계속]/[취소]를 받는다. 취소하면 아무 것도 저장하지 않는다.
    // 원본이 예산 이내면(대부분의 경우) plan이 None이라 팝업 없이 그대로 진행한다.
    if let Some(notice) = save::plan_rasterization_downsample(pdf_path, &items).ok().flatten() {
        let message = format!(
            "원본은 {}×{}px({}dpi)이나, 이 시스템의 가용 메모리 부족으로 \
             {}×{}px({}dpi)로 다운샘플링하여 저장됩니다.\n계속하시겠습니까?",
            notice.original_width,
            notice.original_height,
            notice.original_dpi,
            notice.downsampled_width,
            notice.downsampled_height,
            notice.downsampled_dpi,
        );
        let proceed = app
            .dialog()
            .message(message)
            .title("메모리 부족 — 해상도 조정 안내")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("계속".into(), "취소".into()))
            .blocking_show();
        if !proceed {
            return Ok(None);
        }
    }

    // UI-PROGRESS: 페이지 루프에 진행률/중단을 건다. 시작 시 이전 중단 신호를 지우고,
    // 페이지마다 진행률 이벤트를 상태바로 보낸다. 중단(cancel_operation) 시 결과 파일을
    // 만들지 않고 Ok(None)으로 빠진다(다이얼로그 취소와 동일 취급 — 프론트가 "취소" 표시).
    cancel_token.reset();
    let flag = cancel_token.flag();
    let app_for_progress = app.clone();
    let start = std::time::Instant::now();
    let result = save::save_redacted_document_to_with_progress(
        pdf_path,
        &output_path,
        &items,
        REDACTION_FILL_COLOR,
        |processed, total| {
            let _ = emit_progress(&app_for_progress, OperationKind::Save, processed, total, true);
        },
        move || flag.load(Ordering::SeqCst),
    );
    // 완료·취소·오류 어느 경우든 바를 내린다.
    let _ = emit_progress(&app, OperationKind::Save, 0, 0, false);

    match result {
        Ok(Some(page_count)) => {
            // 완료 요약: 소요시간(루프 처리분)·원본/결과 용량. 크기 조회 실패는 0으로 폴백.
            let elapsed_ms = start.elapsed().as_millis() as u64;
            let original_bytes = std::fs::metadata(pdf_path).map(|m| m.len()).unwrap_or(0);
            let output_bytes = std::fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);
            Ok(Some(SaveCompletion {
                path: output_path.to_string_lossy().into_owned(),
                page_count,
                elapsed_ms,
                original_bytes,
                output_bytes,
            }))
        }
        Ok(None) => Ok(None), // 사용자가 중단.
        Err(_) => Err(AppError::new("SAVE_FAILED", SAVE_FAILED_MESSAGE)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::{ReviewItemOrigin, ValidationStatus};
    use crate::sidecar::RelativeBBox;

    fn sample_path(filename: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("pdf-samples").join(filename)
    }

    #[test]
    fn save_redacted_document_to_path_saves_at_the_exact_given_output_path() {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = sample_path("BZB000877_01.pdf");
        // SAVE-05: 사용자가 다이얼로그에서 원래 제안된 이름과 다른 이름을
        // 고를 수도 있다 — 그 경우에도 정확히 그 경로에 저장돼야 한다.
        let output_path = dir.path().join("사용자가-고른-이름.pdf");

        let items = vec![ReviewItem {
            id: "r-0".into(),
            origin: ReviewItemOrigin::Manual,
            page: 0,
            bbox: RelativeBBox { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
            original_bbox: None,
            category: "Custom".into(),
            content: "test".into(),
            pattern_type: None,
            confidence: None,
            validation: ValidationStatus::NotValidated,
            modified: false,
            created_at: "2026-01-01T00:00:00.000Z".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
        }];

        let saved = save_redacted_document_to_path(&pdf_path, &output_path, &items).expect("저장 실패");

        assert_eq!(saved, output_path.to_string_lossy());
        assert!(output_path.exists());
    }
}
