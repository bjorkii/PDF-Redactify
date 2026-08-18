//! BM-01: 북마크(outline) 추출 command.

use crate::error::{AppError, AppResult};
use crate::pdfium::{self, BookmarkNode};
use std::path::Path;

/// 문서의 북마크 트리를 추출한다(§6.2). 실패 시(손상·미지원 등) §7.1 표준 에러.
#[tauri::command]
pub fn get_bookmarks(path: String) -> AppResult<Vec<BookmarkNode>> {
    pdfium::extract_bookmarks(Path::new(&path))
        .map_err(|_| AppError::new("PDF_LOAD_FAILED", "PDF 파일이 오류로 인해 열리지 않습니다."))
}
