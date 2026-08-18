//! COLOR-02: 색상 설정 저장/로드 command(§7.3, §9.4). 문서/폴더 단위 저장
//! 위치는 sidecar와 달리 PDF가 속한 폴더 하나에 고정(settings_path_for)된다.
//! 그와 별개로, 아직 문서를 하나도 안 연 상태에서도 마지막으로 쓰던 색이
//! 곧바로 반영되도록 OS 앱 설정 폴더에 전역 기본값도 따로 저장한다
//! (save_global_color_settings/load_global_color_settings) — 문서를 열면
//! 그 폴더의 설정이 있는 한 그게 우선하고, 없으면 전역 기본값이 계속
//! 쓰인다(App.tsx/colorSettingsSync.ts 참고).

use crate::error::{AppError, AppResult};
use crate::settings::{self as color_settings, RedactifySettings};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub fn save_color_settings(path: String, settings: RedactifySettings) -> AppResult<()> {
    color_settings::save_settings(Path::new(&path), &settings)
        .map_err(|err| AppError::new("SETTINGS_SAVE_FAILED", err))
}

/// 설정 파일이 없으면 Ok(None)(정상, 아직 커스터마이즈한 적 없음).
#[tauri::command]
pub fn load_color_settings(path: String) -> AppResult<Option<RedactifySettings>> {
    color_settings::load_settings(Path::new(&path)).map_err(|err| AppError::new("SETTINGS_LOAD_FAILED", err))
}

fn global_color_settings_path<R: Runtime>(app: &AppHandle<R>) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("color-settings.json"))
        .map_err(|err| AppError::new("SETTINGS_PATH_FAILED", err.to_string()))
}

#[tauri::command]
pub fn save_global_color_settings<R: Runtime>(app: AppHandle<R>, settings: RedactifySettings) -> AppResult<()> {
    let path = global_color_settings_path(&app)?;
    color_settings::save_settings_to(&path, &settings).map_err(|err| AppError::new("SETTINGS_SAVE_FAILED", err))
}

#[tauri::command]
pub fn load_global_color_settings<R: Runtime>(app: AppHandle<R>) -> AppResult<Option<RedactifySettings>> {
    let path = global_color_settings_path(&app)?;
    color_settings::load_settings_from(&path).map_err(|err| AppError::new("SETTINGS_LOAD_FAILED", err))
}

fn detection_categories_path<R: Runtime>(app: &AppHandle<R>) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("detection-categories.json"))
        .map_err(|err| AppError::new("SETTINGS_PATH_FAILED", err.to_string()))
}

/// DET-OPT: 자동검출에서 **제외할** 카테고리 코드 목록을 전역으로 저장한다(다음 앱
/// 실행에도 적용). "제외 목록"으로 두어, 앞으로 새 카테고리가 생겨도 목록에 없으면
/// 기본적으로 검출되게 한다(하위호환).
#[tauri::command]
pub fn save_detection_categories<R: Runtime>(app: AppHandle<R>, excluded: Vec<String>) -> AppResult<()> {
    let path = detection_categories_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| AppError::new("SETTINGS_SAVE_FAILED", err.to_string()))?;
    }
    let json =
        serde_json::to_string_pretty(&excluded).map_err(|err| AppError::new("SETTINGS_SAVE_FAILED", err.to_string()))?;
    std::fs::write(&path, json).map_err(|err| AppError::new("SETTINGS_SAVE_FAILED", err.to_string()))
}

/// 저장 파일이 없으면 Ok(None)(아직 커스터마이즈 안 함 → 전체 검출).
#[tauri::command]
pub fn load_detection_categories<R: Runtime>(app: AppHandle<R>) -> AppResult<Option<Vec<String>>> {
    let path = detection_categories_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content =
        std::fs::read_to_string(&path).map_err(|err| AppError::new("SETTINGS_LOAD_FAILED", err.to_string()))?;
    serde_json::from_str(&content).map(Some).map_err(|err| AppError::new("SETTINGS_LOAD_FAILED", err.to_string()))
}
