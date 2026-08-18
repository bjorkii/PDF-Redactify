//! Rust↔웹뷰 IPC 표준 에러 규약(INF-03).
//! 모든 Tauri command는 `Result<T, AppError>`를 반환한다: 성공 시 Tauri가 T를
//! JSON으로 직렬화해 프론트엔드 Promise를 resolve하고, 실패 시 AppError를
//! 직렬화해 reject한다. 프론트는 `code`로 분기 처리하고 `message`(한국어,
//! §9.3)를 상태바(§7.1)에 그대로 표시할 수 있다.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    /// 기계 판별용 안정 식별자(스네이크 아님, 대문자 스크리밍 케이스로 통일).
    pub code: String,
    /// 사용자에게 그대로 노출 가능한 한국어 메시지.
    pub message: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;
