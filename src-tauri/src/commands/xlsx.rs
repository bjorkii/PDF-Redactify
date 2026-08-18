//! IO-01/02/03(§5.4, §6.6): 블랙마킹 목록 Excel 내보내기/가져오기/재앵커링 command.

use crate::commands::operation::OperationCancelToken;
use crate::error::{AppError, AppResult};
use crate::pdfium::{self, ReanchorRequest};
use crate::sidecar::RelativeBBox;
use crate::status::{emit_progress, OperationKind};
use crate::xlsx::{self, XlsxRow};
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;

/// 저장된 xlsx의 실제 경로(파일명)를 반환한다 — 상태바 안내에 쓸 수 있게.
/// UI-PROGRESS: 행 루프에 진행률/중단을 건다. 중단 시 `Ok(None)`(파일 미생성).
#[tauri::command]
pub fn export_review_items<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    rows: Vec<XlsxRow>,
    cancel_token: State<OperationCancelToken>,
) -> AppResult<Option<String>> {
    cancel_token.reset();
    let flag = cancel_token.flag();
    let app_for_progress = app.clone();
    let result = xlsx::export_rows_with_progress(
        Path::new(&path),
        &rows,
        |processed, total| {
            let _ = emit_progress(&app_for_progress, OperationKind::Export, processed, total, true);
        },
        move || flag.load(Ordering::SeqCst),
    );
    let _ = emit_progress(&app, OperationKind::Export, 0, 0, false);

    result
        .map(|saved| saved.map(|p| p.to_string_lossy().into_owned()))
        .map_err(|err| AppError::new("EXPORT_FAILED", err))
}

/// 파일 열기 다이얼로그(xlsx 필터)를 띄우고 선택된 파일을 읽는다. 사용자가
/// 취소하면 `Ok(None)` — 경고 다이얼로그·목록 반영 여부는 프론트(IO-02)의 몫.
///
/// open_pdf(commands::pdf)와 같은 이유로 `async fn`이어야 한다: blocking_pick_file은
/// 메인 스레드에서 호출하면 안 되는 API라, 그대로 두면 다이얼로그를 띄우는
/// 순간 앱 전체가 "응답 없음"에 빠진다.
#[tauri::command]
pub async fn import_review_items<R: Runtime>(app: AppHandle<R>) -> AppResult<Option<Vec<XlsxRow>>> {
    let picked = app.dialog().file().add_filter("Excel", &["xlsx"]).blocking_pick_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|err| AppError::new("IMPORT_PATH_INVALID", format!("파일 경로를 확인할 수 없습니다: {err}")))?;

    xlsx::import_rows(&path).map(Some).map_err(|err| AppError::new("IMPORT_FAILED", err))
}

/// IO-03(§5.4): 가져온 항목마다 (페이지, 내용)으로 텍스트 레이어를 재탐색해
/// bbox를 재앵커링한다. 못 찾은 항목은 None — 프론트가 `$bbox`로 폴백하고
/// '위치확인 필요'로 표시한다.
#[tauri::command]
pub fn reanchor_review_item_bboxes(
    path: String,
    requests: Vec<ReanchorRequest>,
) -> AppResult<Vec<Option<RelativeBBox>>> {
    pdfium::reanchor_bboxes(Path::new(&path), &requests)
        .map_err(|err| AppError::new("REANCHOR_FAILED", err))
}
