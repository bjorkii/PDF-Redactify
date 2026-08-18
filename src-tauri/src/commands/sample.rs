//! IPC 골격 검증용 샘플 command(INF-03). 이후 실제 기능 command로 대체/확장된다.

use crate::error::{AppError, AppResult};
use crate::status;
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub fn ping(value: String) -> AppResult<String> {
    Ok(format!("pong: {value}"))
}

#[tauri::command]
pub fn ping_fail() -> AppResult<String> {
    Err(AppError::new("SAMPLE_FAILURE", "샘플 실패 응답입니다"))
}

/// 임의 이벤트를 상태바에 표출하는 API(INF-06). 프론트가 직접 호출하거나,
/// 다른 command 내부에서 진행 상황·에러를 알릴 때 status::emit_status를 사용한다.
#[tauri::command]
pub fn report_status<R: Runtime>(app: AppHandle<R>, message: String) -> AppResult<()> {
    status::emit_status(&app, message).map_err(|err| AppError::new("STATUS_EMIT_FAILED", err))
}
