//! PDF-01: 파일 열기 command. PDF-08(손상/미지원 PDF 에러 처리)도 여기서 함께 다룬다.
//! PDF-02: 페이지 렌더 command도 함께 둔다.

use crate::error::{AppError, AppResult};
use crate::pdfium::{self, PdfDocumentInfo, RenderedPage};
use crate::sidecar::RelativeBBox;
use std::path::Path;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

const PDF_LOAD_FAILED_MESSAGE: &str = "PDF 파일이 오류로 인해 열리지 않습니다.";

/// 파일 열기 다이얼로그(PDF 필터)를 띄우고 선택된 파일을 pdfium으로 로드한다.
/// 사용자가 다이얼로그를 취소하면 `Ok(None)`. 로드 실패(손상·미지원 등)는
/// §7.1 상태바 안내 문구를 담은 표준 에러로 반환한다.
///
/// `blocking_pick_file`은 tauri-plugin-dialog 문서상 메인 스레드에서 호출하면
/// 안 되는 API다(호출 스레드를 그대로 막아버림). command를 `async fn`으로
/// 선언해 tauri가 이 호출을 메인 스레드가 아닌 별도 실행 컨텍스트에서
/// 처리하게 해야, 다이얼로그를 띄우는 순간 앱 전체가 "응답 없음"에 빠지는
/// 걸 막을 수 있다.
#[tauri::command]
pub async fn open_pdf<R: Runtime>(app: AppHandle<R>) -> AppResult<Option<PdfDocumentInfo>> {
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .blocking_pick_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };

    let path = file_path.into_path().map_err(|err| {
        AppError::new(
            "PDF_PATH_INVALID",
            format!("파일 경로를 확인할 수 없습니다: {err}"),
        )
    })?;

    open_pdf_from_path(&path).map(Some)
}

fn open_pdf_from_path(path: &Path) -> AppResult<PdfDocumentInfo> {
    pdfium::open_document_info(path)
        .map_err(|_| AppError::new("PDF_LOAD_FAILED", PDF_LOAD_FAILED_MESSAGE))
}

/// 드래그 앤 드롭으로 놓인 PDF를 다이얼로그 없이 바로 연다(UX 편의, 스펙
/// 명시 항목은 아님). 파일 선택 결과가 이미 정해져 있다는 점만 open_pdf와
/// 다르고, 로드 실패 처리 등은 같은 헬퍼(open_pdf_from_path)를 재사용한다.
#[tauri::command]
pub fn open_pdf_path(path: String) -> AppResult<PdfDocumentInfo> {
    open_pdf_from_path(Path::new(&path))
}

/// PDF-02: pdfium이 렌더한 페이지를 PNG(base64)로 웹뷰에 전달한다.
/// `scale`은 PDF 포인트→픽셀 배율이며, 뷰어의 줌 배율에 맞춰 프론트가 계산해 넘긴다(PDF-04).
#[tauri::command]
pub fn render_page(path: String, page_index: u32, scale: f32) -> AppResult<RenderedPage> {
    pdfium::render_page(Path::new(&path), page_index, scale)
        .map_err(|_| AppError::new("PDF_LOAD_FAILED", PDF_LOAD_FAILED_MESSAGE))
}

/// EDIT-10: 주어진 bbox가 덮는 텍스트를 추출한다(리사이즈/이동 후 목록 content 갱신용).
#[tauri::command]
pub fn extract_text_in_bbox(path: String, page_index: u32, bbox: RelativeBBox) -> AppResult<String> {
    pdfium::extract_text_in_bbox(Path::new(&path), page_index, &bbox)
        .map_err(|_| AppError::new("PDF_LOAD_FAILED", PDF_LOAD_FAILED_MESSAGE))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sample_path(filename: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("pdf-samples")
            .join(filename)
    }

    #[test]
    fn open_pdf_from_path_returns_document_info_for_valid_pdf() {
        let info = open_pdf_from_path(&sample_path("BZB000877_01.pdf")).expect("로드 실패");
        assert_eq!(info.filename, "BZB000877_01.pdf");
        assert_eq!(info.page_count, 4);
    }

    #[test]
    fn open_pdf_from_path_reports_spec_error_message_for_corrupted_pdf() {
        let err = open_pdf_from_path(&sample_path("corrupted.pdf")).expect_err("에러여야 함");
        assert_eq!(err.code, "PDF_LOAD_FAILED");
        assert_eq!(err.message, PDF_LOAD_FAILED_MESSAGE);
    }

    #[test]
    fn open_pdf_path_loads_the_file_at_the_given_path_directly() {
        let path = sample_path("BZB000877_01.pdf");
        let info = open_pdf_path(path.to_string_lossy().into_owned()).expect("로드 실패");
        assert_eq!(info.filename, "BZB000877_01.pdf");
        assert_eq!(info.page_count, 4);
    }

    #[test]
    fn open_pdf_path_reports_spec_error_message_for_corrupted_pdf() {
        let path = sample_path("corrupted.pdf");
        let err = open_pdf_path(path.to_string_lossy().into_owned()).expect_err("에러여야 함");
        assert_eq!(err.code, "PDF_LOAD_FAILED");
        assert_eq!(err.message, PDF_LOAD_FAILED_MESSAGE);
    }
}
