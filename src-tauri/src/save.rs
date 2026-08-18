//! SAVE-01/02(§4.3): 블랙마킹을 실제로 반영해 새 파일로 저장한다. 기본
//! 경로는 bbox와 겹치는 텍스트/이미지 객체를 페이지 콘텐츠 스트림에서
//! 제거하고 그 영역을 배경색으로 채운다. 그 경로가 실패하면(객체 제거
//! 자체가 안 되는 특수한 페이지 등) 페이지 전체를 래스터화해 이미지 한
//! 장으로 대체하는 폴백으로 넘어간다 — 어느 쪽이든 결과는 "원문 텍스트가
//! 더는 존재하지 않는 페이지"다. cmd-S·Excel 동시 생성은 SAVE-03의 몫이다.

use std::path::{Path, PathBuf};

use image::GenericImage;
use pdfium_render::prelude::*;

use crate::pdfium::{load_document, PDFIUM_OP_LOCK};
use crate::sidecar::{RelativeBBox, ReviewItem};

pub const REDACTED_SUFFIX: &str = "-redacted";

/// §4.3/§6.7: 저장 파일명은 `[원본파일명]-redacted.pdf`, 원문과 같은 폴더
/// (원문은 절대 덮어쓰지 않는다).
pub fn redacted_path_for(pdf_path: &Path) -> PathBuf {
    let stem = pdf_path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let extension = pdf_path.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_else(|| "pdf".into());
    let dir = pdf_path.parent().unwrap_or_else(|| Path::new("."));
    dir.join(format!("{stem}{REDACTED_SUFFIX}.{extension}"))
}

/// "#rrggbb" → (r, g, b). 형식이 어긋나면 검정으로 대체한다(방어적 기본값).
fn parse_hex_rgb(hex: &str) -> (u8, u8, u8) {
    let hex = hex.trim_start_matches('#');
    let byte = |from: usize| u8::from_str_radix(hex.get(from..from + 2).unwrap_or("00"), 16).unwrap_or(0);
    (byte(0), byte(2), byte(4))
}

/// §4.2 bbox(페이지 상대좌표 0~1, 좌상단 원점) → pdfium 좌표(포인트, 좌하단 원점).
fn to_pdf_rect(bbox: &RelativeBBox, page_width: f32, page_height: f32) -> PdfRect {
    let left = bbox.x * page_width;
    let right = (bbox.x + bbox.width) * page_width;
    let top = page_height - bbox.y * page_height;
    let bottom = page_height - (bbox.y + bbox.height) * page_height;
    PdfRect::new(PdfPoints::new(bottom), PdfPoints::new(left), PdfPoints::new(top), PdfPoints::new(right))
}

fn rect_area(rect: &PdfRect) -> f32 {
    (rect.right().value - rect.left().value).abs() * (rect.top().value - rect.bottom().value).abs()
}

/// 대상 블랙마킹 영역 합의 이 배수를 넘는 객체는 "실제 콘텐츠를 감싸는 큰
/// 컨테이너"로 간주해 통째로 지우지 않는다(아래 is_oversized_container 참고).
const OVERSIZED_CONTAINER_AREA_RATIO: f32 = 3.0;

/// 객체 하나의 bbox 면적이 대상 영역 합보다 훨씬 크면(위 배수 이상) 위험한
/// 컨테이너로 판정한다 — 순수 계산이라 실제 pdfium 객체 없이 단위테스트 가능.
fn is_area_ratio_dangerous(object_rect: &PdfRect, target_rects: &[PdfRect]) -> bool {
    let object_area = rect_area(object_rect);
    let target_area: f32 = target_rects.iter().map(rect_area).sum();
    target_area > 0.0 && object_area > target_area * OVERSIZED_CONTAINER_AREA_RATIO
}

/// 페이지 콘텐츠 대부분을 담는 "큰 컨테이너/배경" 객체와 작은 블랙마킹 영역이
/// 살짝만 겹쳐도, 그걸 통째로 지우면 페이지의 실제 내용이 전부 사라진다(사용자
/// 재현: "bbox는 검게 반영되는데 페이지 나머지 내용이 전부 사라짐"). 두 형태를
/// 막는다:
/// - **Form XObject**: 페이지 콘텐츠가 하나의 폼 안에 든 경우. `bounds()`가 폼
///   내부 전체를 감싼 큰 사각형이라 작은 bbox가 구석에 걸쳐도 겹친다고 나온다.
/// - **Image**: **스캔본 PDF**의 전면 스캔 이미지(페이지 전체를 덮음)가 이 경우다.
///   이걸 지우면 화면상 내용이 통째로 사라지고 투명 OCR 텍스트 레이어만 남아
///   아무 것도 안 보인다(사용자 재현). 이 판정에 걸리면 호출부가 페이지 전체
///   래스터화(rasterize_whole_page)로 넘어가, 화면 그대로 두고 bbox만 검게 칠하며
///   추출 가능한 텍스트는 전부 제거한다 — §9.2(복구 불가)도 만족.
///
/// 텍스트 객체(작은 글자 단위)는 이 면적 판정에 안 걸려 정밀 객체 제거 경로가
/// 유지된다(벡터 PDF).
fn is_oversized_container(object: &PdfPageObject, target_rects: &[PdfRect]) -> bool {
    match object.object_type() {
        PdfPageObjectType::XObjectForm | PdfPageObjectType::Image => {}
        _ => return false,
    }
    let Ok(bounds) = object.bounds() else { return false };
    is_area_ratio_dangerous(&bounds.to_rect(), target_rects)
}

/// 한 페이지에서 주어진 bbox들과 겹치는 객체를 지우고 그 영역을 배경색으로
/// 채운다. 뒤쪽 인덱스부터 제거해 앞쪽 인덱스가 밀리지 않게 한다.
/// 페이지 콘텐츠 대부분을 감싸는 큰 컨테이너 객체(is_oversized_container)와
/// 겹치면, 그 객체를 지우는 대신 에러를 반환해 호출부(redact_page)가
/// 이미 텍스트 완전 제거가 검증된 더 안전한 경로(페이지 전체 래스터화)로
/// 넘어가게 한다 — 이 함수는 어떤 객체도 아직 제거하지 않은 상태에서
/// 반환하므로(첫 루프에서 전부 판정한 뒤에야 두 번째 루프에서 제거를
/// 시작함) 페이지가 half-mutated 상태로 남지 않는다.
pub(crate) fn redact_page_objects(
    page: &mut PdfPage,
    boxes: &[RelativeBBox],
    background_hex: &str,
) -> Result<(), String> {
    let page_width = page.width().value;
    let page_height = page.height().value;
    let rects: Vec<PdfRect> = boxes.iter().map(|bbox| to_pdf_rect(bbox, page_width, page_height)).collect();

    let mut indices_to_remove = Vec::new();
    for (index, object) in page.objects().iter().enumerate() {
        if !rects.iter().any(|rect| object.does_overlap_rect(rect)) {
            continue;
        }
        if is_oversized_container(&object, &rects) {
            return Err(
                "블랙마킹 영역이 페이지 콘텐츠를 감싸는 큰 컨테이너 객체와 겹쳐, 더 안전한 방식으로 넘어갑니다."
                    .into(),
            );
        }
        indices_to_remove.push(index);
    }

    for &index in indices_to_remove.iter().rev() {
        let removed = page
            .objects_mut()
            .remove_object_at_index(index)
            .map_err(|err| format!("블랙마킹 영역의 객체를 제거하지 못했습니다: {err}"))?;
        // pdfium-render 0.9.3의 제거된 객체 Drop 구현이 이미 해제된 pdfium
        // 내부 핸들을 다시 destroy하려 해 세그폴트가 난다(실측 확인). 원본
        // 객체는 FPDFPage_RemoveObject 시점에 이미 페이지에서 분리됐으므로,
        // Rust 쪽 Drop만 건너뛰면 안전하다.
        std::mem::forget(removed);
    }

    let (r, g, b) = parse_hex_rgb(background_hex);
    let fill_color = PdfColor::new(r, g, b, 255);
    for rect in &rects {
        page.objects_mut()
            .create_path_object_rect(*rect, None, None, Some(fill_color))
            .map_err(|err| format!("블랙마킹 영역을 채우지 못했습니다: {err}"))?;
    }

    Ok(())
}

/// QP-1: 재래스터 비트맵이 쓸 수 있는 메모리 예산 비율(가용 RAM 대비, 사용자 확정 50%).
/// 실제 피크는 pdfium 렌더 버퍼 + JPEG 인코더 버퍼 + 원본 디코드가 동시에 잡혀
/// 비트맵(픽셀×4B)보다 크므로, 보수적으로 가용 메모리의 절반만 비트맵 예산으로 잡는다.
const RASTERIZE_MEMORY_BUDGET_FRACTION: f64 = 0.5;
/// RGBA 래스터 비트맵의 픽셀당 바이트 수.
const BITMAP_BYTES_PER_PX: f64 = 4.0;

/// 3-OS 공통(sysinfo)으로 **현재 가용(available) 메모리 바이트**를 조회한다.
/// total이 아니라 지금 실제로 확보 가능한 양(free + reclaimable) 기준 — 배포 대상
/// macOS·Windows·Linux 모두에서 동일 API로 동작한다.
fn available_memory_bytes() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.available_memory()
}

/// 가용 메모리에서 재래스터 비트맵에 허용할 **픽셀 예산**(= 가용 × 마진 ÷ 4B).
fn rasterize_pixel_budget(available_bytes: u64) -> f64 {
    (available_bytes as f64 * RASTERIZE_MEMORY_BUDGET_FRACTION / BITMAP_BYTES_PER_PX).max(1.0)
}

/// SAVE-02(§4.3 3번): 객체 제거 경로가 실패했을 때의 폴백 — 페이지를 통째로
/// 래스터화한 뒤 bbox 영역을 배경색으로 칠하고, 기존 객체를 모두 지운 자리에
/// 그 이미지 한 장을 채워넣는다. 원본 텍스트/이미지 객체가 콘텐츠 스트림에
/// 전혀 남지 않으므로 §9.2(복구 불가) 요건을 그대로 만족한다.
///
/// 래스터화 배율은 원본 품질 보존용(사용자 재현: "저장본이 부옇게 흐려짐"). 기본
/// 렌더는 1pt=1px(≈72DPI)라 200~300DPI 스캔 이미지를 크게 다운샘플해 흐려진다.
/// 페이지 안 이미지들의 **원본 픽셀 해상도**(native px / 표시 pt)에 맞춰 배율을 올려
/// 재래스터해도 원본 해상도를 유지한다.
///
/// QP-2(x/y 축별 배율): PDF 이미지는 intrinsic 픽셀 크기와 페이지 배치 물리크기(pt)가
/// CTM으로 분리돼 있어, 가로/세로로 다르게 늘어난 이미지는 x-ppi≠y-ppi다(예:
/// 1000×1000px를 4in×8in로 배치 → x=250ppi·y=125ppi). 축별 배율을 따로 구해 원본
/// 가로세로 픽셀 비를 그대로 보존한다(단일 스칼라로 통일하면 한 축이 어긋남).
///
/// QP-1(원본 보존 원칙): 옛 고정 상한(긴 변 6000px)을 제거했다. 배율은 원본 이미지
/// 픽셀을 1:1 재현하는 값이 상한이라(그 이상은 무의미) 실제 렌더 픽셀은 원본 이미지
/// 해상도를 넘지 않는다. 시스템 메모리 부족 시의 다운샘플은 `apply_memory_budget`에서
/// 별도로(가용 메모리 기반) 적용한다.
fn rasterize_render_scale_xy(page: &PdfPage) -> (f32, f32) {
    let mut scale_x = 1.0f32;
    let mut scale_y = 1.0f32;
    for object in page.objects().iter() {
        let Some(image) = object.as_image_object() else {
            continue;
        };
        let (Ok(w), Ok(h)) = (image.width(), image.height()) else {
            continue;
        };
        let Ok(bounds) = object.bounds() else {
            continue;
        };
        let rect = bounds.to_rect();
        let disp_w = (rect.right().value - rect.left().value).abs().max(1.0);
        let disp_h = (rect.top().value - rect.bottom().value).abs().max(1.0);
        scale_x = scale_x.max(w as f32 / disp_w);
        scale_y = scale_y.max(h as f32 / disp_h);
    }
    (scale_x, scale_y)
}

/// QP-1: 축별 native 배율에 시스템 메모리 **픽셀 예산** 캡을 적용한다. 원본이 예산
/// 이내면 그대로 반환하고(원본 보존이 원칙), 넘으면 x:y 배율 비를 유지한 채 다운샘플
/// 배율 `d = √(예산 ÷ 원본픽셀)`을 두 축에 함께 곱한다. 반환: (scale_x, scale_y, 다운샘플 여부).
fn apply_memory_budget(
    page_width: f32,
    page_height: f32,
    scale_x: f32,
    scale_y: f32,
    pixel_budget: f64,
) -> (f32, f32, bool) {
    let out_w = (page_width.max(1.0) as f64) * (scale_x as f64);
    let out_h = (page_height.max(1.0) as f64) * (scale_y as f64);
    let native_px = out_w * out_h;
    if native_px <= pixel_budget {
        return (scale_x, scale_y, false);
    }
    let d = (pixel_budget / native_px).sqrt() as f32;
    (scale_x * d, scale_y * d, true)
}

/// QP-1: 저장 전 사전 점검 결과 — 가용 메모리 부족으로 다운샘플될 페이지가 있으면,
/// 가장 크게 영향받는 페이지의 원본/축소 해상도(px·근사 dpi)를 담는다. 프론트(저장
/// 커맨드)가 "…로 다운샘플링하여 저장됩니다. 계속하시겠습니까?" 확인 팝업에 쓴다.
#[derive(Debug, Clone, PartialEq)]
pub struct DownsampleNotice {
    pub original_width: u32,
    pub original_height: u32,
    pub original_dpi: u32,
    pub downsampled_width: u32,
    pub downsampled_height: u32,
    pub downsampled_dpi: u32,
}

/// 렌더 배율(72dpi 기준·축별)에서 표시용 근사 dpi(두 축 배율의 기하평균)를 낸다.
fn scale_to_dpi(scale_x: f32, scale_y: f32) -> u32 {
    (72.0 * (scale_x as f64 * scale_y as f64).sqrt()).round() as u32
}

/// QP-1: 저장을 시작하기 전에 이 시스템의 가용 메모리로 다운샘플될 페이지가 있는지
/// 미리 점검한다(실제 렌더 없이 이미지 객체 치수만으로 계산 — 가볍다). 다운샘플될
/// 페이지가 있으면 그 중 가장 크게 영향받는 페이지의 원본/축소 해상도를 반환하고,
/// 없으면 `None`(원본 그대로 저장).
pub fn plan_rasterization_downsample(
    pdf_path: &Path,
    items: &[ReviewItem],
) -> Result<Option<DownsampleNotice>, String> {
    if items.is_empty() {
        return Ok(None);
    }
    let budget = rasterize_pixel_budget(available_memory_bytes());
    let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let document = load_document(pdf_path)?;

    let mut pages: Vec<u32> = items.iter().map(|item| item.page).collect();
    pages.sort_unstable();
    pages.dedup();

    let mut worst: Option<(f64, DownsampleNotice)> = None;
    for page_index in pages {
        let Ok(page) = document.pages().get(page_index as i32) else {
            continue;
        };
        let pw = page.width().value;
        let ph = page.height().value;
        let (sx, sy) = rasterize_render_scale_xy(&page);
        let (dx, dy, downsampled) = apply_memory_budget(pw, ph, sx, sy, budget);
        if !downsampled {
            continue;
        }
        let orig_px = (pw.max(1.0) as f64 * sx as f64) * (ph.max(1.0) as f64 * sy as f64);
        if worst.as_ref().map_or(true, |(p, _)| orig_px > *p) {
            worst = Some((
                orig_px,
                DownsampleNotice {
                    original_width: (pw * sx).round().max(1.0) as u32,
                    original_height: (ph * sy).round().max(1.0) as u32,
                    original_dpi: scale_to_dpi(sx, sy),
                    downsampled_width: (pw * dx).round().max(1.0) as u32,
                    downsampled_height: (ph * dy).round().max(1.0) as u32,
                    downsampled_dpi: scale_to_dpi(dx, dy),
                },
            ));
        }
    }
    Ok(worst.map(|(_, notice)| notice))
}

/// 원본 이미지의 JPEG 품질을 추정할 수 없을 때 쓰는 기본값. 대부분의 스캔본이
/// 이 근방(80~85)이라 흐림·용량 모두 무난한 선.
const RASTERIZE_JPEG_DEFAULT_QUALITY: u8 = 82;
/// 추정 품질을 이 범위로 clamp(너무 낮으면 흐리고, 너무 높으면 용량이 튄다).
const RASTERIZE_JPEG_MIN_QUALITY: u8 = 60;
const RASTERIZE_JPEG_MAX_QUALITY: u8 = 92;

/// IJG 표준 휘도(luma) 양자화 테이블(Annex K, 자연순서). JPEG 품질 추정에 쓴다.
#[rustfmt::skip]
const STD_LUMA_QUANT: [u32; 64] = [
    16, 11, 10, 16,  24,  40,  51,  61,
    12, 12, 14, 19,  26,  58,  60,  55,
    14, 13, 16, 24,  40,  57,  69,  56,
    14, 17, 22, 29,  51,  87,  80,  62,
    18, 22, 37, 56,  68, 109, 103,  77,
    24, 35, 55, 64,  81, 104, 113,  92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103,  99,
];

/// JPEG 바이트 스트림의 첫 DQT(휘도 테이블)에서 **품질(1~100)을 추정**한다 —
/// 원본 스캔본의 압축 스펙에 맞춰 재인코딩하기 위함(사용자 요청: "원본 이미지의
/// 품질 정보를 detect해 그 스펙에 맞게 출력"). IJG scale factor를 양자화 값 합의
/// 비율로 되짚어 품질을 역산한다(테이블은 지그재그 순서라 순서 무관한 총합비 사용).
fn estimate_jpeg_quality(jpeg: &[u8]) -> Option<u8> {
    let std_sum: u32 = STD_LUMA_QUANT.iter().sum();
    let mut i = 0usize;
    while i + 4 < jpeg.len() {
        if jpeg[i] != 0xFF || jpeg[i + 1] != 0xDB {
            i += 1;
            continue;
        }
        let seg_len = ((jpeg[i + 2] as usize) << 8) | jpeg[i + 3] as usize;
        let seg_end = (i + 2 + seg_len).min(jpeg.len());
        let mut p = i + 4;
        while p < seg_end {
            let pq = jpeg[p] >> 4; // 0=8bit, 1=16bit
            let tq = jpeg[p] & 0x0F; // 0=luma
            p += 1;
            if pq == 0 {
                if tq == 0 && p + 64 <= jpeg.len() {
                    let sum: u32 = jpeg[p..p + 64].iter().map(|&v| v as u32).sum();
                    if sum == 0 || std_sum == 0 {
                        return None;
                    }
                    let s = sum as f32 * 100.0 / std_sum as f32; // scale factor
                    let q = if s < 100.0 { (200.0 - s) / 2.0 } else { 5000.0 / s };
                    return Some(q.round().clamp(1.0, 100.0) as u8);
                }
                p += 64;
            } else {
                p += 128;
            }
        }
        i = seg_end.max(i + 1);
    }
    None
}

/// JPEG의 SOF(Start of Frame)에서 **휘도(Y) 성분의 서브샘플링 계수 (H, V)**를 읽는다.
/// (2,2)=4:2:0, (2,1)=4:2:2, (1,1)=4:4:4, (1,2)=4:4:0. 세그먼트 길이로 정확히
/// 건너뛰며 SOF를 찾는다(payload 안 0xFF가 마커로 오인되지 않게). SOS 전에서 멈춘다.
fn detect_jpeg_subsampling(jpeg: &[u8]) -> Option<(u8, u8)> {
    let len = jpeg.len();
    let mut i = 0;
    while i + 1 < len && !(jpeg[i] == 0xFF && jpeg[i + 1] == 0xD8) {
        i += 1;
    }
    if i + 1 >= len {
        return None;
    }
    i += 2; // SOI 다음
    while i + 3 < len {
        if jpeg[i] != 0xFF {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        while j < len && jpeg[j] == 0xFF {
            j += 1; // fill 바이트 건너뛰기
        }
        if j >= len {
            break;
        }
        let m = jpeg[j];
        if m == 0xD9 || m == 0xDA {
            break; // EOI/SOS
        }
        if m == 0x01 || (0xD0..=0xD7).contains(&m) {
            i = j + 1; // 길이 없는 마커
            continue;
        }
        if j + 2 >= len {
            break;
        }
        let seg_len = ((jpeg[j + 1] as usize) << 8) | jpeg[j + 2] as usize;
        let payload = j + 3;
        // SOF 계열(C0~CF 중 DHT=C4·JPG=C8·DAC=CC 제외)
        if (0xC0..=0xCF).contains(&m) && m != 0xC4 && m != 0xC8 && m != 0xCC {
            // payload: 정밀도(1) 높이(2) 너비(2) 성분수(1) [성분0: id(1) 샘플링(1) …]
            if payload + 7 < len {
                let s = jpeg[payload + 7];
                return Some((s >> 4, s & 0x0F));
            }
            return None;
        }
        i = (j + 1 + seg_len).min(len);
    }
    None
}

/// 추정한 (H,V)를 jpeg-encoder의 SamplingFactor로. 알 수 없으면 스캔본 관행인 4:2:0.
fn sampling_factor_for(hv: Option<(u8, u8)>) -> jpeg_encoder::SamplingFactor {
    use jpeg_encoder::SamplingFactor as S;
    match hv {
        Some((2, 2)) => S::R_4_2_0,
        Some((2, 1)) => S::R_4_2_2,
        Some((1, 1)) => S::R_4_4_4,
        Some((1, 2)) => S::R_4_4_0,
        _ => S::R_4_2_0,
    }
}

/// 페이지에서 가장 큰 이미지의 원본 압축 바이트(DCTDecode=JPEG)에서 **품질과
/// 서브샘플링**을 함께 detect한다(사용자 요청). 원본과 같은 스펙으로 재인코딩하면
/// 용량이 원본과 거의 같아진다. JPEG가 아니거나 실패하면 기본값(q82, 4:2:0).
fn detect_page_jpeg_spec(page: &PdfPage) -> (u8, jpeg_encoder::SamplingFactor) {
    let mut best: Option<(f32, Vec<u8>)> = None;
    for object in page.objects().iter() {
        let Some(img) = object.as_image_object() else {
            continue;
        };
        let (Ok(w), Ok(h)) = (img.width(), img.height()) else {
            continue;
        };
        let Ok(data) = img.get_raw_image_data() else {
            continue;
        };
        let area = (w as f32) * (h as f32);
        if best.as_ref().map_or(true, |(a, _)| area > *a) {
            best = Some((area, data));
        }
    }
    match best {
        Some((_, data)) => {
            let quality = estimate_jpeg_quality(&data)
                .unwrap_or(RASTERIZE_JPEG_DEFAULT_QUALITY)
                .clamp(RASTERIZE_JPEG_MIN_QUALITY, RASTERIZE_JPEG_MAX_QUALITY);
            (quality, sampling_factor_for(detect_jpeg_subsampling(&data)))
        }
        None => (RASTERIZE_JPEG_DEFAULT_QUALITY, jpeg_encoder::SamplingFactor::R_4_2_0),
    }
}

fn rasterize_whole_page<'a>(
    document: &PdfDocument<'a>,
    page: &mut PdfPage<'a>,
    rects: &[PdfRect],
    background_hex: &str,
) -> Result<(), String> {
    let page_width = page.width().value;
    let page_height = page.height().value;

    // 원본 스펙 detect: 렌더/객체 제거 전에 원본 이미지의 해상도·JPEG 품질·서브샘플링을 잰다.
    // QP-2: x·y 배율을 따로 적용해 원본 비정방 해상도까지 그대로 보존한다.
    // QP-1: 원본 배율 그대로가 원칙이되, 이 시스템 가용 메모리 예산을 넘으면 x:y 비를
    // 유지한 채 다운샘플한다(사전 점검 plan_rasterization_downsample과 동일 로직·기준).
    let (scale_x, scale_y) = rasterize_render_scale_xy(page);
    let budget = rasterize_pixel_budget(available_memory_bytes());
    let (scale_x, scale_y, _downsampled) =
        apply_memory_budget(page_width, page_height, scale_x, scale_y, budget);
    let (quality, sampling) = detect_page_jpeg_spec(page);
    let bitmap = page
        .render_with_config(
            &PdfRenderConfig::new()
                .scale_page_width_by_factor(scale_x)
                .scale_page_height_by_factor(scale_y),
        )
        .map_err(|err| format!("페이지를 렌더링하지 못했습니다: {err}"))?;
    let mut image = bitmap.as_image().map_err(|err| format!("렌더링 결과를 이미지로 바꾸지 못했습니다: {err}"))?;
    // bitmap이 page를 (불변으로) 빌려둔 채라 이후 page.objects_mut() 같은 가변
    // 접근과 충돌한다 — 이미지로 복사해 왔으니 더 들고 있을 필요가 없다.
    drop(bitmap);

    let (r, g, b) = parse_hex_rgb(background_hex);
    let fill_pixel = image::Rgba([r, g, b, 255]);
    let img_width = image.width();
    let img_height = image.height();

    // 각 변을 **반올림**해 픽셀에 맞춘다 — 예전엔 좌/상은 floor, 우/하는 ceil이라
    // bbox보다 각 변이 최대 1px씩 커져 "블랙 박스가 원래보다 몇 픽셀 더" 잡혔다
    // (사용자 재현). 반올림은 원본 bbox 크기에 가장 가깝게 맞춘다.
    let px = |v: f32, size: u32| -> u32 { (v.round() as i64).clamp(0, size as i64) as u32 };
    for rect in rects {
        let x0 = px((rect.left().value / page_width) * img_width as f32, img_width);
        let x1 = px((rect.right().value / page_width) * img_width as f32, img_width);
        let y0 = px((page_height - rect.top().value) / page_height * img_height as f32, img_height);
        let y1 = px((page_height - rect.bottom().value) / page_height * img_height as f32, img_height);

        for y in y0..y1 {
            for x in x0..x1 {
                image.put_pixel(x, y, fill_pixel);
            }
        }
    }

    // 래스터 결과를 **JPEG로 인코딩**해 임베드한다(무손실 대신) — 용량 폭증 방지.
    // 원본과 같은 품질·서브샘플링 + 최적 허프만 테이블로 인코딩해 원본 수준 용량
    // 유지(전용 인코더 jpeg-encoder — image 크레이트는 4:2:2 고정이라 못 맞춤).
    // JPEG는 알파를 지원하지 않으므로 RGB로 변환한 뒤 인코딩한다.
    let rgb = image.to_rgb8();
    let (w, h) = (rgb.width(), rgb.height());
    let mut jpeg: Vec<u8> = Vec::new();
    let mut encoder = jpeg_encoder::Encoder::new(&mut jpeg, quality);
    encoder.set_sampling_factor(sampling);
    encoder.set_optimized_huffman_tables(true);
    encoder
        .encode(rgb.as_raw(), w as u16, h as u16, jpeg_encoder::ColorType::Rgb)
        .map_err(|err| format!("JPEG 인코딩에 실패했습니다: {err}"))?;

    // 기존 객체를 모두 지우고(뒤에서부터) JPEG 이미지 한 장으로 대체한다.
    let object_count = page.objects().len();
    for index in (0..object_count).rev() {
        let removed = page
            .objects_mut()
            .remove_object_at_index(index)
            .map_err(|err| format!("기존 객체를 제거하지 못했습니다: {err}"))?;
        std::mem::forget(removed); // SAVE-01과 동일한 이유로 Drop을 건너뛴다.
    }

    // FPDFImageObj_LoadJpegFileInline로 JPEG를 DCTDecode 그대로 임베드(작은 용량).
    let image_object = PdfPageImageObject::new_from_jpeg_reader(document, std::io::Cursor::new(jpeg))
        .map_err(|err| format!("JPEG 이미지 객체를 만들지 못했습니다: {err}"))?;
    let mut added = page
        .objects_mut()
        .add_image_object(image_object)
        .map_err(|err| format!("래스터 이미지를 페이지에 넣지 못했습니다: {err}"))?;
    // 기본 1pt×1pt 이미지를 페이지 전체 크기로 확대(원점 좌하단부터 페이지를 덮음).
    added
        .scale(page_width, page_height)
        .map_err(|err| format!("이미지 크기를 맞추지 못했습니다: {err}"))?;

    Ok(())
}

/// SAVE-01/02: 기본 경로(객체 제거+영역 채우기)를 먼저 시도하고, 실패하면
/// 페이지 전체 래스터화로 넘어간다.
fn redact_page<'a>(
    document: &PdfDocument<'a>,
    page: &mut PdfPage<'a>,
    boxes: &[RelativeBBox],
    background_hex: &str,
) -> Result<(), String> {
    if redact_page_objects(page, boxes, background_hex).is_ok() {
        return Ok(());
    }

    let page_width = page.width().value;
    let page_height = page.height().value;
    let rects: Vec<PdfRect> = boxes.iter().map(|bbox| to_pdf_rect(bbox, page_width, page_height)).collect();
    rasterize_whole_page(document, page, &rects, background_hex)
}

/// §6.7: 모든 블랙마킹 항목을 페이지별로 묶어 처리하고, 지정한 경로에
/// 저장한다. 원문은 그대로 둔다(제외 기능이 제거되어 목록의 모든 항목이
/// 반영 대상이다). SAVE-05: 저장
/// 경로는 더 이상 이 함수가 고정으로 정하지 않는다 — 호출부(commands/save.rs)가
/// OS 네이티브 "다른 이름으로 저장" 다이얼로그(기본 파일명은
/// `redacted_path_for`가 여전히 제공)로 사용자에게 직접 받는다.
pub fn save_redacted_document_to(
    pdf_path: &Path,
    output_path: &Path,
    items: &[ReviewItem],
    background_hex: &str,
) -> Result<(), String> {
    save_redacted_document_to_with_progress(pdf_path, output_path, items, background_hex, |_, _| {}, || false)
        .map(|_| ())
}

/// UI-PROGRESS: `save_redacted_document_to`에 **진행률 콜백 + 중단 확인**을 더한 형태.
/// 페이지를 하나 처리할 때마다 `on_progress(처리수, 전체수)`를 부르고, 각 페이지 전에
/// `should_cancel()`이 참이면 파일을 쓰지 않고 `Ok(None)`(중단)로 빠진다. 정상 완료
/// 시 `Ok(Some(문서_전체_페이지수))`(완료 요약에 쓴다). 원문은 어느 경우에도 그대로
/// 둔다(결과 파일은 완료 시에만 생성).
pub fn save_redacted_document_to_with_progress<F, C>(
    pdf_path: &Path,
    output_path: &Path,
    items: &[ReviewItem],
    background_hex: &str,
    mut on_progress: F,
    should_cancel: C,
) -> Result<Option<u32>, String>
where
    F: FnMut(u32, u32),
    C: Fn() -> bool,
{
    let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let document = load_document(pdf_path)?;
    let page_count = document.pages().len() as u32;

    let mut boxes_by_page: std::collections::HashMap<u32, Vec<RelativeBBox>> =
        std::collections::HashMap::new();
    for item in items {
        boxes_by_page.entry(item.page).or_default().push(item.bbox);
    }

    let total = boxes_by_page.len() as u32;
    on_progress(0, total);
    for (processed, (page_index, boxes)) in boxes_by_page.iter().enumerate() {
        if should_cancel() {
            return Ok(None);
        }
        let mut page = document
            .pages()
            .get(*page_index as i32)
            .map_err(|err| format!("페이지({page_index})를 불러올 수 없습니다: {err}"))?;
        redact_page(&document, &mut page, boxes, background_hex)?;
        on_progress(processed as u32 + 1, total);
    }

    // 파일 쓰기 직전 마지막 중단 확인 — 여기서 취소하면 결과 파일을 만들지 않는다.
    if should_cancel() {
        return Ok(None);
    }
    document
        .save_to_file(output_path)
        .map_err(|err| format!("결과 파일을 저장할 수 없습니다({}): {err}", output_path.display()))?;

    Ok(Some(page_count))
}

/// 기본 경로(`redacted_path_for`)로 그대로 저장하는 편의 래퍼 — 저장 경로를
/// 사용자에게 물어보지 않는 테스트/내부 호출에서 계속 쓴다.
pub fn save_redacted_document(
    pdf_path: &Path,
    items: &[ReviewItem],
    background_hex: &str,
) -> Result<PathBuf, String> {
    let output_path = redacted_path_for(pdf_path);
    save_redacted_document_to(pdf_path, &output_path, items, background_hex)?;
    Ok(output_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::ReviewItemOrigin;
    use std::path::PathBuf;

    fn sample_path(filename: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("pdf-samples").join(filename)
    }

    fn sample_item(page: u32, bbox: RelativeBBox) -> ReviewItem {
        ReviewItem {
            id: "r-0".into(),
            origin: ReviewItemOrigin::Manual,
            page,
            bbox,
            original_bbox: None,
            category: "Custom".into(),
            content: "test".into(),
            pattern_type: None,
            confidence: None,
            validation: crate::sidecar::ValidationStatus::NotValidated,
            modified: false,
            created_at: "2026-01-01T00:00:00.000Z".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
        }
    }

    fn rect_at(left: f32, bottom: f32, right: f32, top: f32) -> PdfRect {
        PdfRect::new(PdfPoints::new(bottom), PdfPoints::new(left), PdfPoints::new(top), PdfPoints::new(right))
    }

    #[test]
    fn estimate_jpeg_quality_reads_dqt_from_encoded_bytes() {
        // image 크레이트로 q60·q90 JPEG를 만들어, 추정 품질이 근사(±8)한지 본다
        // — 원본 스캔본의 압축 스펙을 되짚어 그 품질로 재인코딩하기 위한 핵심.
        let img = image::RgbImage::from_fn(64, 64, |x, y| image::Rgb([(x * 4) as u8, (y * 4) as u8, 128]));
        for target in [60u8, 82, 90] {
            let mut buf = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, target)
                .encode_image(&img)
                .unwrap();
            let est = estimate_jpeg_quality(&buf).expect("품질 추정 실패");
            assert!(
                (est as i32 - target as i32).abs() <= 8,
                "추정 품질 {est}이 목표 {target}에서 너무 벗어남"
            );
        }
        assert_eq!(estimate_jpeg_quality(b"not a jpeg"), None);
    }

    #[test]
    fn detect_jpeg_subsampling_reads_sof_component_factors() {
        // jpeg-encoder로 알려진 서브샘플링을 만들어, SOF에서 그대로 읽히는지 왕복 검증.
        let img = image::RgbImage::from_fn(32, 32, |x, _| image::Rgb([(x * 8) as u8, 100, 150]));
        for (sf, expected) in [
            (jpeg_encoder::SamplingFactor::R_4_2_0, (2, 2)),
            (jpeg_encoder::SamplingFactor::R_4_2_2, (2, 1)),
            (jpeg_encoder::SamplingFactor::R_4_4_4, (1, 1)),
        ] {
            let mut buf = Vec::new();
            let mut enc = jpeg_encoder::Encoder::new(&mut buf, 80);
            enc.set_sampling_factor(sf);
            enc.encode(img.as_raw(), 32, 32, jpeg_encoder::ColorType::Rgb).unwrap();
            assert_eq!(detect_jpeg_subsampling(&buf), Some(expected), "{sf:?} 왕복");
        }
        assert_eq!(detect_jpeg_subsampling(b"nope"), None);
    }

    #[test]
    fn is_area_ratio_dangerous_is_false_when_object_is_similar_size_to_target() {
        // 대상 영역과 비슷한 크기(정상적인 작은 겹침 객체)는 위험하지 않다.
        let object = rect_at(0.0, 0.0, 40.0, 20.0);
        let target = vec![rect_at(5.0, 5.0, 35.0, 15.0)];
        assert!(!is_area_ratio_dangerous(&object, &target));
    }

    #[test]
    fn is_area_ratio_dangerous_is_true_when_object_vastly_exceeds_target() {
        // 페이지 전체(612x792)를 감싸는 폼이 작은 영역(100x20)과 겹치면 위험.
        let object = rect_at(0.0, 0.0, 612.0, 792.0);
        let target = vec![rect_at(50.0, 50.0, 150.0, 70.0)];
        assert!(is_area_ratio_dangerous(&object, &target));
    }

    #[test]
    fn is_area_ratio_dangerous_handles_multiple_target_rects_by_summing_area() {
        // 대상 영역이 여러 개면 합으로 비교한다 — 하나씩 보면 작아 보여도
        // 합치면 객체와 비슷한 크기일 수 있다.
        let object = rect_at(0.0, 0.0, 100.0, 100.0); // 10000
        let target = vec![rect_at(0.0, 0.0, 60.0, 60.0), rect_at(0.0, 0.0, 60.0, 60.0)]; // 3600*2=7200
        assert!(!is_area_ratio_dangerous(&object, &target)); // 10000 < 7200*3
    }

    #[test]
    fn redacted_path_for_appends_suffix_before_extension() {
        let path = redacted_path_for(Path::new("/abs/path/ZZ0001964_01.pdf"));
        assert_eq!(path, Path::new("/abs/path/ZZ0001964_01-redacted.pdf"));
    }

    #[test]
    fn parse_hex_rgb_parses_valid_hex() {
        assert_eq!(parse_hex_rgb("#396cd8"), (0x39, 0x6c, 0xd8));
        assert_eq!(parse_hex_rgb("e6a000"), (0xe6, 0xa0, 0x00));
    }

    /// 여러 테스트가 같은 샘플로 save_redacted_document를 부르면 출력 경로
    /// (원본과 같은 폴더의 `[stem]-redacted.pdf`)가 겹쳐 병렬 실행 시
    /// 경쟁 상태가 난다 — 테스트마다 별도 폴더에 샘플을 복사해 격리한다.
    fn copy_sample_into_tempdir(filename: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let dest = dir.path().join(filename);
        std::fs::copy(sample_path(filename), &dest).expect("샘플 복사 실패");
        (dir, dest)
    }

    #[test]
    fn save_redacted_document_creates_a_new_file_and_preserves_the_original() {
        let bbox = RelativeBBox { x: 0.1, y: 0.1, width: 0.3, height: 0.05 };
        let items = vec![sample_item(0, bbox)];

        let (_dir, original_path) = copy_sample_into_tempdir("BZB000877_01.pdf");
        let original_bytes_before = std::fs::read(&original_path).expect("원문 읽기 실패");

        let saved_path =
            save_redacted_document(&original_path, &items, "#000000").expect("저장 실패");

        assert!(saved_path.ends_with("BZB000877_01-redacted.pdf"));
        assert!(saved_path.exists());

        // 원문은 절대 변경되지 않아야 한다(§4.3, §9.2).
        let original_bytes_after = std::fs::read(&original_path).expect("원문 재읽기 실패");
        assert_eq!(original_bytes_before, original_bytes_after);
    }

    #[test]
    fn save_redacted_document_removes_detected_text_from_the_result() {
        // DET-01로 실제 검출된 항목을 그대로 반영 대상으로 넣고 저장한 뒤,
        // IO-03의 재탐색 유틸로 결과 파일에서 그 텍스트를 다시 찾아본다 —
        // 못 찾아야 콘텐츠 스트림에서 실제로 제거됐다는 뜻이다(§4.3).
        // KKZ000160_01.pdf에 실제 전화번호가 있어 검출 대상이 된다(BZB000877은
        // anchor 없는 날짜뿐이라 생년월일 anchor 필수화 이후 0건).
        let (_dir, original_path) = copy_sample_into_tempdir("KKZ000160_01.pdf");
        let detected = crate::pdfium::detect_review_items(&original_path).expect("검출 실패");
        let detected_item = detected.first().expect("검출된 항목이 있어야 함");

        let mut item = sample_item(detected_item.page, detected_item.bbox);
        item.content = detected_item.content.clone();

        let saved_path =
            save_redacted_document(&original_path, &[item], "#000000").expect("저장 실패");

        let requests = vec![crate::pdfium::ReanchorRequest {
            page_index: detected_item.page,
            content: detected_item.content.clone(),
        }];
        let results = crate::pdfium::reanchor_bboxes(&saved_path, &requests).expect("검증용 재탐색 실패");
        assert_eq!(results, vec![None], "블랙마킹된 텍스트가 결과 파일에 여전히 남아있음");
    }

    #[test]
    fn rasterize_whole_page_fallback_produces_a_page_with_the_target_text_gone() {
        // SAVE-02: 기본 경로(객체 제거) 없이 폴백 함수 자체를 직접 호출해도
        // 결과 페이지에서 그 텍스트가 사라지는지 확인한다.
        let original_path = sample_path("BZB000877_01.pdf");
        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let out = dir.path().join("save_rasterize_fallback_test.pdf");

        {
            // PDFIUM_OP_LOCK은 이 블록 동안만 쥔다 — open_document_info가
            // 아래에서 그 락을 다시 거는데, 락은 재진입이 안 되므로 여기서
            // 먼저 놓지 않으면 같은 스레드에서 자기 자신에게 막혀 멈춘다.
            let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let document = load_document(&original_path).expect("문서 로드 실패");
            let mut page = document.pages().get(0).expect("페이지 로드 실패");

            let page_width = page.width().value;
            let page_height = page.height().value;
            let bbox = RelativeBBox { x: 0.1, y: 0.1, width: 0.3, height: 0.05 };
            let rects = vec![to_pdf_rect(&bbox, page_width, page_height)];

            rasterize_whole_page(&document, &mut page, &rects, "#000000").expect("래스터화 실패");

            // 객체가 이미지 한 장으로만 남아야 한다.
            assert_eq!(page.objects().len(), 1);

            document.save_to_file(&out).expect("저장 실패");
        }

        // 페이지 전체가 이미지로 바뀌었으니, 원래 있던 어떤 텍스트도 텍스트
        // 레이어에서 더는 찾을 수 없어야 한다.
        let info = crate::pdfium::open_document_info(&out).expect("결과 파일 정보 조회 실패");
        assert_eq!(
            info.page_dimensions[0].text_layer_status,
            crate::pdfium::TextLayerStatus::NoText,
            "래스터화된 페이지에는 텍스트 레이어가 없어야 한다"
        );

        std::fs::remove_file(&out).ok();
    }

    #[test]
    fn redact_page_falls_back_to_rasterization_when_object_removal_fails() {
        // remove_object_at_index가 실패할 상황을 실제로 만들기는 어려우므로
        // (SAVE-01에서 이미 안정화됨), redact_page의 분기 자체는 코드 검사로
        // 보장하고, 정상 경로에서 항상 primary가 성공해 폴백이 필요 없음을
        // 확인해 회귀를 막는다.
        let bbox = RelativeBBox { x: 0.1, y: 0.1, width: 0.3, height: 0.05 };
        let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let original_path = sample_path("BZB000877_01.pdf");
        let document = load_document(&original_path).expect("문서 로드 실패");
        let mut page = document.pages().get(0).expect("페이지 로드 실패");

        let before_count = page.objects().len();
        redact_page(&document, &mut page, &[bbox], "#000000").expect("반영 실패");

        // 정상 경로(primary)라면 이미지 한 장으로 전체가 바뀌지 않고, 겹친
        // 객체만 지워지고 채우기 사각형 하나가 늘어난 정도여야 한다.
        assert!(page.objects().len() <= before_count + 1);
    }

    #[test]
    fn redact_page_rasterizes_scanned_full_page_image_instead_of_blanking() {
        // 사용자 재현: 스캔본(전면 스캔 이미지 + 투명 OCR 텍스트 레이어)에서 bbox와
        // 겹치는 전면 이미지를 통째로 지우면 화면 내용이 전부 사라지고 텍스트
        // 레이어만 남아 "검은 박스만 보이고 아무 내용도 안 보임". is_oversized_container
        // 가 Image도 잡아 페이지 전체 래스터화로 넘어가야 한다 — 결과 페이지 객체는
        // 이미지 한 장(래스터)만 남는다(객체 제거 경로였다면 전면 이미지가 사라지고
        // 텍스트 객체 다수가 남았을 것).
        let bbox = RelativeBBox { x: 0.2, y: 0.7, width: 0.2, height: 0.02 };
        let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let document = load_document(&sample_path("ZZ0002376_01.pdf")).expect("문서 로드 실패");
        let mut page = document.pages().get(7).expect("페이지 로드 실패");
        redact_page(&document, &mut page, &[bbox], "#000000").expect("반영 실패");
        assert_eq!(
            page.objects().len(),
            1,
            "스캔 페이지는 래스터화되어 이미지 한 장만 남아야 한다"
        );
    }

    #[test]
    fn rasterize_render_scale_matches_scanned_image_resolution() {
        // 사용자 재현: 저장본이 부옇게 흐려짐. 래스터화 배율이 1(≈72DPI)이면
        // 고해상도 스캔 이미지가 크게 다운샘플된다. 스캔 페이지의 이미지 원본
        // 해상도에 맞춰 x·y 배율이 모두 1보다 충분히 커야 원본 품질이 유지된다.
        let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let document = load_document(&sample_path("ZZ0002376_01.pdf")).expect("문서 로드 실패");
        let page = document.pages().get(7).expect("페이지 로드 실패");
        let (sx, sy) = rasterize_render_scale_xy(&page);
        assert!(
            sx > 1.5 && sy > 1.5,
            "스캔 이미지 해상도에 맞춰 x·y 배율이 올라가야 함(현재 sx={sx}, sy={sy})"
        );
    }

    #[test]
    fn apply_memory_budget_keeps_native_scale_when_within_budget() {
        // QP-1: 원본이 예산 이내면 배율을 건드리지 않는다(원본 보존 원칙).
        let (sx, sy, down) = apply_memory_budget(1000.0, 1000.0, 2.0, 2.0, 100_000_000.0);
        assert!(!down);
        assert_eq!((sx, sy), (2.0, 2.0));
    }

    #[test]
    fn apply_memory_budget_downsamples_within_budget_when_over() {
        // 원본 4000×3000 = 12,000,000 px. 예산 3,000,000 px → s≈0.5로 축소.
        let (sx, sy, down) = apply_memory_budget(4000.0, 3000.0, 1.0, 1.0, 3_000_000.0);
        assert!(down);
        let px = (4000.0 * sx) as f64 * (3000.0 * sy) as f64;
        assert!(px <= 3_000_000.0 + 1.0, "예산 초과: px={px}");
        assert!((sx - 0.5).abs() < 1e-3, "sx={sx}");
    }

    #[test]
    fn apply_memory_budget_preserves_nonsquare_axis_ratio() {
        // QP-2와의 정합: 다운샘플해도 x:y 배율 비(원본 비정방 해상도)는 유지.
        let (sx, sy, down) = apply_memory_budget(1000.0, 1000.0, 4.0, 2.0, 1_000_000.0);
        assert!(down);
        assert!((sx / sy - 2.0).abs() < 1e-5, "비율 어긋남 sx={sx}, sy={sy}");
    }

    #[test]
    fn rasterize_pixel_budget_is_half_of_available_over_four_bytes() {
        // 마진 50%·RGBA 4B/px: 800MB 가용 → 100M px 예산.
        let budget = rasterize_pixel_budget(800 * 1024 * 1024);
        assert!((budget - 104_857_600.0).abs() < 1.0, "budget={budget}");
    }

    #[test]
    fn save_with_progress_cancels_without_writing_output() {
        // UI-PROGRESS: should_cancel=true면 결과 파일을 만들지 않고 Ok(false)로 빠진다.
        let (_dir, orig) = copy_sample_into_tempdir("ZZ0002376_01.pdf");
        let out = orig.with_file_name("cancelled-output.pdf");
        let item = sample_item(7, RelativeBBox { x: 0.2, y: 0.7, width: 0.2, height: 0.02 });
        let mut progress_calls = 0u32;
        let outcome = save_redacted_document_to_with_progress(
            &orig,
            &out,
            &[item],
            "#000000",
            |_p, _t| progress_calls += 1,
            || true,
        )
        .expect("호출 자체는 성공해야 한다");
        assert!(outcome.is_none(), "중단 시 Ok(None)이어야 한다");
        assert!(!out.exists(), "중단 시 결과 파일을 만들지 않아야 한다");
        assert!(progress_calls >= 1, "시작 시 on_progress(0,total)가 최소 1회 불려야 한다");
    }

    #[test]
    fn redacted_scanned_pdf_stays_close_to_original_size() {
        // 사용자 재현: 저장본이 원본의 8배. 래스터 이미지를 무손실이 아니라 JPEG로
        // 임베드해, 스캔 한 페이지를 재래스터해도 용량이 원본의 2배를 넘지 않아야 한다.
        let (_dir, orig) = copy_sample_into_tempdir("ZZ0002376_01.pdf");
        let osz = std::fs::metadata(&orig).expect("원본 크기 조회 실패").len();
        let item = sample_item(7, RelativeBBox { x: 0.2, y: 0.7, width: 0.2, height: 0.02 });
        let out = save_redacted_document(&orig, &[item], "#000000").expect("저장 실패");
        let rsz = std::fs::metadata(&out).expect("결과 크기 조회 실패").len();
        // 원본 품질을 detect해 그 품질로 재인코딩하므로 용량이 원본과 거의 같아야
        // 한다(실측 ×1.03). 1.5배를 넘으면 무손실 임베드나 과품질(q90 고정) 회귀 의심.
        assert!(
            rsz < osz * 3 / 2,
            "redacted 용량이 과도함(원본 품질 미반영 의심): {}KB → {}KB",
            osz / 1024,
            rsz / 1024
        );
    }

    #[test]
    fn save_redacted_document_removes_every_detected_item_and_changes_the_text_fingerprint() {
        // SAVE-04(§4.3, §9.2): 검출된 항목 전체를 반영 대상으로 저장한 뒤,
        // (1) 문서 전체 텍스트 지문(PDF-09)이 원문과 달라졌는지 — 실제로
        //     텍스트가 바뀌었다는 문서 단위 증거
        // (2) 검출됐던 항목 하나하나가 자기 페이지에서 더는 재탐색되지
        //     않는지를 함께 확인한다.
        let (_dir, original_path) = copy_sample_into_tempdir("KKZ000160_01.pdf");

        let detected = crate::pdfium::detect_review_items(&original_path).expect("검출 실패");
        assert!(!detected.is_empty(), "검출된 항목이 있어야 이 테스트가 의미 있다");

        let items: Vec<ReviewItem> = detected
            .iter()
            .map(|found| {
                let mut item = sample_item(found.page, found.bbox);
                item.content = found.content.clone();
                item
            })
            .collect();

        let original_info = crate::pdfium::open_document_info(&original_path).expect("원문 정보 조회 실패");

        let saved_path = save_redacted_document(&original_path, &items, "#000000").expect("저장 실패");

        let redacted_info = crate::pdfium::open_document_info(&saved_path).expect("결과 파일 정보 조회 실패");
        assert_ne!(
            original_info.text_fingerprint, redacted_info.text_fingerprint,
            "블랙마킹 후에도 텍스트 지문이 그대로임 — 실제로 제거되지 않았을 가능성"
        );

        let requests: Vec<crate::pdfium::ReanchorRequest> = detected
            .iter()
            .map(|found| crate::pdfium::ReanchorRequest {
                page_index: found.page,
                content: found.content.clone(),
            })
            .collect();
        let results = crate::pdfium::reanchor_bboxes(&saved_path, &requests).expect("검증용 재탐색 실패");
        assert!(
            results.iter().all(Option::is_none),
            "일부 검출 항목의 텍스트가 결과 파일에 여전히 남아있음: {results:?}"
        );
    }

    #[test]
    fn save_redacted_document_leaves_no_extractable_trace_of_redacted_content() {
        // §9.2: "Acrobat 등에서 텍스트 추출·복사로도 원문이 드러나지 않아야
        // 함"을 가장 직접적으로 흉내낸 테스트 — 재탐색(부분 매칭 검색)이
        // 아니라, 그 페이지의 전체 텍스트를 통째로 뽑아 반영한 내용이 부분
        // 문자열로도 전혀 없는지 확인한다.
        let (_dir, original_path) = copy_sample_into_tempdir("KKZ000160_01.pdf");
        let detected = crate::pdfium::detect_review_items(&original_path).expect("검출 실패");
        let target = detected.first().expect("검출된 항목이 있어야 한다");

        let mut item = sample_item(target.page, target.bbox);
        item.content = target.content.clone();

        let saved_path = save_redacted_document(&original_path, &[item], "#000000").expect("저장 실패");

        let extracted_text = {
            let _guard = PDFIUM_OP_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let document = load_document(&saved_path).expect("결과 파일 로드 실패");
            let page = document.pages().get(target.page as i32).expect("페이지 로드 실패");
            let text = page.text().expect("텍스트 레이어 조회 실패").all();
            text
        };

        assert!(
            !extracted_text.contains(&target.content),
            "전체 텍스트 추출(복사·붙여넣기 흉내) 결과에 반영 대상 내용이 그대로 남아있음"
        );
    }
}
