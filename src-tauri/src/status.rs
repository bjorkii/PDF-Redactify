//! 상태바 메시지 버스(INF-06). Rust 어디서든 이 함수로 임의 이벤트를 상태바에
//! 표출할 수 있다. 프론트는 STATUS_EVENT를 구독해 store에 반영한다(§7.1).

use serde::Serialize;
use tauri::{Emitter, Runtime};

pub const STATUS_EVENT: &str = "status-message";

#[derive(Debug, Clone, Serialize)]
pub struct StatusMessagePayload {
    pub message: String,
}

pub fn emit_status<R: Runtime>(app: &impl Emitter<R>, message: impl Into<String>) -> Result<(), String> {
    app.emit(
        STATUS_EVENT,
        StatusMessagePayload {
            message: message.into(),
        },
    )
    .map_err(|err| format!("상태 이벤트 전송 실패: {err}"))
}

/// UI-PROGRESS: 내보내기/저장의 진행률·중단 UI용 이벤트. 상태바가 이를 구독해
/// progress bar + % + 중단 버튼을 렌더한다(검출 DET-05는 별도 문자열 상태를 쓴다).
pub const PROGRESS_EVENT: &str = "operation-progress";

/// 진행 중인 장시간 작업의 종류(상태바 문구·바 색 구분용).
#[derive(Debug, Clone, Copy)]
pub enum OperationKind {
    Save,
    Export,
}

impl OperationKind {
    fn as_str(self) -> &'static str {
        match self {
            OperationKind::Save => "save",
            OperationKind::Export => "export",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct OperationProgressPayload {
    /// "save" | "export".
    pub kind: String,
    /// 처리 완료 단위 수(페이지/행).
    pub processed: u32,
    /// 전체 단위 수(0이면 100%로 간주).
    pub total: u32,
    /// false면 작업 종료(완료·취소·오류) → 상태바가 바를 숨긴다.
    pub active: bool,
}

/// 진행률 1틱을 상태바로 알린다. `active=false`는 작업 종료 신호(바 숨김).
pub fn emit_progress<R: Runtime>(
    app: &impl Emitter<R>,
    kind: OperationKind,
    processed: u32,
    total: u32,
    active: bool,
) -> Result<(), String> {
    app.emit(
        PROGRESS_EVENT,
        OperationProgressPayload {
            kind: kind.as_str().to_string(),
            processed,
            total,
            active,
        },
    )
    .map_err(|err| format!("진행률 이벤트 전송 실패: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, noop_assets};

    #[test]
    fn emit_status_succeeds_against_a_running_app() {
        let app = mock_builder()
            .build(tauri::test::mock_context(noop_assets()))
            .expect("mock 앱 빌드 실패");

        let result = emit_status(&app, "테스트 상태 메시지");
        assert!(result.is_ok());
    }
}
