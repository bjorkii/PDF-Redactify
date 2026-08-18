//! UI-PROGRESS: 장시간 작업(저장 SAVE-03 / 내보내기 IO-01)의 **중단**을 위한 공유
//! 취소 토큰. 저장 흐름은 저장→내보내기를 순차 실행하고 한 번에 하나만 돌므로
//! (검출 DET-05와 별개로) 플래그 하나로 충분하다. 중단 버튼은 이 command만 호출한다.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Runtime, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone)]
pub struct OperationCancelToken(Arc<AtomicBool>);

impl Default for OperationCancelToken {
    fn default() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

impl OperationCancelToken {
    /// 작업 시작 시 호출 — 이전 취소 신호를 지운다.
    pub fn reset(&self) {
        self.0.store(false, Ordering::SeqCst);
    }

    /// 루프에서 취소 여부를 확인할 때 넘길 수 있는 클로저용 공유 핸들.
    pub fn flag(&self) -> Arc<AtomicBool> {
        self.0.clone()
    }
}

/// 진행 중인 저장/내보내기에 중단을 요청한다. 실행 중이 아니어도 안전하게 무시된다.
#[tauri::command]
pub fn cancel_operation(cancel_token: State<OperationCancelToken>) {
    cancel_token.0.store(true, Ordering::SeqCst);
}

/// UI-PROGRESS: 저장/내보내기 완료 후 '열기' — 결과 파일을 시스템 연결 앱으로 연다.
/// opener 플러그인의 JS `openPath`(→ `open_path` 커맨드)는 **경로 스코프**를 요구해서,
/// 스코프 미설정 시 `ForbiddenPath`로 조용히 실패한다(사용자 증상: 버튼이 안 먹힘).
/// 결과 파일은 방금 앱이 만든 신뢰 대상이므로, 스코프 검사 없는 `OpenerExt::open_path`를
/// 직접 부르는 전용 커맨드로 연다.
#[tauri::command]
pub fn open_path_external<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|err| format!("파일을 열 수 없습니다: {err}"))
}
