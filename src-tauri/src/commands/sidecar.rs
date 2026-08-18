//! STATE-02: sidecar 저장/로드 command.

use crate::error::{AppError, AppResult};
use crate::sidecar::{self, SidecarDocument};
use std::path::Path;

/// PDF 경로를 받아 sidecar_path_for로 저장 위치를 계산하고 저장한다(§5.1, §9.4).
#[tauri::command]
pub fn save_sidecar(path: String, document: SidecarDocument) -> AppResult<()> {
    sidecar::save_sidecar(Path::new(&path), &document)
        .map_err(|err| AppError::new("SIDECAR_SAVE_FAILED", err))
}

/// sidecar가 없으면 Ok(None)(정상, 최초 실행 등). 손상된 경우에만 에러.
#[tauri::command]
pub fn load_sidecar(path: String) -> AppResult<Option<SidecarDocument>> {
    sidecar::load_sidecar(Path::new(&path)).map_err(|err| AppError::new("SIDECAR_LOAD_FAILED", err))
}
