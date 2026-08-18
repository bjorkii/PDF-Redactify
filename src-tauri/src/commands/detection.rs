//! DET-05(§6.3.1, §7.1): 자동검출 시작 command. 진행률은 상태바 이벤트로
//! 알리고, 취소는 공유 플래그로 처리한다(문서당 한 번에 하나만 실행되므로
//! 플래그 하나로 충분하다).

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Runtime, State};

use crate::error::{AppError, AppResult};
use crate::pdfium;
use crate::sidecar::{PageExclusionZone, ReviewItem};
use crate::status;

const DETECTION_FAILED_MESSAGE: &str = "자동검출 중 오류가 발생했습니다.";

#[derive(Clone)]
pub struct DetectionCancelToken(Arc<AtomicBool>);

impl Default for DetectionCancelToken {
    fn default() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

/// §6.3.1: 텍스트 레이어를 스캔해 후보 목록을 반환한다. 진행 중 "민감정보를
/// 검출하는 중입니다… (n%)"(§7.1)를 페이지마다 상태바로 알린다.
#[tauri::command]
pub fn detect_review_items<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    exclusion_zones: Vec<PageExclusionZone>,
    cancel_token: State<DetectionCancelToken>,
) -> AppResult<Vec<ReviewItem>> {
    cancel_token.0.store(false, Ordering::SeqCst);
    let flag = cancel_token.0.clone();

    let result = pdfium::detect_review_items_with_progress(
        Path::new(&path),
        &exclusion_zones,
        |processed, total| {
            let percent = if total == 0 { 100 } else { processed * 100 / total };
            let _ = status::emit_status(&app, format!("민감정보를 검출하는 중입니다… ({percent}%)"));
        },
        move || flag.load(Ordering::SeqCst),
    );

    result.map_err(|_| AppError::new("DETECTION_FAILED", DETECTION_FAILED_MESSAGE))
}

/// 진행 중인 자동검출에 취소를 요청한다. 검출이 실행 중이 아니어도 안전하게 무시된다.
#[tauri::command]
pub fn cancel_detection(cancel_token: State<DetectionCancelToken>) {
    cancel_token.0.store(true, Ordering::SeqCst);
}
