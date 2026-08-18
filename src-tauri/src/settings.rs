//! COLOR-01/02(§7.3, §9.4): 색상 설정 스키마. sidecar와 마찬가지로 Rust가
//! 단일 원천이며 ts-rs가 TypeScript 타입을 생성한다. 저장 위치는 sidecar와
//! 달리 원본 PDF 파일명이 아니라 "그 폴더"에 고정된 파일명이다 — §9.4가
//! 명시한 대로 색상 설정은 사실상 문서/폴더 단위 설정이기 때문이다(같은
//! 폴더의 다른 PDF를 열어도 같은 설정을 공유).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use ts_rs::TS;

/// §9.4: 색상 설정은 원본 PDF 파일명이 아니라 "그 폴더"에 고정된 파일명으로
/// 저장한다 — 같은 폴더의 다른 PDF를 열어도 같은 설정을 공유한다.
pub fn settings_path_for(pdf_path: &Path) -> PathBuf {
    pdf_path.parent().unwrap_or_else(|| Path::new(".")).join("redactify-settings.json")
}

/// 색상 설정을 저장한다(항상 해당 PDF가 속한 폴더).
pub fn save_settings(pdf_path: &Path, settings: &RedactifySettings) -> Result<(), String> {
    save_settings_to(&settings_path_for(pdf_path), settings)
}

/// 색상 설정을 불러온다. 파일이 없으면(아직 커스터마이즈한 적 없음) 정상적으로
/// `Ok(None)` — 호출부가 기본값으로 대체한다.
pub fn load_settings(pdf_path: &Path) -> Result<Option<RedactifySettings>, String> {
    load_settings_from(&settings_path_for(pdf_path))
}

/// 저장 위치를 직접 지정하는 하위 함수 — 문서/폴더 단위 저장(save_settings)과
/// 앱 전역 기본값 저장(아직 문서를 안 열었을 때 쓸 마지막 색상,
/// commands/settings.rs의 save_global_color_settings)이 이 로직을 공유한다.
pub fn save_settings_to(path: &Path, settings: &RedactifySettings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings)
        .map_err(|err| format!("색상 설정 직렬화에 실패했습니다: {err}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("색상 설정 폴더를 만들 수 없습니다({}): {err}", parent.display()))?;
    }
    fs::write(path, json).map_err(|err| format!("색상 설정 파일을 쓸 수 없습니다({}): {err}", path.display()))
}

/// save_settings_to의 짝 — 위치를 직접 지정해 불러온다.
pub fn load_settings_from(path: &Path) -> Result<Option<RedactifySettings>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path)
        .map_err(|err| format!("색상 설정 파일을 읽을 수 없습니다({}): {err}", path.display()))?;
    let settings = serde_json::from_str(&content)
        .map_err(|err| format!("색상 설정 JSON을 해석할 수 없습니다({}): {err}", path.display()))?;

    Ok(Some(settings))
}

/// 뷰어 bbox 오버레이 한 상태(선택/비선택)의 배경·테두리색("#rrggbb").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct BoxColorPair {
    pub background: String,
    pub border: String,
}

/// §7.3: 검출 출처(자동검출/사용자 추가)별 선택·비선택 bbox 색상.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct OriginColorScheme {
    pub selected: BoxColorPair,
    pub unselected: BoxColorPair,
}

/// 텍스트가 실제로 보이는 UI(목록 행)의 배경·폰트색.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct TextColorPair {
    pub background: String,
    pub font: String,
}

/// DET-07: 제외영역 가이드선 색상의 기본값 — 이 필드가 아예 없는 구버전
/// 설정 파일을 읽어도(#[serde(default = ...)]) 이 값으로 채워진다. 원래
/// dark gray였는데, 페이지 배경(연한 회색)과 대비가 약해 가이드선이 잘 안
/// 보인다는 재현 보고로 눈에 띄는 노란색으로 바꿨다(ExclusionZoneOverlay.css의
/// 굵기 증가·깜빡임 효과와 함께).
fn default_exclusion_guide_color() -> String {
    "#ffcc00".into()
}

/// §7.3 색상 설정 전체. focus_border_color는 §7.4 포커스 표시에도 쓰인다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct RedactifySettings {
    pub detected: OriginColorScheme,
    pub manual: OriginColorScheme,
    pub focus_border_color: String,
    pub sidebar_selection: TextColorPair,
    /// DET-07: 탐지 제외영역 드래그 가이드선 색상.
    #[serde(default = "default_exclusion_guide_color")]
    pub exclusion_guide_color: String,
}

/// 지금까지 하드코딩돼 있던 값과 동일한 기본값 — 사용자가 실제로 바꾸기
/// 전까지는 화면이 달라지지 않는다.
pub fn default_settings() -> RedactifySettings {
    RedactifySettings {
        detected: OriginColorScheme {
            selected: BoxColorPair { background: "#396cd8".into(), border: "#396cd8".into() },
            unselected: BoxColorPair { background: "#e6a000".into(), border: "#e6a000".into() },
        },
        manual: OriginColorScheme {
            selected: BoxColorPair { background: "#396cd8".into(), border: "#396cd8".into() },
            unselected: BoxColorPair { background: "#e6a000".into(), border: "#e6a000".into() },
        },
        focus_border_color: "#396cd8".into(),
        sidebar_selection: TextColorPair { background: "#396cd8".into(), font: "#ffffff".into() },
        exclusion_guide_color: default_exclusion_guide_color(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_round_trips_through_json() {
        let original = default_settings();
        let json = serde_json::to_string_pretty(&original).expect("직렬화 실패");
        let restored: RedactifySettings = serde_json::from_str(&json).expect("역직렬화 실패");
        assert_eq!(original, restored);
    }

    #[test]
    fn field_names_match_spec_camel_free_snake_case() {
        // §7.3 색상 설정 JSON은 스키마 그대로(snake_case)를 유지한다(sidecar와 동일 관례).
        let json = serde_json::to_value(default_settings()).expect("직렬화 실패");
        assert_eq!(json["detected"]["selected"]["background"], "#396cd8");
        assert_eq!(json["manual"]["unselected"]["border"], "#e6a000");
        assert_eq!(json["focus_border_color"], "#396cd8");
        assert_eq!(json["sidebar_selection"]["font"], "#ffffff");
    }

    #[test]
    fn settings_path_for_is_scoped_to_the_folder_not_the_filename() {
        // §9.4: 파일명과 무관하게 폴더 하나에 고정된 이름이어야, 같은 폴더의
        // 다른 PDF를 열어도 같은 설정 파일을 공유한다.
        let a = settings_path_for(Path::new("/abs/path/A.pdf"));
        let b = settings_path_for(Path::new("/abs/path/B.pdf"));
        assert_eq!(a, b);
        assert_eq!(a, Path::new("/abs/path/redactify-settings.json"));
    }

    #[test]
    fn save_then_load_round_trips_and_lands_in_the_same_folder_as_the_pdf() {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("샘플.pdf");
        std::fs::write(&pdf_path, b"fake pdf bytes").expect("더미 PDF 쓰기 실패");

        let settings = default_settings();
        save_settings(&pdf_path, &settings).expect("저장 실패");

        let expected_path = dir.path().join("redactify-settings.json");
        assert!(expected_path.exists());

        let loaded = load_settings(&pdf_path).expect("로드 실패").expect("Some이어야 함");
        assert_eq!(loaded, settings);
    }

    #[test]
    fn load_settings_returns_none_when_no_settings_file_exists_yet() {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("아직없음.pdf");

        let result = load_settings(&pdf_path).expect("에러가 아니라 Ok(None)이어야 함");
        assert!(result.is_none());
    }

    #[test]
    fn deserializes_old_settings_without_exclusion_guide_color_field() {
        // DET-07 이전에 저장된 설정 파일에는 exclusion_guide_color 필드가
        // 아예 없다 — 역직렬화가 실패하지 않고 기본값(dark gray)으로
        // 채워져야 한다(sidecar.rs의 exclusion_zones #[serde(default)]와 동일 관례).
        let json = r##"{
            "detected": {
                "selected": { "background": "#396cd8", "border": "#396cd8" },
                "unselected": { "background": "#e6a000", "border": "#e6a000" }
            },
            "manual": {
                "selected": { "background": "#396cd8", "border": "#396cd8" },
                "unselected": { "background": "#e6a000", "border": "#e6a000" }
            },
            "focus_border_color": "#396cd8",
            "sidebar_selection": { "background": "#396cd8", "font": "#ffffff" }
        }"##;

        let restored: RedactifySettings = serde_json::from_str(json).expect("역직렬화 실패");
        assert_eq!(restored.exclusion_guide_color, "#ffcc00");
    }
}
