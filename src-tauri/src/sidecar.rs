//! STATE-01: sidecar JSON 스키마(schema_version 2, §5.2). Rust가 이 타입들의
//! 단일 원천이며, ts-rs가 `cargo test` 시 `src/types/generated/`에 동일한
//! TypeScript 타입을 생성해 프론트와 공유한다.

use crate::pdfium::TextLayerStatus;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use ts_rs::TS;

pub const SCHEMA_VERSION: u32 = 2;
pub const APP_NAME: &str = "PDF-Redactify";

/// STATE-02(§5.1, §9.4): sidecar 파일명은 `[원본파일명].redactify.json`이며,
/// 원문 PDF와 같은 디렉터리에 저장한다.
pub fn sidecar_path_for(pdf_path: &Path) -> PathBuf {
    let mut path = pdf_path.as_os_str().to_owned();
    path.push(".redactify.json");
    PathBuf::from(path)
}

/// sidecar를 저장한다(항상 원문과 같은 폴더, 사람이 보기 좋게 pretty-print).
pub fn save_sidecar(pdf_path: &Path, document: &SidecarDocument) -> Result<(), String> {
    let path = sidecar_path_for(pdf_path);
    let json = serde_json::to_string_pretty(document)
        .map_err(|err| format!("사이드카 JSON 직렬화에 실패했습니다: {err}"))?;
    fs::write(&path, json)
        .map_err(|err| format!("사이드카 파일을 쓸 수 없습니다({}): {err}", path.display()))
}

/// sidecar를 불러온다. 파일이 아예 없으면 정상 상태로 `Ok(None)`(최초 실행 등).
/// 파일은 있는데 손상/형식 불일치면 `Err`.
pub fn load_sidecar(pdf_path: &Path) -> Result<Option<SidecarDocument>, String> {
    let path = sidecar_path_for(pdf_path);
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|err| format!("사이드카 파일을 읽을 수 없습니다({}): {err}", path.display()))?;
    let document = serde_json::from_str(&content)
        .map_err(|err| format!("사이드카 JSON을 해석할 수 없습니다({}): {err}", path.display()))?;

    Ok(Some(document))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct SidecarDocument {
    pub schema_version: u32,
    pub app: String,
    pub source: SourceInfo,
    pub view_state: ViewState,
    pub page_dimensions: Vec<SidecarPageDimensions>,
    pub review_items: Vec<ReviewItem>,
    pub history: HistoryState,
    /// DET-07(§6.3.1 신규): 페이지별 자동검출 제외 영역(헤더/푸터 등 여백).
    /// 이 필드가 없는 구버전 sidecar 파일도 그대로 열 수 있도록
    /// `#[serde(default)]`로 빈 벡터를 기본값으로 둔다(이 코드베이스에서
    /// 처음 쓰는 하위호환 처리 — `deserializes_old_sidecar_without_exclusion_zones_field`
    /// 테스트로 명시적으로 검증함).
    #[serde(default)]
    pub exclusion_zones: Vec<PageExclusionZone>,
}

/// 페이지 상/하/좌/우에서 각각 얼마나 안쪽까지가 탐지 제외 영역인지(0~1,
/// 페이지 크기에 대한 상대값). 0이면 그 방향은 제외 영역이 없다는 뜻.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct PageExclusionMargins {
    pub top: f32,
    pub bottom: f32,
    pub left: f32,
    pub right: f32,
}

/// 한 페이지의 탐지 제외 영역 설정. page_index는 ReviewItem.page와 동일하게
/// 0-indexed(page_dimensions의 1-indexed page_number와는 다른 관례이니 주의).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct PageExclusionZone {
    pub page_index: u32,
    pub margins: PageExclusionMargins,
}

/// 파일 동일성 판정(§4.4)에 쓰이는 원문 정보. 경로/파일명은 참고용일 뿐,
/// 판정은 page_count + page_dimensions + text_fingerprint로 한다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct SourceInfo {
    pub filename: String,
    pub path: String,
    pub page_count: u32,
    pub text_fingerprint: String,
    /// ISO 8601(RFC3339) 문자열. 프론트의 `Date.toISOString()`과 동일한 형식.
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum FocusArea {
    Viewer,
    Bookmark,
    Redaction,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SidebarDockSide {
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct SidebarViewState {
    pub visible: bool,
    pub dock: SidebarDockSide,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct FloatingRectState {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// SIDE-04: 블랙마킹 사이드바만 플로팅+리사이즈를 지원(§6.4).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct RedactionSidebarViewState {
    pub visible: bool,
    pub dock: SidebarDockSide,
    pub floating: bool,
    pub rect: Option<FloatingRectState>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SortDirection {
    Asc,
    Desc,
}

/// 목록 정렬 상태(§6.4). column은 LIST-05에서 실제 정렬 가능한 컬럼 집합이
/// 확정되기 전까지는 자유 문자열("position" 기본값)로 둔다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct SortState {
    pub column: String,
    pub direction: SortDirection,
}

/// 구동 시 상태 복원용(§6.8). STATE-04에서 실제 저장/복원 로직을 구현한다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct ViewState {
    pub current_page: u32,
    pub zoom: f32,
    pub selected_item_id: Option<String>,
    pub focus: FocusArea,
    pub bookmark_sidebar: SidebarViewState,
    pub redaction_sidebar: RedactionSidebarViewState,
    pub sort: SortState,
}

/// §5.2 `page_dimensions` 항목의 사이드카(영구 저장) 형태. pdfium.rs의
/// `PageDimensions`(IPC 응답용, camelCase, unit 필드 없음)와는 별개로, 이 쪽은
/// 스펙의 JSON 스키마 그대로(unit 필드 포함, snake_case)를 유지한다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct SidecarPageDimensions {
    pub page_number: u32,
    pub page_width: f32,
    pub page_height: f32,
    /// 항상 "pt"(72dpi 기준).
    pub unit: String,
    pub text_layer_status: TextLayerStatus,
}

/// §4.2 bbox — 페이지 상대좌표(0~1), 좌상단 원점.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct RelativeBBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ReviewItemOrigin {
    Detected,
    Manual,
    Imported,
}

/// §5.3 검증 결과. 변형 이름을 그대로 직렬화하므로(별도 rename 없음) 스펙의
/// "Valid"/"Invalid"/"ChecksumNotApplicable"/"NotValidated"와 정확히 일치한다.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub enum ValidationStatus {
    Valid,
    Invalid,
    ChecksumNotApplicable,
    NotValidated,
}

/// 블랙마킹 목록의 한 행(§5.2). category는 §5.3의 검출 구분값 또는 사용자
/// 지정("Custom") 문자열 — 실제 드롭다운 값 집합은 DET-02/LIST-03에서 다룬다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct ReviewItem {
    pub id: String,
    pub origin: ReviewItemOrigin,
    pub page: u32,
    pub bbox: RelativeBBox,
    /// 수정 전 bbox(수정 시 보존). 없으면 None.
    pub original_bbox: Option<RelativeBBox>,
    pub category: String,
    pub content: String,
    /// 검출 규칙 id. detected 항목에만 존재, manual/imported는 None.
    pub pattern_type: Option<String>,
    /// 0~1. detected 항목에만 존재.
    pub confidence: Option<f32>,
    pub validation: ValidationStatus,
    pub modified: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum HistoryAction {
    Add,
    Delete,
    Edit,
    Move,
    Include,
    Exclude,
    Import,
    Apply,
}

/// undo/redo 한 단계(STATE-06). before/after는 해당 시점 item 스냅샷.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct HistoryEntry {
    pub seq: u32,
    pub timestamp: String,
    pub action: HistoryAction,
    pub item_id: String,
    pub before: Option<ReviewItem>,
    pub after: Option<ReviewItem>,
    /// 같은 사용자 동작(예: 전체삭제)으로 묶인 여러 entry를 하나의 undo/redo
    /// 단위로 처리하기 위한 그룹 id. 단일 변경은 `None`. 구버전 sidecar 호환을
    /// 위해 없으면 `None`으로 역직렬화한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group_id: Option<String>,
}

/// history.cursor는 0..entries.length 범위의 undo/redo 위치(STATE-06).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct HistoryState {
    pub cursor: u32,
    pub entries: Vec<HistoryEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_document() -> SidecarDocument {
        let item = ReviewItem {
            id: "r-0".into(),
            origin: ReviewItemOrigin::Detected,
            page: 6,
            bbox: RelativeBBox { x: 0.102, y: 0.871, width: 0.101, height: 0.012 },
            original_bbox: None,
            category: "PhoneNumber".into(),
            content: "010-1234-5678".into(),
            pattern_type: Some("PhoneNumber".into()),
            confidence: Some(0.8),
            validation: ValidationStatus::ChecksumNotApplicable,
            modified: false,
            created_at: "2026-07-26T04:56:20.000Z".into(),
            updated_at: "2026-07-26T04:56:45.000Z".into(),
        };

        SidecarDocument {
            schema_version: SCHEMA_VERSION,
            app: APP_NAME.into(),
            source: SourceInfo {
                filename: "ZZ0001964_01.pdf".into(),
                path: "/abs/path/ZZ0001964_01.pdf".into(),
                page_count: 262,
                text_fingerprint: "sha256:deadbeef".into(),
                created_at: "2026-07-26T04:56:09.185Z".into(),
                updated_at: "2026-07-26T04:56:54.654Z".into(),
            },
            view_state: ViewState {
                current_page: 6,
                zoom: 1.0,
                selected_item_id: Some("r-0".into()),
                focus: FocusArea::Viewer,
                bookmark_sidebar: SidebarViewState { visible: true, dock: SidebarDockSide::Left },
                redaction_sidebar: RedactionSidebarViewState {
                    visible: true,
                    dock: SidebarDockSide::Right,
                    floating: false,
                    rect: None,
                },
                sort: SortState { column: "position".into(), direction: SortDirection::Asc },
            },
            page_dimensions: vec![SidecarPageDimensions {
                page_number: 1,
                page_width: 612.0,
                page_height: 792.0,
                unit: "pt".into(),
                text_layer_status: TextLayerStatus::HasText,
            }],
            review_items: vec![item.clone()],
            history: HistoryState {
                cursor: 1,
                entries: vec![HistoryEntry {
                    seq: 1,
                    timestamp: "2026-07-26T04:56:20.000Z".into(),
                    action: HistoryAction::Add,
                    item_id: "r-0".into(),
                    before: None,
                    after: Some(item),
                    group_id: None,
                }],
            },
            exclusion_zones: vec![PageExclusionZone {
                // 0.25/0.125는 이진 부동소수점으로 정확히 표현돼(1/4, 1/8),
                // JSON 왕복 후 f32→f64 변환 오차 없이 정확히 비교할 수 있다.
                page_index: 6,
                margins: PageExclusionMargins { top: 0.25, bottom: 0.125, left: 0.0, right: 0.0 },
            }],
        }
    }

    #[test]
    fn sidecar_document_round_trips_through_json() {
        let original = sample_document();
        let json = serde_json::to_string_pretty(&original).expect("직렬화 실패");
        let restored: SidecarDocument = serde_json::from_str(&json).expect("역직렬화 실패");

        assert_eq!(original, restored);
    }

    #[test]
    fn field_names_and_enum_values_match_spec_exactly() {
        // §5.2 예시 JSON과 동일한 필드명·enum 문자열을 그대로 쓰는지 확인한다.
        let json = serde_json::to_value(sample_document()).expect("직렬화 실패");

        assert_eq!(json["schema_version"], 2);
        assert_eq!(json["source"]["text_fingerprint"], "sha256:deadbeef");
        assert_eq!(json["view_state"]["focus"], "viewer");
        assert_eq!(json["view_state"]["bookmark_sidebar"]["dock"], "left");
        assert_eq!(json["view_state"]["redaction_sidebar"]["dock"], "right");
        assert_eq!(json["view_state"]["sort"]["direction"], "asc");
        assert_eq!(json["page_dimensions"][0]["text_layer_status"], "HasText");
        assert_eq!(json["review_items"][0]["origin"], "detected");
        assert_eq!(json["review_items"][0]["validation"], "ChecksumNotApplicable");
        assert_eq!(json["history"]["entries"][0]["action"], "add");
        assert_eq!(json["exclusion_zones"][0]["page_index"], 6);
        assert_eq!(json["exclusion_zones"][0]["margins"]["top"], 0.25);
    }

    #[test]
    fn deserializes_old_sidecar_without_exclusion_zones_field() {
        // DET-07: exclusion_zones가 스키마에 없던 구버전 sidecar 파일도 그대로
        // 열려야 한다(#[serde(default)] 검증) — 필드 자체가 JSON에 없으면
        // 빈 벡터가 돼야지, 역직렬화 자체가 실패하면 안 된다.
        let json = r#"{
          "schema_version": 2,
          "app": "PDF-Redactify",
          "source": {
            "filename": "old.pdf",
            "path": "/abs/path/old.pdf",
            "page_count": 1,
            "text_fingerprint": "sha256:abc",
            "created_at": "2026-07-26T04:56:09.185Z",
            "updated_at": "2026-07-26T04:56:54.654Z"
          },
          "view_state": {
            "current_page": 0,
            "zoom": 1.0,
            "selected_item_id": null,
            "focus": "viewer",
            "bookmark_sidebar":  { "visible": true,  "dock": "left"  },
            "redaction_sidebar": { "visible": true,  "dock": "right", "floating": false, "rect": null },
            "sort": { "column": "position", "direction": "asc" }
          },
          "page_dimensions": [],
          "review_items": [],
          "history": { "cursor": 0, "entries": [] }
        }"#;

        let document: SidecarDocument =
            serde_json::from_str(json).expect("exclusion_zones 없는 구버전 JSON도 역직렬화돼야 함");

        assert_eq!(document.exclusion_zones, Vec::new());
    }

    #[test]
    fn deserializes_the_literal_example_json_from_spec() {
        // SPEC.md §5.2의 예시를 거의 그대로 옮긴 것(주석 제거, 값은 동일).
        let json = r#"{
          "schema_version": 2,
          "app": "PDF-Redactify",
          "source": {
            "filename": "ZZ0001964_01.pdf",
            "path": "/abs/path/ZZ0001964_01.pdf",
            "page_count": 262,
            "text_fingerprint": "sha256:abc",
            "created_at": "2026-07-26T04:56:09.185Z",
            "updated_at": "2026-07-26T04:56:54.654Z"
          },
          "view_state": {
            "current_page": 6,
            "zoom": 1.0,
            "selected_item_id": "r-0",
            "focus": "viewer",
            "bookmark_sidebar":  { "visible": true,  "dock": "left"  },
            "redaction_sidebar": { "visible": true,  "dock": "right", "floating": false, "rect": null },
            "sort": { "column": "position", "direction": "asc" }
          },
          "page_dimensions": [
            { "page_number": 1, "page_width": 612.0, "page_height": 792.0,
              "unit": "pt", "text_layer_status": "HasText" }
          ],
          "review_items": [
            {
              "id": "r-0",
              "origin": "detected",
              "page": 6,
              "bbox":          { "x": 0.102, "y": 0.871, "width": 0.101, "height": 0.012 },
              "original_bbox": null,
              "category": "PhoneNumber",
              "content": "010-1234-5678",
              "pattern_type": "PhoneNumber",
              "confidence": 0.8,
              "validation": "ChecksumNotApplicable",
              "review_status": "included",
              "modified": false,
              "created_at": "2026-07-26T04:56:20.000Z",
              "updated_at": "2026-07-26T04:56:45.000Z"
            }
          ],
          "history": {
            "cursor": 6,
            "entries": [
              {
                "seq": 1,
                "timestamp": "2026-07-26T04:56:20.000Z",
                "action": "add",
                "item_id": "r-0",
                "before": null,
                "after":  {
                  "id": "r-0",
                  "origin": "detected",
                  "page": 6,
                  "bbox": { "x": 0.102, "y": 0.871, "width": 0.101, "height": 0.012 },
                  "original_bbox": null,
                  "category": "PhoneNumber",
                  "content": "010-1234-5678",
                  "pattern_type": "PhoneNumber",
                  "confidence": 0.8,
                  "validation": "ChecksumNotApplicable",
                  "review_status": "included",
                  "modified": false,
                  "created_at": "2026-07-26T04:56:20.000Z",
                  "updated_at": "2026-07-26T04:56:45.000Z"
                }
              }
            ]
          }
        }"#;

        let document: SidecarDocument = serde_json::from_str(json).expect("SPEC 예시 역직렬화 실패");

        assert_eq!(document.schema_version, 2);
        assert_eq!(document.source.page_count, 262);
        assert_eq!(document.view_state.focus, FocusArea::Viewer);
        assert_eq!(document.review_items[0].validation, ValidationStatus::ChecksumNotApplicable);
        assert_eq!(document.history.entries[0].action, HistoryAction::Add);
    }

    #[test]
    fn sidecar_path_for_appends_redactify_json_after_the_full_pdf_filename() {
        // §5.1: "[원본파일명].redactify.json" — 확장자를 바꾸는 게 아니라 뒤에 덧붙인다.
        let path = sidecar_path_for(Path::new("/abs/path/ZZ0001964_01.pdf"));
        assert_eq!(path, Path::new("/abs/path/ZZ0001964_01.pdf.redactify.json"));
    }

    #[test]
    fn save_then_load_round_trips_and_lands_next_to_the_original_pdf() {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("샘플.pdf");
        std::fs::write(&pdf_path, b"fake pdf bytes").expect("더미 PDF 쓰기 실패");

        let document = sample_document();
        save_sidecar(&pdf_path, &document).expect("저장 실패");

        // §9.4: 사이드카는 원문 PDF와 같은 폴더에 있어야 한다.
        let expected_sidecar_path = dir.path().join("샘플.pdf.redactify.json");
        assert!(expected_sidecar_path.exists());

        let loaded = load_sidecar(&pdf_path).expect("로드 실패").expect("Some이어야 함");
        assert_eq!(loaded, document);
    }

    #[test]
    fn load_sidecar_returns_none_when_no_sidecar_file_exists_yet() {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("아직없음.pdf");

        let result = load_sidecar(&pdf_path).expect("에러가 아니라 Ok(None)이어야 함");
        assert!(result.is_none());
    }

    #[test]
    fn load_sidecar_fails_for_corrupted_json_without_panicking() {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("손상됨.pdf");
        let sidecar_path = sidecar_path_for(&pdf_path);
        std::fs::write(&sidecar_path, b"{ this is not valid json").expect("쓰기 실패");

        let result = load_sidecar(&pdf_path);
        assert!(result.is_err());
    }
}
