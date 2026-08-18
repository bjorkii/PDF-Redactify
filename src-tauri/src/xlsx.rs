//! IO-01/02(§5.4, §6.6): 블랙마킹 목록 Excel 내보내기(rust_xlsxwriter)/
//! 가져오기(calamine). 이 모듈은 셀 값의 의미(구분 한국어 표시명, bbox 문자열
//! 포맷 등)에 대한 지식이 없는 순수 표 읽기/쓰기다 — 그 값은 프론트가 만들고
//! 해석한다(구분 표시명은 ko.ts의 categoryLabel, bbox 포맷은 서로 맞춰 §5.4
//! "x,y,w,h"로 통일).

use calamine::{open_workbook, Data, Reader, Xlsx};
use rust_xlsxwriter::{Workbook, XlsxError};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use ts_rs::TS;

pub const SHEET_NAME: &str = "블랙마킹목록";

/// §5.4 Excel 스키마 한 행. `$`가 붙은 컬럼(filename, bbox)은 사이드바 UI에는
/// 안 보이지만 파일에는 그대로 유지된다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct XlsxRow {
    pub filename: String,
    pub category: String,
    pub content: String,
    pub page: u32,
    pub bbox: String,
    pub updated_at: String,
}

const HEADERS: [&str; 6] = ["$파일명", "구분", "내용", "페이지", "$bbox", "수정추가시각"];

/// §5.1: 내보내기 파일명은 `[원본파일명]-블랙마킹목록.xlsx`, 원문과 같은 폴더.
pub fn export_path_for(pdf_path: &Path) -> PathBuf {
    let stem = pdf_path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = pdf_path.parent().unwrap_or_else(|| Path::new("."));
    dir.join(format!("{stem}-블랙마킹목록.xlsx"))
}

fn to_xlsx_error(err: XlsxError) -> String {
    format!("Excel 파일을 만들 수 없습니다: {err}")
}

/// 행 목록을 xlsx로 저장하고 실제 저장 경로를 반환한다.
pub fn export_rows(pdf_path: &Path, rows: &[XlsxRow]) -> Result<PathBuf, String> {
    match export_rows_with_progress(pdf_path, rows, |_, _| {}, || false)? {
        Some(path) => Ok(path),
        // 취소 콜백이 항상 false라 여기 도달할 수 없지만, 타입상 안전한 폴백.
        None => Err("내보내기가 취소되었습니다.".to_string()),
    }
}

/// UI-PROGRESS: `export_rows`에 **진행률 콜백 + 중단 확인**을 더한 형태. 행을 하나
/// 쓸 때마다 `on_progress(처리수, 전체수)`를 부르고, 중간에 `should_cancel()`이 참이면
/// 파일을 쓰지 않고 `Ok(None)`(중단)으로 빠진다. 정상 완료 시 `Ok(Some(경로))`.
pub fn export_rows_with_progress<F, C>(
    pdf_path: &Path,
    rows: &[XlsxRow],
    mut on_progress: F,
    should_cancel: C,
) -> Result<Option<PathBuf>, String>
where
    F: FnMut(u32, u32),
    C: Fn() -> bool,
{
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet.set_name(SHEET_NAME).map_err(to_xlsx_error)?;

    for (col, header) in HEADERS.iter().enumerate() {
        worksheet.write(0, col as u16, *header).map_err(to_xlsx_error)?;
    }

    let total = rows.len() as u32;
    on_progress(0, total);
    for (index, row) in rows.iter().enumerate() {
        if should_cancel() {
            return Ok(None);
        }
        let excel_row = (index + 1) as u32;
        worksheet.write(excel_row, 0, &row.filename).map_err(to_xlsx_error)?;
        worksheet.write(excel_row, 1, &row.category).map_err(to_xlsx_error)?;
        worksheet.write(excel_row, 2, &row.content).map_err(to_xlsx_error)?;
        worksheet.write(excel_row, 3, row.page).map_err(to_xlsx_error)?;
        worksheet.write(excel_row, 4, &row.bbox).map_err(to_xlsx_error)?;
        worksheet.write(excel_row, 5, &row.updated_at).map_err(to_xlsx_error)?;
        on_progress(index as u32 + 1, total);
    }

    if should_cancel() {
        return Ok(None);
    }
    let path = export_path_for(pdf_path);
    workbook
        .save(&path)
        .map_err(|err| format!("Excel 파일을 저장할 수 없습니다({}): {err}", path.display()))?;

    Ok(Some(path))
}

fn data_to_string(data: Option<&Data>) -> String {
    match data {
        Some(Data::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn data_to_page_number(data: Option<&Data>) -> Result<u32, String> {
    match data {
        Some(Data::Int(n)) => Ok(*n as u32),
        Some(Data::Float(n)) => Ok(*n as u32),
        Some(Data::String(s)) => {
            s.trim().parse::<u32>().map_err(|_| format!("페이지 번호를 해석할 수 없습니다: {s}"))
        }
        other => Err(format!("페이지 번호가 없거나 형식이 올바르지 않습니다: {other:?}")),
    }
}

/// §5.4/§6.6: xlsx의 "블랙마킹목록" 시트를 읽어 행 목록으로 반환한다. 헤더
/// 한 줄은 건너뛴다. 셀 값 자체의 해석(구분 표시명→코드, bbox 파싱 등)은
/// 프론트(IO-02)의 몫이다.
pub fn import_rows(path: &Path) -> Result<Vec<XlsxRow>, String> {
    let mut workbook: Xlsx<_> = open_workbook(path)
        .map_err(|err| format!("Excel 파일을 열 수 없습니다({}): {err}", path.display()))?;

    let range = workbook
        .worksheet_range(SHEET_NAME)
        .map_err(|err| format!("'{SHEET_NAME}' 시트를 찾을 수 없습니다: {err}"))?;

    let mut rows = Vec::new();
    for row in range.rows().skip(1) {
        // 완전히 빈 줄(끝에 남은 서식만 있는 행 등)은 건너뛴다.
        if row.iter().all(|cell| matches!(cell, Data::Empty)) {
            continue;
        }

        rows.push(XlsxRow {
            filename: data_to_string(row.first()),
            category: data_to_string(row.get(1)),
            content: data_to_string(row.get(2)),
            page: data_to_page_number(row.get(3))?,
            bbox: data_to_string(row.get(4)),
            updated_at: data_to_string(row.get(5)),
        });
    }

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_row() -> XlsxRow {
        XlsxRow {
            filename: "test.pdf".into(),
            category: "전화번호".into(),
            content: "010-1234-5678".into(),
            page: 1,
            bbox: "0.1,0.2,0.3,0.05".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
        }
    }

    #[test]
    fn export_path_for_appends_suffix_and_swaps_extension() {
        let path = export_path_for(Path::new("/abs/path/ZZ0001964_01.pdf"));
        assert_eq!(path, Path::new("/abs/path/ZZ0001964_01-블랙마킹목록.xlsx"));
    }

    #[test]
    fn export_with_progress_cancels_without_writing_file() {
        // UI-PROGRESS: should_cancel=true면 파일을 만들지 않고 Ok(None)으로 빠진다.
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("t.pdf");
        std::fs::write(&pdf_path, b"fake").expect("더미 PDF 쓰기 실패");
        let result =
            export_rows_with_progress(&pdf_path, &[sample_row()], |_, _| {}, || true).expect("호출 성공");
        assert!(result.is_none(), "중단 시 None이어야 한다");
        assert!(!export_path_for(&pdf_path).exists(), "중단 시 xlsx를 만들지 않아야 한다");
    }

    #[test]
    fn export_rows_creates_a_file_next_to_the_pdf() {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("샘플.pdf");
        std::fs::write(&pdf_path, b"fake pdf bytes").expect("더미 PDF 쓰기 실패");

        let saved_path = export_rows(&pdf_path, &[sample_row()]).expect("내보내기 실패");

        assert_eq!(saved_path, dir.path().join("샘플-블랙마킹목록.xlsx"));
        assert!(saved_path.exists());
    }

    #[test]
    fn export_rows_succeeds_with_an_empty_list() {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("빈목록.pdf");
        std::fs::write(&pdf_path, b"fake").expect("더미 PDF 쓰기 실패");

        let result = export_rows(&pdf_path, &[]);
        assert!(result.is_ok());
    }

    #[test]
    fn export_then_import_round_trips_rows() {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("샘플.pdf");
        std::fs::write(&pdf_path, b"fake pdf bytes").expect("더미 PDF 쓰기 실패");

        let rows = vec![
            sample_row(),
            XlsxRow {
                filename: "test.pdf".into(),
                category: "사용자 지정".into(),
                content: "메모".into(),
                page: 3,
                bbox: "0,0,0.1,0.1".into(),
                updated_at: "2026-02-02T00:00:00.000Z".into(),
            },
        ];

        let saved_path = export_rows(&pdf_path, &rows).expect("내보내기 실패");
        let imported = import_rows(&saved_path).expect("가져오기 실패");

        assert_eq!(imported, rows);
    }

    #[test]
    fn import_rows_skips_completely_empty_rows() {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("샘플.pdf");
        std::fs::write(&pdf_path, b"fake pdf bytes").expect("더미 PDF 쓰기 실패");

        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet();
        worksheet.set_name(SHEET_NAME).unwrap();
        for (col, header) in HEADERS.iter().enumerate() {
            worksheet.write(0, col as u16, *header).unwrap();
        }
        worksheet.write(1, 0, "test.pdf").unwrap();
        worksheet.write(1, 1, "전화번호").unwrap();
        worksheet.write(1, 2, "010-1234-5678").unwrap();
        worksheet.write(1, 3, 1u32).unwrap();
        worksheet.write(1, 4, "0.1,0.1,0.1,0.1").unwrap();
        worksheet.write(1, 5, "2026-01-01T00:00:00.000Z").unwrap();
        // 2행은 완전히 비워둔다(중간에 빈 줄이 섞인 파일 대비).

        let path = dir.path().join("수동.xlsx");
        workbook.save(&path).expect("저장 실패");

        let imported = import_rows(&path).expect("가져오기 실패");
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].content, "010-1234-5678");
    }
}
