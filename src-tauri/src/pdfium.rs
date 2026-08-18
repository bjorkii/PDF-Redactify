//! pdfium(pdfium-render) 바인딩 초기화 및 최소 접근 API.
//! SPEC §4.1: pdfium을 렌더·좌표·블랙마킹의 단일 원천으로 삼는다.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(target_os = "macos")]
fn platform_vendor_subdir() -> &'static str {
    "macos-universal"
}

#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
fn platform_vendor_subdir() -> &'static str {
    "windows-arm64"
}

#[cfg(all(target_os = "windows", not(target_arch = "aarch64")))]
fn platform_vendor_subdir() -> &'static str {
    "windows-x64"
}

/// 번들 리소스 안에서 pdfium 동적 라이브러리가 놓이는 **상대 경로**
/// (`vendor/pdfium/<platform>/lib{pdfium.dylib|pdfium.dll}`). tauri.conf.json의
/// `bundle.resources`가 이 경로 그대로 번들에 복사하고, 배포 앱은 시작 시
/// 리소스 디렉터리 + 이 상대경로를 `PDFIUM_DYNAMIC_LIB_PATH`로 설정한다(lib.rs).
pub fn bundled_lib_relative_path() -> PathBuf {
    Path::new("vendor")
        .join("pdfium")
        .join(platform_vendor_subdir())
        .join(Pdfium::pdfium_platform_library_name())
}

/// pdfium 동적 라이브러리 경로를 결정한다.
/// 1. `PDFIUM_DYNAMIC_LIB_PATH` 환경변수(설정 시 최우선) — 배포 번들에서는
///    lib.rs의 setup 훅이 앱 리소스 디렉터리 경로를 여기 넣어준다(DIST-01~03).
/// 2. 개발/CI 시 `src-tauri/vendor/pdfium/<platform>/`(scripts/fetch-pdfium.mjs로 준비).
///    (주의: `CARGO_MANIFEST_DIR`은 빌드 머신의 경로라 배포 번들에서는 유효하지
///     않으므로, 번들에서는 반드시 1번 경로가 설정돼 있어야 한다.)
fn resolve_library_path() -> PathBuf {
    if let Ok(path) = std::env::var("PDFIUM_DYNAMIC_LIB_PATH") {
        return PathBuf::from(path);
    }

    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("vendor")
        .join("pdfium")
        .join(platform_vendor_subdir())
        .join(Pdfium::pdfium_platform_library_name())
}

/// 프로세스 전역에서 단 하나만 존재할 수 있는 Pdfium 바인딩(라이브러리 자체의 제약).
/// 초기화 자체를 `get_or_init` 클로저 안에서 수행해, 동시 호출 시에도 정확히 한 번만
/// `Pdfium::new()`가 실행되도록 보장한다(그렇지 않으면 라이브러리 내부의 전역 바인딩
/// 슬롯이 중복 초기화되어 패닉이 FFI 경계를 넘다 abort로 이어질 수 있다).
static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();

fn shared() -> Result<&'static Pdfium, String> {
    let result = PDFIUM.get_or_init(|| {
        let library_path = resolve_library_path();
        Pdfium::bind_to_library(&library_path)
            .map_err(|err| {
                format!(
                    "pdfium 라이브러리를 불러오지 못했습니다({}): {err}. `npm run setup:pdfium`을 실행했는지 확인하세요.",
                    library_path.display()
                )
            })
            .map(Pdfium::new)
    });

    result.as_ref().map_err(|err| err.clone())
}

/// pdfium(및 그 기반 C++ 라이브러리)은 서로 다른 문서 핸들 간에도 완전히
/// 스레드 안전하지 않다 — `thread_safe` cargo feature는 개별 바인딩 호출
/// 단위만 보호하므로, 문서 로드부터 페이지 접근·렌더까지 이어지는 한 번의
/// 작업 전체를 감싸는 전역 락이 별도로 필요하다(그렇지 않으면 동시 호출 시
/// 페이지 수가 뒤바뀌거나 임의의 디코딩 에러가 나는 등 상태가 오염된다).
pub(crate) static PDFIUM_OP_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn load_document(path: &Path) -> Result<PdfDocument<'static>, String> {
    let pdfium = shared()?;
    pdfium
        .load_pdf_from_file(path, None)
        .map_err(|err| format!("PDF를 열 수 없습니다: {err}"))
}

/// PDF-07: 페이지의 텍스트 레이어 존재 여부(§5.2, §6.3.4). 스캔본처럼 추출 가능한
/// 텍스트가 전혀 없는 페이지는 자동검출 대상에서 제외된다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum TextLayerStatus {
    HasText,
    NoText,
}

/// SPEC §5.2 `page_dimensions` 항목(단위는 항상 pt/72dpi). 사이드카 JSON으로
/// 저장할 때는 STATE-02에서 이 값을 스펙의 snake_case 필드명으로 매핑한다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDimensions {
    pub page_number: u32,
    pub page_width: f32,
    pub page_height: f32,
    pub text_layer_status: TextLayerStatus,
}

/// PDF-09: 정규화된 추출 텍스트의 해시(§4.4 `text_fingerprint`). 연속된 공백·개행을
/// 단일 스페이스로 접어, 시각적으로 동일한 문서를 다른 도구가 재저장하며 생긴
/// 사소한 레이아웃 차이에 영향받지 않게 한다.
fn normalize_extracted_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 문서 전체를 한 번 순회하며 페이지별 크기/텍스트 레이어 상태(PDF-07)와
/// 문서 전체 텍스트 fingerprint(PDF-09)를 함께 산출한다(중복 텍스트 추출 방지).
fn analyze_document(document: &PdfDocument) -> Result<(Vec<PageDimensions>, String), String> {
    let mut dimensions = Vec::new();
    let mut combined_text = String::new();

    for (index, page) in document.pages().iter().enumerate() {
        let text = page
            .text()
            .map_err(|err| format!("텍스트 레이어를 읽을 수 없습니다: {err}"))?
            .all();

        // PdfPageText::is_empty()는 공백·개행도 문자 수에 포함하므로, 스캔본에서
        // 남는 의미 없는 공백만으로 HasText로 오판하지 않도록 trim 후 판정한다.
        let status = if text.trim().is_empty() {
            TextLayerStatus::NoText
        } else {
            TextLayerStatus::HasText
        };

        combined_text.push_str(&text);
        combined_text.push('\n');

        dimensions.push(PageDimensions {
            page_number: index as u32 + 1,
            page_width: page.width().value,
            page_height: page.height().value,
            text_layer_status: status,
        });
    }

    let normalized = normalize_extracted_text(&combined_text);
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    let digest = hasher.finalize();
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    let fingerprint = format!("sha256:{hex}");

    Ok((dimensions, fingerprint))
}

/// PDF-01: 파일 열기 command에서 사용하는 기본 문서 정보.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDocumentInfo {
    pub path: String,
    pub filename: String,
    pub page_count: u32,
    /// PDF-07: 페이지별 크기·텍스트 레이어 상태(§5.2, §6.3.4). 파일 로드 시점에
    /// 함께 산출해, 검출 가능 여부 안내(DET-06)에 바로 쓸 수 있게 한다.
    pub page_dimensions: Vec<PageDimensions>,
    /// PDF-09: 파일 동일성 판정(§4.4)에 쓰이는 정규화 텍스트 해시. "sha256:" 접두.
    pub text_fingerprint: String,
}

/// 주어진 경로의 PDF를 열어 기본 정보를 반환한다. 실패 시(손상·미지원 등) 에러를
/// 반환하며, 호출 측(commands::open_pdf)이 §7.1 안내 문구로 감싼다(PDF-08).
pub fn open_document_info(path: &Path) -> Result<PdfDocumentInfo, String> {
    let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let document = load_document(path)?;

    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();

    let page_count = document.pages().len() as u32;
    let (page_dimensions, text_fingerprint) = analyze_document(&document)?;

    Ok(PdfDocumentInfo {
        path: path.to_string_lossy().into_owned(),
        filename,
        page_count,
        page_dimensions,
        text_fingerprint,
    })
}

/// PDF-02: 페이지 렌더 결과(§4.1 — pdfium이 렌더한 비트맵을 웹뷰로 전송).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedPage {
    pub page_index: u32,
    /// 렌더된 비트맵의 픽셀 크기(§4.2 페이지 상대좌표 ↔ 픽셀 변환의 기준).
    pub width: u32,
    pub height: u32,
    /// 참고용 페이지 크기(pt, 72dpi, §4.2 page_dimensions).
    pub page_width_pt: f32,
    pub page_height_pt: f32,
    /// `data:image/png;base64,` 접두 없이 PNG 바이트만 base64 인코딩한 값.
    pub png_base64: String,
}

/// 주어진 페이지를 `scale`배(포인트→픽셀 배율)로 래스터화해 PNG로 반환한다.
/// 항상 페이지의 실제 가로세로 비율을 유지한다(§6.1 "정확한 비율로 표시").
pub fn render_page(path: &Path, page_index: u32, scale: f32) -> Result<RenderedPage, String> {
    let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let document = load_document(path)?;
    let page = document
        .pages()
        .get(page_index as i32)
        .map_err(|err| format!("페이지({page_index})를 불러올 수 없습니다: {err}"))?;

    let page_width_pt = page.width().value;
    let page_height_pt = page.height().value;

    let config = PdfRenderConfig::new().scale_page_by_factor(scale);
    let bitmap = page
        .render_with_config(&config)
        .map_err(|err| format!("페이지 렌더링에 실패했습니다: {err}"))?;

    let image = bitmap
        .as_image()
        .map_err(|err| format!("렌더링 결과를 이미지로 변환할 수 없습니다: {err}"))?;

    // render_page는 PDFIUM_OP_LOCK을 쥔 채로 실행된다(pdfium이 스레드 안전하지
    // 않아서 전역 뮤텍스로 직렬화함) — 연속 스크롤 모드는 오버스캔으로 여러
    // 페이지를 한꺼번에 요청하는데, 그 요청들이 이 락 뒤에서 순서대로 기다려야
    // 하므로 인코딩 자체가 느리면 그 대기시간이 그대로 누적된다. write_to의
    // 기본 PNG 압축(Balanced)보다 빠른 Fast로 바꿔 락을 쥐는 시간을 줄인다 —
    // 어차피 화면 표시용 데이터URI라 파일 크기보다 속도가 더 중요하다.
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    let mut png_bytes: Vec<u8> = Vec::new();
    image
        .write_with_encoder(PngEncoder::new_with_quality(
            &mut png_bytes,
            CompressionType::Fast,
            FilterType::Adaptive,
        ))
        .map_err(|err| format!("PNG 인코딩에 실패했습니다: {err}"))?;

    Ok(RenderedPage {
        page_index,
        width: image.width(),
        height: image.height(),
        page_width_pt,
        page_height_pt,
        png_base64: STANDARD.encode(&png_bytes),
    })
}

/// DET-01: 페이지의 유니코드 문자 하나와 그 페이지 상대좌표 bbox(§4.2, 좌상단
/// 원점 0~1). 검출 엔진(detection.rs)이 정규식 매치 위치를 실제 페이지 위치로
/// 되짚어 매핑할 때 이 목록을 쓴다. pdfium의 좌표계는 좌하단 원점이라 변환한다.
#[derive(Clone)]
pub(crate) struct PositionedChar {
    pub ch: char,
    pub bbox: crate::sidecar::RelativeBBox,
}

/// 문서에 정의된 순서대로(시각적 읽기 순서와 다를 수 있음) 페이지의 모든 문자와
/// 그 위치를 반환한다. bbox를 얻을 수 없는 문자(생성된 공백 등)는 건너뛴다.
fn extract_page_chars(page: &PdfPage) -> Vec<PositionedChar> {
    let page_width = page.width().value;
    let page_height = page.height().value;

    let text = match page.text() {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };

    text.chars()
        .iter()
        .filter_map(|c| {
            let ch = c.unicode_char()?;
            let bounds = c.loose_bounds().ok()?;
            Some(PositionedChar {
                ch,
                bbox: crate::sidecar::RelativeBBox {
                    x: bounds.left().value / page_width,
                    y: (page_height - bounds.top().value) / page_height,
                    width: bounds.width().value / page_width,
                    height: bounds.height().value / page_height,
                },
            })
        })
        .collect()
}

/// DET-07: 문자 하나의 bbox 중심점이 페이지 제외 마진(상/하/좌/우 4개 밴드
/// 중 하나) 안에 있는지 판정한다. 중심점 기준이라, 마진 경계에 걸친 문자는
/// "더 많이 걸쳐 있는 쪽"으로 자연스럽게 판정된다.
fn is_bbox_excluded(bbox: &crate::sidecar::RelativeBBox, margins: &crate::sidecar::PageExclusionMargins) -> bool {
    let center_x = bbox.x + bbox.width / 2.0;
    let center_y = bbox.y + bbox.height / 2.0;
    center_y < margins.top
        || center_y > 1.0 - margins.bottom
        || center_x < margins.left
        || center_x > 1.0 - margins.right
}

/// 주어진 페이지의 제외 영역 설정을 찾아, 그 안에 중심점이 있는 문자를
/// 걸러낸 목록을 반환한다. 설정이 없는 페이지는 원본을 그대로 돌려준다
/// (제외 없음).
fn filter_excluded_chars(
    chars: Vec<PositionedChar>,
    page_index: u32,
    exclusion_zones: &[crate::sidecar::PageExclusionZone],
) -> Vec<PositionedChar> {
    let Some(zone) = exclusion_zones.iter().find(|z| z.page_index == page_index) else {
        return chars;
    };
    chars.into_iter().filter(|c| !is_bbox_excluded(&c.bbox, &zone.margins)).collect()
}

/// DET-01/05(§6.3.1): 문서 전체의 텍스트 레이어를 스캔해 검출 후보(review_items)를
/// 생성한다. 텍스트 레이어가 없는 페이지(§6.3.4)는 문자가 없으니 자연히
/// 후보도 없다 — 상태바 안내는 DET-06의 몫이다.
///
/// `on_progress(processed_pages, total_pages)`는 매 페이지 처리 후 호출된다
/// (진행률 %, §7.1). `should_cancel()`이 true를 반환하면 그 시점까지 찾은
/// 항목을 그대로 반환하고 멈춘다(대용량 문서 취소, §6.3.1) — 에러가 아니라
/// 부분 결과다.
pub fn detect_review_items_with_progress(
    path: &Path,
    exclusion_zones: &[crate::sidecar::PageExclusionZone],
    mut on_progress: impl FnMut(u32, u32),
    should_cancel: impl Fn() -> bool,
) -> Result<Vec<crate::sidecar::ReviewItem>, String> {
    let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let document = load_document(path)?;

    let rules = crate::detection::default_rules();
    let now = crate::detection::current_timestamp();
    let mut next_id = 0u32;
    let mut items = Vec::new();
    let page_count = document.pages().len() as u32;

    for (page_index, page) in document.pages().iter().enumerate() {
        if should_cancel() {
            break;
        }

        let page_index = page_index as u32;
        // DET-07: 헤더/푸터 등 사용자가 지정한 제외 영역의 문자는 애초에
        // 검출 대상 텍스트에서 빼버린다 — detect_in_page의 char 인덱스 기반
        // 위치 계산 로직 자체는 그대로 두고, 여기 호출부에서만 걸러낸다.
        let chars = filter_excluded_chars(extract_page_chars(&page), page_index, exclusion_zones);
        crate::detection::detect_in_page(&chars, page_index, &rules, &now, &mut next_id, &mut items);

        on_progress(page_index + 1, page_count);
    }

    Ok(items)
}

/// 진행률·취소·제외 영역이 필요 없는 호출부(테스트 등)를 위한 간단한 형태.
pub fn detect_review_items(path: &Path) -> Result<Vec<crate::sidecar::ReviewItem>, String> {
    detect_review_items_with_progress(path, &[], |_, _| {}, || false)
}

/// IO-03(§5.4): 재앵커링 요청 하나 — 어느 페이지에서 어떤 내용 텍스트를
/// 찾을지. `$파일명`+페이지로 대상 페이지까지는 이미 좁혀졌다는 전제(호출부가
/// 현재 열린 문서의 page 번호로 채운다).
#[derive(Debug, Clone, Deserialize)]
pub struct ReanchorRequest {
    pub page_index: u32,
    pub content: String,
}

/// 문서를 한 번만 열어 여러 요청을 처리한다(같은 페이지를 참조하는 요청이
/// 여러 개여도 그 페이지의 문자 추출은 한 번만). 페이지 텍스트 레이어에서
/// content를 찾으면 그 위치의 bbox를, 못 찾으면(내용이 바뀌었거나 스캔본이
/// 된 경우 등) None을 반환한다 — 호출부(IO-03)가 None이면 `$bbox`로 폴백하고
/// '위치확인 필요'로 표시한다.
pub fn reanchor_bboxes(
    path: &Path,
    requests: &[ReanchorRequest],
) -> Result<Vec<Option<crate::sidecar::RelativeBBox>>, String> {
    let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let document = load_document(path)?;

    let mut page_chars_cache: std::collections::HashMap<u32, Vec<PositionedChar>> =
        std::collections::HashMap::new();
    let mut results = Vec::with_capacity(requests.len());

    for request in requests {
        if !page_chars_cache.contains_key(&request.page_index) {
            let chars = document
                .pages()
                .get(request.page_index as i32)
                .map(|page| extract_page_chars(&page))
                .unwrap_or_default();
            page_chars_cache.insert(request.page_index, chars);
        }
        let chars = &page_chars_cache[&request.page_index];
        let text: String = chars.iter().map(|c| c.ch).collect();

        let found = text.find(&request.content).map(|start_byte| {
            let start_char = text[..start_byte].chars().count();
            let end_char = start_char + request.content.chars().count();
            crate::detection::merge_bbox(&chars[start_char..end_char])
        });
        results.push(found);
    }

    Ok(results)
}

/// 문자 하나의 bbox 중심점이 대상 영역(페이지 상대좌표) 안에 있는지.
fn bbox_center_within(
    inner: &crate::sidecar::RelativeBBox,
    outer: &crate::sidecar::RelativeBBox,
) -> bool {
    let cx = inner.x + inner.width / 2.0;
    let cy = inner.y + inner.height / 2.0;
    cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height
}

/// EDIT-10: 주어진 bbox(페이지 상대좌표 0~1) 안(글자 중심점 기준)에 든 글자들의
/// 텍스트를 추출한다. bbox 리사이즈/이동 후 그 영역이 실제로 덮는 텍스트를 목록
/// content로 갱신해, 사용자가 최종 검출 텍스트를 확인·조정하게 한다(블랙마킹 적용
/// 후 searchable 잔존 여부를 사전에 눈으로 확인). 글자는 페이지 읽기 순서를 그대로
/// 유지한다.
pub fn extract_text_in_bbox(
    path: &Path,
    page_index: u32,
    bbox: &crate::sidecar::RelativeBBox,
) -> Result<String, String> {
    let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let document = load_document(path)?;
    let chars = document
        .pages()
        .get(page_index as i32)
        .map(|page| extract_page_chars(&page))
        .unwrap_or_default();

    let text: String =
        chars.iter().filter(|c| bbox_center_within(&c.bbox, bbox)).map(|c| c.ch).collect();
    Ok(text.trim().to_string())
}

/// BM-01: 북마크(outline) 트리의 한 노드(§6.2).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkNode {
    pub title: String,
    /// 이 북마크가 가리키는 페이지(0-indexed). 외부 링크 등 페이지 목적지가
    /// 없는 북마크는 None — 프론트에서는 클릭해도 페이지 이동만 생략한다.
    pub page_index: Option<u32>,
    pub children: Vec<BookmarkNode>,
}

fn bookmark_page_index(bookmark: &PdfBookmark) -> Option<u32> {
    if let Some(destination) = bookmark.destination() {
        if let Ok(index) = destination.page_index() {
            return Some(index as u32);
        }
    }

    if let Some(PdfAction::LocalDestination(local)) = bookmark.action() {
        if let Ok(index) = local.destination().and_then(|d| d.page_index()) {
            return Some(index as u32);
        }
    }

    None
}

/// 형제 목록을 재귀적으로 순회해 트리를 만든다. pdfium 자체는 순환 그래프를
/// 방어하지 않으므로(내부 반복자도 별도의 visited 집합을 둠), 손상된 PDF의
/// 순환 북마크 그래프로 인한 무한 재귀를 막기 위해 방문한 노드를 추적한다.
fn build_bookmark_siblings<'a>(
    first: Option<PdfBookmark<'a>>,
    visited: &mut HashSet<PdfBookmark<'a>>,
) -> Vec<BookmarkNode> {
    let mut nodes = Vec::new();
    let mut current = first;

    while let Some(bookmark) = current {
        if !visited.insert(bookmark.clone()) {
            break;
        }

        nodes.push(BookmarkNode {
            title: bookmark.title().unwrap_or_default(),
            page_index: bookmark_page_index(&bookmark),
            children: build_bookmark_siblings(bookmark.first_child(), visited),
        });

        current = bookmark.next_sibling();
    }

    nodes
}

/// 문서의 북마크(outline) 트리를 추출한다(§6.2). 북마크가 없는 문서는 빈 목록.
pub fn extract_bookmarks(path: &Path) -> Result<Vec<BookmarkNode>, String> {
    let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let document = load_document(path)?;
    let mut visited = HashSet::new();
    Ok(build_bookmark_siblings(document.bookmarks().root(), &mut visited))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_path(filename: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("pdf-samples")
            .join(filename)
    }

    fn char_at(x: f32, y: f32) -> PositionedChar {
        PositionedChar {
            ch: 'x',
            bbox: crate::sidecar::RelativeBBox { x, y, width: 0.01, height: 0.01 },
        }
    }

    #[test]
    fn is_bbox_excluded_detects_top_and_bottom_bands() {
        let margins =
            crate::sidecar::PageExclusionMargins { top: 0.1, bottom: 0.1, left: 0.0, right: 0.0 };

        assert!(is_bbox_excluded(&char_at(0.5, 0.05).bbox, &margins)); // 상단 밴드 안
        assert!(is_bbox_excluded(&char_at(0.5, 0.95).bbox, &margins)); // 하단 밴드 안
        assert!(!is_bbox_excluded(&char_at(0.5, 0.5).bbox, &margins)); // 중앙, 제외 아님
    }

    #[test]
    fn is_bbox_excluded_detects_left_and_right_bands() {
        let margins =
            crate::sidecar::PageExclusionMargins { top: 0.0, bottom: 0.0, left: 0.1, right: 0.1 };

        assert!(is_bbox_excluded(&char_at(0.05, 0.5).bbox, &margins));
        assert!(is_bbox_excluded(&char_at(0.95, 0.5).bbox, &margins));
        assert!(!is_bbox_excluded(&char_at(0.5, 0.5).bbox, &margins));
    }

    #[test]
    fn is_bbox_excluded_all_zero_margins_excludes_nothing() {
        let margins = crate::sidecar::PageExclusionMargins { top: 0.0, bottom: 0.0, left: 0.0, right: 0.0 };
        assert!(!is_bbox_excluded(&char_at(0.0, 0.0).bbox, &margins));
        // 0.99(코너 근처지만 중심점이 폭 절반을 더해도 1.0을 안 넘는 위치) —
        // char_at의 bbox width/height가 0.01이라 x=1.0이면 중심이 1.005로
        // 페이지 밖까지 넘어가 버려 진짜 "제외 없음" 케이스를 테스트하지
        // 못한다.
        assert!(!is_bbox_excluded(&char_at(0.99, 0.99).bbox, &margins));
    }

    #[test]
    fn filter_excluded_chars_only_affects_the_matching_page() {
        let chars = vec![char_at(0.5, 0.05), char_at(0.5, 0.5)];
        let zones = vec![crate::sidecar::PageExclusionZone {
            page_index: 3,
            margins: crate::sidecar::PageExclusionMargins { top: 0.1, bottom: 0.0, left: 0.0, right: 0.0 },
        }];

        // 설정이 있는 페이지(3): 상단 문자만 걸러짐.
        let filtered = filter_excluded_chars(chars.clone(), 3, &zones);
        assert_eq!(filtered.len(), 1);

        // 설정이 없는 다른 페이지(0): 그대로 통과.
        let unfiltered = filter_excluded_chars(chars, 0, &zones);
        assert_eq!(unfiltered.len(), 2);
    }

    #[test]
    fn open_document_info_returns_path_filename_and_page_count() {
        let path = sample_path("BZB000877_01.pdf");
        let info = open_document_info(&path).expect("PDF 로드 실패");

        assert_eq!(info.filename, "BZB000877_01.pdf");
        assert_eq!(info.page_count, 4);
        assert_eq!(info.path, path.to_string_lossy());
    }

    #[test]
    fn open_document_info_reports_correct_page_count_for_single_page_pdf() {
        let info = open_document_info(&sample_path("KKZ000160_01.pdf")).expect("PDF 로드 실패");
        assert_eq!(info.page_count, 1);
    }

    #[test]
    fn open_document_info_fails_for_corrupted_pdf_without_panicking() {
        let result = open_document_info(&sample_path("corrupted.pdf"));
        assert!(result.is_err());
    }

    #[test]
    fn open_document_info_reports_has_text_for_a_page_with_extractable_text() {
        // pdftotext로 사전 확인: KKZ000160_01.pdf 1페이지에는 실제 텍스트가 있음.
        let info = open_document_info(&sample_path("KKZ000160_01.pdf")).expect("PDF 로드 실패");
        assert_eq!(info.page_dimensions.len(), 1);
        assert_eq!(info.page_dimensions[0].text_layer_status, TextLayerStatus::HasText);
        assert_eq!(info.page_dimensions[0].page_number, 1);
        assert!(info.page_dimensions[0].page_width > 0.0);
        assert!(info.page_dimensions[0].page_height > 0.0);
    }

    #[test]
    fn detect_review_items_finds_a_real_phone_pattern_in_a_sample_pdf() {
        // pdftotext로 사전 확인: KKZ000160_01.pdf에는 "011-212-7448" 등 실제
        // 전화번호(구형 프리픽스 포함)가 들어있어, DET-01 파이프라인이 실제
        // 문서에서도 후보를 만들어내는지 구조적으로 검증할 수 있다. (BZB000877은
        // anchor 없는 날짜뿐이라, 생년월일 anchor 필수화 이후로는 0건 검출된다.)
        let items = detect_review_items(&sample_path("KKZ000160_01.pdf")).expect("검출 실패");

        let phone_item = items
            .iter()
            .find(|item| item.category == "PhoneNumber")
            .expect("전화번호 후보를 하나도 찾지 못함");

        assert_eq!(phone_item.origin, crate::sidecar::ReviewItemOrigin::Detected);
        assert!(phone_item.bbox.width > 0.0 && phone_item.bbox.height > 0.0);
        assert!(phone_item.bbox.x >= 0.0 && phone_item.bbox.y >= 0.0);
        // 검출된 모든 후보의 id가 서로 달라야 한다("r-0", "r-1", ...).
        let mut ids: Vec<&str> = items.iter().map(|item| item.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), items.len());
    }

    #[test]
    fn reanchor_bboxes_finds_content_detected_earlier_on_the_same_page() {
        // DET-01이 실제로 찾아낸 (page, content)를 IO-03 재탐색에 그대로
        // 넣으면 같은 bbox가 나와야 한다 — 같은 텍스트 위치 계산 경로이므로.
        let path = sample_path("KKZ000160_01.pdf");
        let items = detect_review_items(&path).expect("검출 실패");
        let item = items.first().expect("검출된 항목이 있어야 함");

        let requests = vec![ReanchorRequest { page_index: item.page, content: item.content.clone() }];
        let results = reanchor_bboxes(&path, &requests).expect("재앵커링 실패");

        assert_eq!(results.len(), 1);
        let bbox = results[0].expect("내용을 찾았어야 함");
        assert!((bbox.x - item.bbox.x).abs() < 0.001);
        assert!((bbox.y - item.bbox.y).abs() < 0.001);
    }

    #[test]
    fn extract_text_in_bbox_returns_text_under_the_box() {
        // 검출된 항목의 bbox로 텍스트를 재추출하면 그 항목 내용과 일치(또는 포함)해야
        // 한다 — EDIT-10에서 리사이즈 후 content 갱신의 기반.
        let path = sample_path("KKZ000160_01.pdf");
        let items = detect_review_items(&path).expect("검출 실패");
        let item = items.first().expect("검출된 항목이 있어야 함");

        let text = extract_text_in_bbox(&path, item.page, &item.bbox).expect("추출 실패");
        assert!(!text.is_empty());
        assert!(
            text.contains(&item.content) || item.content.contains(&text),
            "추출 '{text}' vs 검출 '{}'",
            item.content
        );
    }

    #[test]
    fn extract_text_in_bbox_is_empty_for_a_box_with_no_text() {
        // 텍스트가 없는 위치(아주 작은 빈 영역)는 빈 문자열.
        let path = sample_path("KKZ000160_01.pdf");
        let empty = crate::sidecar::RelativeBBox { x: 0.001, y: 0.001, width: 0.0005, height: 0.0005 };
        let text = extract_text_in_bbox(&path, 0, &empty).expect("추출 실패");
        assert_eq!(text, "");
    }

    #[test]
    fn reanchor_bboxes_returns_none_when_content_not_found() {
        let path = sample_path("BZB000877_01.pdf");
        let requests =
            vec![ReanchorRequest { page_index: 0, content: "존재하지않는텍스트12345XYZ".into() }];

        let results = reanchor_bboxes(&path, &requests).expect("재앵커링 실패");

        assert_eq!(results, vec![None]);
    }

    #[test]
    fn reanchor_bboxes_handles_multiple_requests_on_the_same_page() {
        let path = sample_path("KKZ000160_01.pdf");
        let items = detect_review_items(&path).expect("검출 실패");
        let item = items.first().expect("검출된 항목이 있어야 함");

        let requests = vec![
            ReanchorRequest { page_index: item.page, content: item.content.clone() },
            ReanchorRequest { page_index: item.page, content: item.content.clone() },
        ];
        let results = reanchor_bboxes(&path, &requests).expect("재앵커링 실패");

        assert_eq!(results.len(), 2);
        assert!(results[0].is_some());
        assert!(results[1].is_some());
    }

    #[test]
    fn detect_review_items_with_progress_reports_one_call_per_page() {
        use std::sync::atomic::{AtomicU32, Ordering};

        let calls = AtomicU32::new(0);
        let last_total = AtomicU32::new(0);

        let items = detect_review_items_with_progress(
            &sample_path("BZB000877_01.pdf"),
            &[],
            |processed, total| {
                calls.fetch_add(1, Ordering::SeqCst);
                last_total.store(total, Ordering::SeqCst);
                assert!(processed <= total);
            },
            || false,
        )
        .expect("검출 실패");

        assert_eq!(last_total.load(Ordering::SeqCst), 4); // BZB000877_01.pdf는 4페이지.
        assert_eq!(calls.load(Ordering::SeqCst), 4);
        // 이 테스트는 "페이지당 진행 콜백 1회"만 검증한다 — BZB000877은 anchor
        // 없는 날짜뿐이라 검출 0건일 수 있으므로 검출 건수는 단언하지 않는다.
        let _ = items;
    }

    #[test]
    fn detect_review_items_with_progress_stops_early_when_cancelled() {
        // 첫 페이지 처리 후 취소하면, 그 이후 페이지는 건드리지 않고(에러 아님)
        // 그때까지 찾은 항목만 반환해야 한다(§6.3.1 취소 = 부분 결과).
        let processed_count = std::sync::atomic::AtomicU32::new(0);

        let items = detect_review_items_with_progress(
            &sample_path("BZB000877_01.pdf"),
            &[],
            |_, _| {
                processed_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            },
            || processed_count.load(std::sync::atomic::Ordering::SeqCst) >= 1,
        )
        .expect("검출 실패");

        assert_eq!(processed_count.load(std::sync::atomic::Ordering::SeqCst), 1);
        // 취소 전 1페이지만 처리했으므로, 전체(4페이지) 결과보다 항목이 적거나 같아야 한다.
        let full = detect_review_items(&sample_path("BZB000877_01.pdf")).expect("검출 실패");
        assert!(items.len() <= full.len());
    }

    #[test]
    fn text_fingerprint_has_expected_sha256_format() {
        let info = open_document_info(&sample_path("KKZ000160_01.pdf")).expect("PDF 로드 실패");
        let hex = info
            .text_fingerprint
            .strip_prefix("sha256:")
            .expect("sha256: 접두가 있어야 함");
        assert_eq!(hex.len(), 64);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn text_fingerprint_is_deterministic_for_the_same_file() {
        let path = sample_path("KKZ000160_01.pdf");
        let first = open_document_info(&path).expect("PDF 로드 실패").text_fingerprint;
        let second = open_document_info(&path).expect("PDF 로드 실패").text_fingerprint;
        assert_eq!(first, second);
    }

    #[test]
    fn text_fingerprint_differs_for_documents_with_different_text() {
        let a = open_document_info(&sample_path("KKZ000160_01.pdf"))
            .expect("PDF 로드 실패")
            .text_fingerprint;
        let b = open_document_info(&sample_path("BZB000877_01.pdf"))
            .expect("PDF 로드 실패")
            .text_fingerprint;
        assert_ne!(a, b);
    }

    #[test]
    fn text_fingerprint_is_unchanged_after_adding_an_annotation() {
        // KKZ000160_01-annotated.pdf는 원본에 텍스트 주석(코멘트)만 추가한 사본
        // (pypdf로 생성, pdftotext 추출 결과가 원본과 동일함을 별도로 확인함).
        // §4.4: 주석 추가는 text_fingerprint에 영향을 주면 안 된다.
        let original = open_document_info(&sample_path("KKZ000160_01.pdf"))
            .expect("PDF 로드 실패")
            .text_fingerprint;
        let annotated = open_document_info(&sample_path("KKZ000160_01-annotated.pdf"))
            .expect("PDF 로드 실패")
            .text_fingerprint;
        assert_eq!(original, annotated);
    }

    #[test]
    fn extract_bookmarks_returns_flat_list_with_titles_and_page_indices() {
        // pypdf로 사전 확인한 BZB000877_01.pdf의 실제 outline(5개, 모두 최상위,
        // 0-indexed 페이지): 표지→0, ...→1, ...→2, ...→3, ...→3.
        let bookmarks = extract_bookmarks(&sample_path("BZB000877_01.pdf")).expect("추출 실패");

        assert_eq!(bookmarks.len(), 5);
        assert_eq!(bookmarks[0].title, "표지");
        assert_eq!(bookmarks[0].page_index, Some(0));
        assert!(bookmarks.iter().all(|node| node.children.is_empty()));

        let page_indices: Vec<Option<u32>> = bookmarks.iter().map(|n| n.page_index).collect();
        assert_eq!(page_indices, vec![Some(0), Some(1), Some(2), Some(3), Some(3)]);
    }

    #[test]
    fn extract_bookmarks_returns_empty_list_for_document_without_bookmarks() {
        let bookmarks = extract_bookmarks(&sample_path(
            "한국전쟁기 의료지원 연구 - 미 제8군 육군이동외과병원의 활동을 중심으로.pdf",
        ))
        .expect("추출 실패");

        assert!(bookmarks.is_empty());
    }

    #[test]
    fn extract_bookmarks_fails_for_corrupted_pdf_without_panicking() {
        let result = extract_bookmarks(&sample_path("corrupted.pdf"));
        assert!(result.is_err());
    }

    // 샘플 PDF들은 페이지 원본 크기가 매우 커서(예: ~2500x3500pt) scale=1.0만 돼도
    // 수 MP짜리 비트맵이 나온다. 테스트에서는 정확성만 확인하면 되므로 작은 scale로
    // 렌더/PNG 인코딩 시간을 줄인다(디버그 빌드에서 PNG 인코딩은 최적화 영향을 거의
    // 받지 않는 제네릭 코드라 픽셀 수에 선형 비례해 느려짐).
    const TEST_SCALE: f32 = 0.1;

    #[test]
    fn render_page_preserves_page_aspect_ratio() {
        let path = sample_path("BZB000877_01.pdf");
        let rendered = render_page(&path, 0, TEST_SCALE).expect("렌더링 실패");

        assert_eq!(rendered.page_index, 0);
        assert!(rendered.width > 0 && rendered.height > 0);

        let page_ratio = rendered.page_width_pt / rendered.page_height_pt;
        let pixel_ratio = rendered.width as f32 / rendered.height as f32;
        assert!(
            (page_ratio - pixel_ratio).abs() < 0.01,
            "페이지 비율({page_ratio})과 렌더 비율({pixel_ratio})이 달라 정확한 비율로 표시되지 않음"
        );
    }

    #[test]
    fn render_page_produces_valid_png_matching_reported_dimensions() {
        let rendered =
            render_page(&sample_path("BZB000877_01.pdf"), 0, TEST_SCALE).expect("렌더링 실패");

        let png_bytes = STANDARD.decode(&rendered.png_base64).expect("base64 디코딩 실패");
        let decoded = image::load_from_memory(&png_bytes).expect("PNG 디코딩 실패");

        assert_eq!(decoded.width(), rendered.width);
        assert_eq!(decoded.height(), rendered.height);
    }

    #[test]
    fn render_page_scale_up_produces_proportionally_larger_bitmap() {
        let path = sample_path("BZB000877_01.pdf");
        let at_1x = render_page(&path, 0, TEST_SCALE).expect("렌더링 실패");
        let at_2x = render_page(&path, 0, TEST_SCALE * 2.0).expect("렌더링 실패");

        assert!((at_2x.width as f32 / at_1x.width as f32 - 2.0).abs() < 0.05);
        assert!((at_2x.height as f32 / at_1x.height as f32 - 2.0).abs() < 0.05);
    }

    #[test]
    fn render_page_reports_error_for_out_of_range_page_index() {
        let result = render_page(&sample_path("KKZ000160_01.pdf"), 5, 1.0);
        assert!(result.is_err());
    }
}

#[cfg(test)]
mod smoke_large_sample {
    use super::*;

    fn large_sample_path() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("pdf-samples")
            .join("ZZ0001964_01.pdf")
    }

    #[test]
    #[ignore]
    fn loads_large_262_page_sample() {
        let info = open_document_info(&large_sample_path()).expect("PDF 로드 실패");
        assert_eq!(info.page_count, 262);
    }

    fn count_bookmark_nodes(nodes: &[BookmarkNode]) -> usize {
        nodes
            .iter()
            .map(|node| 1 + count_bookmark_nodes(&node.children))
            .sum()
    }

    #[test]
    #[ignore]
    fn extract_bookmarks_builds_nested_tree_for_large_sample() {
        // pypdf로 사전 확인: 총 104개 노드, 최상위 다수 + 일부 중첩(예: "표지: ..."는
        // 최상위, "공문: '늦봄 문익환 목사...'" 항목은 자식 3개를 가짐).
        let bookmarks = extract_bookmarks(&large_sample_path()).expect("추출 실패");

        assert_eq!(count_bookmark_nodes(&bookmarks), 104);
        assert_eq!(bookmarks[0].title, "표지:  영화인대책위");
        assert_eq!(bookmarks[0].page_index, Some(0));

        let nested_parent = bookmarks
            .iter()
            .find(|node| !node.children.is_empty())
            .expect("중첩된 북마크가 있어야 함");
        assert!(nested_parent.children.len() >= 3);
    }

    #[test]
    #[ignore]
    fn open_document_info_computes_text_layer_status_for_every_page_of_large_sample() {
        // pdftotext -f N -l N으로 사전 확인: 262p 중 225, 262페이지(1-indexed)만
        // 실제로 텍스트가 비어 있는 스캔본이고 나머지는 텍스트가 있다.
        let started = std::time::Instant::now();
        let info = open_document_info(&large_sample_path()).expect("PDF 로드 실패");
        let elapsed = started.elapsed();

        assert_eq!(info.page_dimensions.len(), 262);

        let no_text_pages: Vec<u32> = info
            .page_dimensions
            .iter()
            .filter(|p| p.text_layer_status == TextLayerStatus::NoText)
            .map(|p| p.page_number)
            .collect();
        assert_eq!(no_text_pages, vec![225, 262]);

        // §9.1 목표(파일 열기 ≤2s)는 release 기준(QA-01에서 정식 측정). 여기서는
        // 텍스트 레이어 산출 추가로 디버그 빌드에서도 비정상적으로 느려지지
        // 않는지만 넉넉한 여유로 확인한다.
        assert!(
            elapsed.as_secs() < 10,
            "262p 문서의 텍스트 레이어 산출이 비정상적으로 오래 걸림: {elapsed:?}"
        );
    }

    #[test]
    #[ignore]
    fn renders_first_middle_and_last_page_of_large_sample() {
        // PDF-05: 262p·71MB 문서에서도 임의 페이지를 문제 없이 렌더할 수 있는지
        // 확인한다. render_page는 매 호출마다 문서를 새로 열고 함수 종료 시
        // 즉시 드롭하므로(§ load_document), 여러 페이지를 연달아 렌더해도
        // 이전 페이지의 상태가 누적되지 않는다(메모리 상한 대응의 전제).
        let path = large_sample_path();
        for page_index in [0u32, 130, 261] {
            let rendered = render_page(&path, page_index, 0.1)
                .unwrap_or_else(|err| panic!("페이지 {page_index} 렌더링 실패: {err}"));
            assert_eq!(rendered.page_index, page_index);
            assert!(rendered.width > 0 && rendered.height > 0);
        }
    }
}
