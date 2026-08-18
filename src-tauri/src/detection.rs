//! DET-01/02/03: 자동검출 엔진(§6.3.1) — 페이지 텍스트를 정규식으로 스캔해
//! review_items 후보를 만드는 파이프라인(§5.3.1), 매치 주변 문맥(anchor)과
//! 체크섬을 함께 저울질하는 **다신호 fail-safe 스코어링**으로 confidence를
//! 산정한다(§5.3.2). pdfium 접근은 pdfium.rs가 전담하고(§4.1), 이 모듈은 이미
//! 추출된 [`PositionedChar`] 목록만 다루는 순수 로직이라 실제 PDF 파일 없이도
//! 단위테스트할 수 있다.
//!
//! 판정 철학(다신호 fail-safe):
//! - anchor(라벨 근접)가 최우선 신호 — OCR에서 숫자는 자주 틀려도 "주민등록번호"
//!   같은 라벨은 잘 인식되므로, anchor는 체크섬이 놓칠 손상 번호를 되살린다.
//! - 체크섬은 "통과=확정 가점"으로만 쓴다. **실패는 감점이 아니라 가점 없음**일
//!   뿐이며 후보를 버리지 않는다(OCR 오인식·마스킹·2020년 이후 RRN 등 진짜 PII가
//!   체크섬을 통과 못 하므로). 카테고리 자체의 형식 불일치(카드 자릿수/BIN 등)만
//!   Reject하며, 이는 "PII 누락"이 아니라 "애초에 그 카테고리가 아님"이다.
//! - confidence는 정렬·'저확신' 표시용이며, 어떤 신호도 매치를 리뷰큐에서 조용히
//!   제거하지 않는다.

use std::sync::OnceLock;

use chrono::{SecondsFormat, Utc};
use regex::Regex;

use crate::pdfium::PositionedChar;
use crate::sidecar::{RelativeBBox, ReviewItem, ReviewItemOrigin, ValidationStatus};

/// 카테고리별 검증 결과. fail-safe: 대부분 `Accept`이며, 형식 자체가 그 카테고리가
/// 아님을 뜻할 때만 `Reject`(예: 카드 자릿수/BIN 불일치).
pub enum Validation {
    /// 이 후보는 이 카테고리가 아니다 — 버린다(형식 불일치, PII 누락이 아님).
    Reject,
    /// 검출 확정. `status`는 목록 표시용, `bonus`는 confidence 가점(체크섬 통과 등).
    Accept { status: ValidationStatus, bonus: f32 },
}

/// 문맥(anchor) 그룹 — 매치 앞쪽 window에 `keywords` 중 하나가 있으면 confidence를
/// 상향하고, `reclassify`가 있으면 카테고리를 재지정한다(예: 전화→팩스).
pub struct AnchorGroup {
    pub keywords: &'static [&'static str],
    pub reclassify: Option<(&'static str, &'static str)>,
}

pub struct DetectionRule {
    pub category: &'static str,
    pub pattern_type: &'static str,
    pub regex: Regex,
    pub base_confidence: f32,
    /// 매치(정규화된 텍스트)를 받아 검증·가점을 판정. §5.3의 검증 열 대응.
    pub validate: fn(&str) -> Validation,
    /// 우선순위 순 anchor 그룹. 먼저 매치되는 그룹이 재분류/가점을 가져간다.
    pub anchors: &'static [AnchorGroup],
    /// true면 anchor가 없을 때 **아예 검출하지 않는다**(오탐이 큰 카테고리 —
    /// 생년월일·계좌번호). false면 anchor 없이도 검출하되 가점만 없다.
    pub anchor_required: bool,
}

fn compile(pattern: &str) -> Regex {
    Regex::new(pattern).expect("검출 정규식은 하드코딩된 상수이므로 항상 유효해야 한다")
}

/// 체크섬 통과 시 주는 confidence 가점(§5.3의 "체크섬 Valid 시 높음"). 실패는 0.0
/// 가점(감점 아님) — fail-safe.
const CHECKSUM_BONUS: f32 = 0.3;
/// 문맥 접두어가 있을 때 confidence를 올리는 폭(§5.3.2). 스펙은 "상향"만 하고 값을
/// 정하지 않아 임의로 채택.
const CONTEXT_CONFIDENCE_BOOST: f32 = 0.2;

// ── 검증 함수(§5.3 검증 열) ─────────────────────────────────────────────

/// RRN: 11-modulus 체크섬. **통과=가점, 실패=가점 없음이되 계속 검출**(fail-safe).
/// 절대 Reject하지 않는다 — OCR 오인식·2020년 이후 발급분도 놓치지 않기 위함.
fn validate_rrn(matched: &str) -> Validation {
    if rrn_checksum_valid(matched) {
        Validation::Accept { status: ValidationStatus::Valid, bonus: CHECKSUM_BONUS }
    } else {
        Validation::Accept { status: ValidationStatus::Invalid, bonus: 0.0 }
    }
}

/// 카드: 형식(자릿수·BIN 첫자리·길이-브랜드 일관성)에 어긋나면 Reject(카드가 아님).
/// 형식은 맞지만 Luhn 실패면 계속 검출(fail-safe)하되 가점만 주지 않는다.
fn validate_card(matched: &str) -> Validation {
    let digits: String = matched.chars().filter(|c| c.is_ascii_digit()).collect();
    let len = digits.len();
    if !(13..=19).contains(&len) {
        return Validation::Reject;
    }
    let first = digits.as_bytes()[0];
    // 실존 카드 BIN 첫자리(원본 card.py 화이트리스트).
    if !matches!(first, b'2' | b'3' | b'4' | b'5' | b'6' | b'9') {
        return Validation::Reject;
    }
    // 길이-브랜드 일관성(원본 주석 그대로): 13자리는 구형 Visa(4), 15자리는 Amex(34/37).
    if len == 13 && first != b'4' {
        return Validation::Reject;
    }
    if len == 15 && &digits[..2] != "34" && &digits[..2] != "37" {
        return Validation::Reject;
    }
    // 그룹 구분자 일관성: 진짜 카드는 구분자가 모두 같다(모두 '-' 또는 모두 공백
    // 또는 무구분). "2020-2264 2020-2265"처럼 '-'와 공백이 섞이면 서로 다른 두
    // 번호(표의 전화/팩스 등)를 잘못 묶은 것이므로 카드가 아니다(사용자 재현).
    let seps: Vec<char> = matched.chars().filter(|c| !c.is_ascii_digit()).collect();
    if !seps.is_empty() && seps.iter().any(|&c| c != seps[0]) {
        return Validation::Reject;
    }
    if luhn_valid(&digits) {
        Validation::Accept { status: ValidationStatus::Valid, bonus: CHECKSUM_BONUS }
    } else {
        Validation::Accept { status: ValidationStatus::Invalid, bonus: 0.0 }
    }
}

/// 형식 자체가 검증인 카테고리(여권·이메일·IP·URL): 매치되면 곧 형식 유효.
fn validate_format_only(_matched: &str) -> Validation {
    Validation::Accept { status: ValidationStatus::Valid, bonus: 0.0 }
}

/// 통일 체크섬이 없는 카테고리(전화·팩스·계좌).
fn validate_no_checksum(_matched: &str) -> Validation {
    Validation::Accept { status: ValidationStatus::ChecksumNotApplicable, bonus: 0.0 }
}

/// 검증하지 않는 카테고리(생년월일·주소) — 체크섬/형식검증이 없다. 오탐 억제는
/// anchor 필수로 처리한다(§5.3.1).
fn validate_none(_matched: &str) -> Validation {
    Validation::Accept { status: ValidationStatus::NotValidated, bonus: 0.0 }
}

/// DET-14 후속: 지번 없는 "○○구/시 + 동/리" 주소를 **법정동 사전**으로 검증.
/// 매치의 공백을 지운 뒤, 끝에서 길이 2~7의 접미 후보를 만들어 (1) 실존 법정동이고
/// (2) 바로 앞이 행정구역 경계(구/시/군/읍/면)이거나 문자열 시작이면 Accept.
/// 경계 조건은 "행정동"→"정동"처럼 더 긴 단어의 꼬리가 짧은 법정동에 걸리는
/// 오탐을 막는다. 사전에 없으면 Reject(이 카테고리가 아님).
fn validate_address_dict(matched: &str) -> Validation {
    const BOUNDARY: [char; 5] = ['구', '시', '군', '읍', '면'];
    let compact: Vec<char> = matched.chars().filter(|c| !c.is_whitespace()).collect();
    let n = compact.len();
    if n == 0 || !matches!(compact[n - 1], '동' | '리') {
        return Validation::Reject;
    }
    for len in 2..=7usize {
        if len > n {
            break;
        }
        let start = n - len;
        let boundary_ok = start == 0 || BOUNDARY.contains(&compact[start - 1]);
        if boundary_ok {
            let candidate: String = compact[start..].iter().collect();
            if crate::legal_dong::is_legal_dong(&candidate) {
                return Validation::Accept { status: ValidationStatus::NotValidated, bonus: 0.0 };
            }
        }
    }
    Validation::Reject
}

/// DET-14 후속(퍼지, 사용자 요청): OCR로 1글자 손상된 동/리("여의도를"→"여의도동")를
/// 법정동 사전과 **편집거리 1**로 매칭한다. 매치 끝의 3~6자 후보(앞이 행정구역
/// 경계여야 함)를 사전에 퍼지 대조. 정확 일치는 위 규칙(①-b)이 먼저 선점하므로
/// 여기서는 손상본만 걸린다. 짧은 후보(≤2자)는 제외(오탐).
fn validate_address_fuzzy_dict(matched: &str) -> Validation {
    const BOUNDARY: [char; 6] = ['구', '시', '군', '읍', '면', '도'];
    let compact: Vec<char> = matched.chars().filter(|c| !c.is_whitespace()).collect();
    let n = compact.len();
    // 끝이 **정확한 동/리**면 여기서 다루지 않는다 — 그건 실존 동이면 ①-b가 이미
    // 잡았고, 아니면 "사무동"처럼 진짜 비-법정동 단어이지 OCR 손상이 아니다. 퍼지는
    // 접미 자체가 손상된 경우("여의도를")만 대상으로 해 오탐을 막는다.
    if n == 0 || matches!(compact[n - 1], '동' | '리') {
        return Validation::Reject;
    }
    for len in 3..=6usize {
        if len >= n {
            break;
        }
        let start = n - len;
        if start == 0 || BOUNDARY.contains(&compact[start - 1]) {
            let candidate: String = compact[start..].iter().collect();
            if crate::legal_dong::is_legal_dong_fuzzy(&candidate, 1) {
                return Validation::Accept { status: ValidationStatus::NotValidated, bonus: 0.0 };
            }
        }
    }
    Validation::Reject
}

// ── anchor 키워드(§5.3.2, 모두 소문자·공백 제거 후 비교) ──────────────────

const RRN_ANCHOR: &[&str] = &["주민등록번호", "주민번호", "주민등록", "rrn"];
const CARD_ANCHOR: &[&str] = &["카드번호", "신용카드", "체크카드", "카드", "cardno", "cardnumber"];
/// 생년월일은 오탐이 커(숫자·날짜 흔함) anchor 필수. 아래 라벨이 앞설 때만 검출.
const DOB_ANCHOR: &[&str] = &["생년월일", "생일"];
/// 이메일 anchor(라벨이 앞서면 confidence 상향). 형식이 특이해 anchor 없이도
/// 검출되지만, 라벨이 있으면 가점만 준다(가리지는 않음).
const EMAIL_ANCHOR: &[&str] = &["e-mail", "email", "이메일", "메일주소", "메일"];
const PHONE_FAX_CONTEXT: &[&str] =
    &["연락처", "전화번호", "전화", "휴대폰", "핸드폰", "c.p.", "c.p", "h.p.", "hp", "tel"];
const FAX_CONTEXT: &[&str] = &["팩스번호", "팩스", "fax", "전송"];
/// 여권 문맥은 공백 유무 무관하게 인식해야 하므로(§5.3.2) 공백 제거형으로 둔다.
const PASSPORT_CONTEXT: &[&str] = &[
    "여권번호", "여권#", "여권", "한국여권번호", "한국여권", "passportno", "passportnumber",
    "passportnumbers",
];
/// 계좌 anchor: 오탐이 커 anchor 필수. "은행"은 모든 은행명(○○은행)을 부분매치로 포괄.
const ACCOUNT_ANCHOR: &[&str] = &["은행", "계좌번호", "입금처", "지급처", "계좌"];
/// DET-14 주소 anchor(사용자 지정). 부분매치라 "주소지/거주지/배송지/발송처" 등도
/// 포괄한다. 주소는 형식이 흔해(도로명·지번 모두 숫자를 포함) 오탐이 크므로
/// anchor 필수로 둔다 — 이 라벨이 앞설 때만 검출한다.
const ADDRESS_ANCHOR: &[&str] = &["주소", "거주", "본적", "자택", "배송", "발송"];

/// 은행/금융기관명이 끝나는 접미사. 고정 은행명 목록은 "조흥은행"(폐지 은행) 등
/// 빠진 게 생기므로, **매치 앞의 연속 한글 단어가 이 접미사로 끝나면 은행명으로 보고**
/// 함께 가린다 — 모든 `○○은행`·`○○뱅크`·새마을금고·우체국 등을 일반적으로 포괄한다.
const BANK_SUFFIXES: &[&str] = &["은행", "뱅크", "금고", "우체국", "수협", "신협", "축협"];

fn is_hangul_syllable(c: char) -> bool {
    ('\u{AC00}'..='\u{D7A3}').contains(&c)
}

/// 계좌번호가 은행명 anchor로 검출될 때, 매치 바로 앞(사이에 공백만)에 붙은 은행명을
/// 함께 가리도록 시작 char 인덱스를 은행명(연속 한글 단어) 시작으로 당긴다. 앞의 한글
/// 단어가 은행 접미사로 끝나지 않으면 `None`("계좌"·"입금처" 라벨 등 — 번호만 가린다).
fn bank_name_prefix_start(text_chars: &[char], start_char: usize) -> Option<usize> {
    let mut end = start_char;
    while end > 0 && text_chars[end - 1].is_whitespace() {
        end -= 1;
    }
    if end == 0 {
        return None;
    }
    // 매치 앞의 연속 한글 단어(공백/비한글 경계까지)를 잡는다.
    let mut begin = end;
    while begin > 0 && is_hangul_syllable(text_chars[begin - 1]) {
        begin -= 1;
    }
    if begin == end {
        return None;
    }
    let word: String = text_chars[begin..end].iter().collect();
    if BANK_SUFFIXES.iter().any(|suffix| word.ends_with(suffix)) {
        Some(begin)
    } else {
        None
    }
}

const NO_ANCHOR: &[AnchorGroup] = &[];

// ── DET-14 주소 정규식 조각 ───────────────────────────────────────────────
// 표의 '주소' 컬럼처럼 헤더(anchor)가 셀과 텍스트상 인접하지 않는 경우를
// 위해, **행정구역(시/도·시군구)이 포함되면 anchor 없이도 검출**한다(전체
// 주소 형태 자체가 강한 신호). 행정구역이 없는 짧은 주소만 anchor를 요구한다.

/// 시/도(접미형 또는 광역시/도 약칭) + 시군구, 또는 시군구만 — 최소 한 개의
/// 행정구역을 요구. `\s{0,2}`: OCR이 "강남 구"처럼 접미 앞에 공백을 끼워
/// 넣는 것을 허용(스캔본 대응).
/// - 접미형 시도("서울특별시"·"세종특별자치시"·"경기도") + 시군구 0~2
/// - **약칭 시도("서울"·"부산"…"경기") + 시군구 1~2(필수)** — 사용자 요청:
///   "서울 동작구"처럼 시가 생략돼도 '서울'부터 검출되게. 약칭 뒤 시군구를
///   필수로 둬 "경기 침체로 3" 같은 일반어 오탐을 막는다.
/// - 시군구만("강남구")
// 시/도 약칭에 **관찰된 OCR 변형**(라이선스 클린 자체 큐레이션)도 포함:
// 충남→"중남", 충북→"중북"(충→중은 실제 스캔본에서 관찰됨).
const ADDR_ADMIN: &str = r"(?:[가-힣]{2,7}\s{0,2}(?:특별자치시|특별자치도|특별시|광역시|시|도)\s*(?:[가-힣]{1,10}\s{0,2}(?:시|군|구)\s*){0,2}|(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|중북|중남|전북|전남|경북|경남|제주)\s*(?:[가-힣]{1,10}\s{0,2}(?:시|군|구)\s*){1,2}|(?:[가-힣]{1,10}\s{0,2}(?:시|군|구)\s*){1,2})";
/// **강한** 행정구역 — 이름+시/도 접미(또는 약칭 시도) + **시군구 1개 이상 필수**.
/// "시군구만" 약한 분기를 뺀 형태로, 동명이 OCR로 손상돼(예 "양2동"→"동") 지번
/// 규칙이 못 걸리는 주소를 "강한 행정구역 + 맨 지번(N-N)"으로 잡을 때 쓴다(FP 억제).
const ADDR_ADMIN_STRONG: &str = r"(?:[가-힣]{2,7}\s{0,2}(?:특별자치시|특별자치도|특별시|광역시|시|도)\s*(?:[가-힣]{1,10}\s{0,2}(?:시|군|구)\s*){1,2}|(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|중북|중남|전북|전남|경북|경남|제주)\s*(?:[가-힣]{1,10}\s{0,2}(?:시|군|구)\s*){1,2})";
/// 시/군 아래 읍/면 단위(선택) — "용인시 수지읍 성목리 155"처럼 읍/면이 낀 주소 대응.
const ADDR_SUB: &str = r"(?:[가-힣]{1,10}\s{0,2}(?:읍|면)\s*)?";
/// 도로명 핵심: ○○(대)로/길 + 건물번호[-부번]. `\s{0,2}`로 OCR 공백 허용.
const ADDR_ROAD_CORE: &str = r"[가-힣A-Za-z0-9]{1,20}\s{0,2}(?:대로|로|길)\s*\d+(?:-\d+)?";
/// 지번 핵심: 법정동/리(읍/면 포함) + 지번[-부번][번지]. `\s{0,2}`: OCR이 "반포 동"처럼
/// 동/리 접미 앞에 공백을 끼워 넣는 것을 허용(스캔본 대응 — 실제 미검출 주요 원인).
const ADDR_JIBUN_CORE: &str = r"[가-힣]{1,10}[\s\d]{0,3}(?:읍|면|동|리)\s*\d+(?:-\d+)?(?:번지)?";
/// 상세주소(선택·반복, 사용자 제공 한국 주소 꼬리 패턴): "n층 n호", "n층", "n호",
/// "[숫자/알파벳]동 n호", "[숫자/알파벳]동", "[숫자/알파벳]-n", "n(1~3)-n(1~3)".
/// 각 항을 `*`로 반복 허용해 "302동 1503호", "B동 901호", "203-705" 등을 마저 잇는다.
const ADDR_DETAIL: &str =
    r"(?:\s*,?\s*(?:[A-Za-z0-9]{1,4}\s*(?:동|층|호|가|번지)|\d{1,3}\s*-\s*\d{1,3}))*";
/// 지번 없는 동/리 토큰(사전 검증 규칙용) — 뒤에 지번 숫자를 요구하지 않는다.
const ADDR_DONG_TOKEN: &str = r"[가-힣]{1,6}[\s\d]{0,3}(?:동|리)";
/// 마을/단지/아파트 등 **건물·단지 종류 키워드**(사용자 요청: [APT, 아파트, 빌라,
/// 타운, 마을, 단지] + 주공, 그리고 불완전 OCR 변형 "마를"·"T"(APT)). 법정동/도로명/
/// 지번이 없어도 "○○구/시 + △△마을/단지/APT"를 주소로 인정한다(예: "경기도 성남시
/// 분당구 매화마을"). ※ 검출된 주소 뒤에 이어지는 건물(어떤 OCR이든)은 좌표 셀
/// 재구성(address_cell_indices)이 이미 함께 묶으므로, 이 목록은 "건물만 있는(동/
/// 지번 없는)" 주소를 잡기 위한 것이다. "T"는 A·P가 탈락한 APT의 흔한 오인식.
///
/// 두 분기: (1) 일반 건물종류 키워드 — 앞에 이름 접두 필수(마을/단지/주공/맨션/맨숀/
/// 주택/시티 등). (2) **한국 주요 아파트 브랜드**(자이·래미안·힐스테이트·더샵·롯데캐슬·
/// 푸르지오·편한세상·SK뷰·아이파크·위브) — 그 자체가 고유명이라 이름 접두를 선택적으로
/// 둔다("분당구 자이"·"반포 래미안" 모두). 영문/공백 변형("더 샵"·"SK 뷰"·"e편한세상")
/// 대응. 브랜드는 특이도가 높아 접두 없이도 FP 위험이 작다.
/// A-3(DET-17): 둘째 줄 "건물 상세" 주소(행정구역 없이 건물+호수만) 검출. 실 스캔
/// 표는 주소가 2줄(1줄 지역+지번, 2줄 건물)인 경우가 많아 둘째 줄이 행정구역이 없어
/// 미검출됐다. 건물 키워드 + 근처 숫자(동/호/번지 단위 또는 N-N 동호/지번). 스캔
/// 텍스트 레이어의 뒤섞임 대비로 키워드-숫자 **양쪽 순서**를 모두 허용한다. "건물
/// 앵커+숫자" 조합이라 신문 본문 등 지역명 단독 언급의 FP는 낮다(사용자 판단: FN보다
/// 나음). 숫자는 동/호/번지 단위(앞 알파 1자 허용 — "B동")·N-N(알파 허용 — "A-3")·
/// "APT.101"의 점 구분자까지 받는다. 'T'(APT의 OCR 탈락형)는 단독은 FP가 커 제외하되,
/// **한글 접두가 반드시 앞서는 "○○ T 동/호"**만 별도 분기로 잡는다("궁전 T 동 901호").
const ADDR_BUILDING_LINE: &str = concat!(
    r"(?:",
    // 정방향: [단지명 접두?] 건물키워드 … 숫자. 접두는 건물명("우성"빌라·"서강LG"APT)을
    // 함께 잡되 **숫자는 제외**해 앞 줄의 지번(123)까지 뻗어 claim된 주소와 겹쳐 스킵되는
    // 것을 막는다. 키워드 목록 끝의 '빌'은 "하이빌"류 접미(더 긴 빌라/빌리지/빌딩이 먼저).
    r"(?:[가-힣A-Za-z]{1,10}\s{0,2})?",
    r"(?:아파트먼트|아파트|APT|빌라|빌리지|빌딩|맨션|맨숀|주택|시티|주공|타워|타운|단지|연립|마을|자이|래미안|힐스테이트|더\s?샵|롯데캐슬|푸르지오|편한세상|SK\s?뷰|아이파크|위브|빌)",
    r"[가-힣A-Za-z0-9\s.]{0,12}(?:[A-Za-z]?\d+\s*(?:동|호|번지|가|층)|[A-Za-z0-9]+\s*-\s*\d+)",
    // 역방향(스캔 뒤섞임): 숫자 … 건물키워드.
    r"|(?:[A-Za-z]?\d+\s*(?:동|호|번지|가|층)|[A-Za-z0-9]+\s*-\s*\d+)[가-힣A-Za-z0-9\s.]{0,12}",
    r"(?:아파트먼트|아파트|APT|빌라|빌리지|빌딩|맨션|맨숀|주택|시티|주공|타워|타운|단지|연립|마을|자이|래미안|힐스테이트|더\s?샵|롯데캐슬|푸르지오|편한세상|SK\s?뷰|아이파크|위브|빌)",
    // T(=APT OCR): 한글 접두 필수 + **동/N-N 단위 필수**인 "○○ T … N동[ N호]"만.
    // 단독 T나 "T 3호"류(방번호)는 FP가 커 제외 — 실제 아파트 동/호 형태만 잡는다.
    r"|(?:[가-힣]\s{0,2}){1,4}T\s{0,2}(?:\d+\s*동(?:\s*\d+\s*호)?|동\s*\d{2,}\s*호|[A-Za-z0-9]+\s*-\s*\d+)",
    r")",
);

const ADDR_BUILDING_TOKEN: &str = concat!(
    r"(?:[가-힣A-Za-z0-9]{1,12}\s{0,2}",
    r"(?:마을|마를|아파트|아파트먼트|APT|빌라|빌리지|타운|단지|주공|맨션|맨숀|주택|시티|연립|빌딩|타워|T|빌)",
    r"|(?:[가-힣A-Za-z0-9]{1,12}\s{0,2})?",
    r"(?:자이|래미안|힐스테이트|더\s?샵|롯데캐슬|푸르지오|편한세상|SK\s?뷰|아이파크|위브))",
);

/// §5.3.1 정규식 레퍼런스. 우선순위(먼저 매치를 "선점"하는 순서) 순으로 나열 —
/// 겹치는 범위를 여러 규칙이 동시에 후보로 내는 경우(예: 전화번호가 계좌번호
/// 패턴에도 걸리는 경우) 먼저 오는 규칙이 그 범위를 가져간다. 더 특이도가 높은
/// (긴/구분자 있는) 카테고리를 앞에 둔다.
///
/// 정규식·체크섬·anchor 룰 일부는 ko-pii(<https://github.com/Marker-Inc-Korea/ko-pii>,
/// MIT, © Marker Inc. Korea)의 patterns/checksum을 참고해 재구현했다.
pub fn default_rules() -> Vec<DetectionRule> {
    vec![
        DetectionRule {
            category: "RRN",
            pattern_type: "RRN",
            regex: compile(r"\d{6}[-\s]?\d{7}"),
            // 체크섬 Valid 시 0.6+0.3=0.9, 실패해도 0.6 유지(fail-safe). anchor 시 +0.2.
            base_confidence: 0.6,
            validate: validate_rrn,
            anchors: &[AnchorGroup { keywords: RRN_ANCHOR, reclassify: None }],
            anchor_required: false,
        },
        DetectionRule {
            category: "Card",
            pattern_type: "Card",
            // 4-4-4-N 그룹(구분자 -, ., 공백, /) 또는 13~19 연속 숫자.
            regex: compile(
                r"(?:\d{4}[-.\s/]\d{4}[-.\s/]\d{4}[-.\s/]\d{1,7}|\d{13,19})",
            ),
            base_confidence: 0.4,
            validate: validate_card,
            anchors: &[AnchorGroup { keywords: CARD_ANCHOR, reclassify: None }],
            anchor_required: false,
        },
        DetectionRule {
            category: "Passport",
            pattern_type: "Passport",
            regex: compile(r"[MSROD](?:\d{8}|\d{3}[A-Z]\d{4})"),
            // 여권은 정규식 문자셋 자체가 형식 검증(§5.3) → 매치=Valid. 문맥 시 상향.
            base_confidence: 0.5,
            validate: validate_format_only,
            anchors: &[AnchorGroup { keywords: PASSPORT_CONTEXT, reclassify: None }],
            anchor_required: false,
        },
        DetectionRule {
            category: "Email",
            pattern_type: "Email",
            regex: compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"),
            // 형식 특이도가 높아(@ 포함) 기본 confidence를 높게 둔다.
            base_confidence: 0.85,
            validate: validate_format_only,
            anchors: &[AnchorGroup { keywords: EMAIL_ANCHOR, reclassify: None }],
            anchor_required: false,
        },
        DetectionRule {
            category: "PhoneNumber",
            pattern_type: "PhoneNumber",
            // 지역번호는 괄호 표기((02)2679-8201)도 흔하므로 `\(?…\)?`로 허용하고,
            // 구분자에 '.'도 포함한다. 휴대폰은 괄호를 잘 안 쓰므로 그대로.
            // 끝의 `(?:,\s?\d{4})*`: 앞자리를 공유하는 축약 나열("…8201,8327")의
            // 뒤 4자리도 함께 매치해 마킹에서 빠지지 않게 한다(사용자 재현).
            regex: compile(
                r"(?:01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?:,\s?\d{4})*)|(?:\(?(?:02|031|032|033|041|042|043|044|051|052|053|054|055|061|062|063|064|070|080)\)?[-.\s]?\d{3,4}[-.\s]?\d{4}(?:,\s?\d{4})*)",
            ),
            base_confidence: 0.5,
            validate: validate_no_checksum,
            // 팩스 문맥이 앞서면 FaxNumber로 재분류, 아니면 전화 문맥으로 가점.
            anchors: &[
                AnchorGroup { keywords: FAX_CONTEXT, reclassify: Some(("FaxNumber", "FaxNumber")) },
                AnchorGroup { keywords: PHONE_FAX_CONTEXT, reclassify: None },
            ],
            anchor_required: false,
        },
        DetectionRule {
            // 지역번호 없는 로컬 번호("전송: 2679-8328")나 화이트리스트에 없는 괄호
            // 접두(국가번호 "(65)6253-1033" 등, 사용자 재현)를 포함. 오탐이 커
            // 전화/팩스 앵커가 앞설 때만 검출한다(anchor 필수). 팩스 문맥이면 재분류.
            category: "PhoneNumber",
            pattern_type: "PhoneNumber",
            // 구분자는 선택(옵션): "6253-1033"뿐 아니라 "(65)62531033"처럼 붙여쓴
            // 형태도 잡아야 한다(실제 p.7 텍스트). anchor 필수라 과검출은 제한적.
            regex: compile(r"(?:\(\d{1,4}\)[-.\s]?)?\d{3,4}[-.\s]?\d{4}(?:,\s?\d{4})*"),
            base_confidence: 0.4,
            validate: validate_no_checksum,
            anchors: &[
                AnchorGroup { keywords: FAX_CONTEXT, reclassify: Some(("FaxNumber", "FaxNumber")) },
                AnchorGroup { keywords: PHONE_FAX_CONTEXT, reclassify: None },
            ],
            anchor_required: true,
        },
        DetectionRule {
            category: "BankAccount",
            pattern_type: "BankAccount",
            regex: compile(r"\d{2,6}[-\s]\d{2,6}[-\s]\d{1,6}(?:[-\s]\d{1,6})?"),
            base_confidence: 0.5,
            validate: validate_no_checksum,
            anchors: &[AnchorGroup { keywords: ACCOUNT_ANCHOR, reclassify: None }],
            // 계좌번호는 형식이 흔해 anchor 없이는 오탐이 커 검출 제외.
            anchor_required: true,
        },
        DetectionRule {
            category: "DateOfBirth",
            pattern_type: "DateOfBirth",
            regex: compile(
                r"(?:(?:18|19|20)\d{2}|\d{2})(?:\s*년\s*(?:1[0-2]|0?[1-9])\s*월\s*(?:3[01]|[12]\d|0?[1-9])\s*일|\s*[.\-/]\s*(?:1[0-2]|0?[1-9])\s*[.\-/]\s*(?:3[01]|[12]\d|0?[1-9])\s*\.?)",
            ),
            base_confidence: 0.3,
            validate: validate_none,
            anchors: &[AnchorGroup { keywords: DOB_ANCHOR, reclassify: None }],
            // 날짜 형식은 흔해 오탐이 크므로 "생년월일/생일" anchor 없이는 검출 제외.
            anchor_required: true,
        },
        // DET-14 주소 — 우선순위: ① 행정구역 포함 전체주소(anchor 불필요) →
        // ② 도로명 핵심(anchor 필수) → ③ 지번 핵심(anchor 필수). 표의 '주소'
        // 컬럼처럼 헤더가 셀과 인접하지 않아도, 셀 안의 전체 주소(시도/시군구
        // 포함)는 ①로 잡힌다. anchor(주소/거주/본적/자택/배송/발송)가 앞서면
        // ①도 confidence 가점을 받는다.
        DetectionRule {
            category: "Address",
            pattern_type: "Address",
            // ① 행정구역(시도/시군구) [읍/면] + 도로명|지번 핵심 + 상세. anchor 불필요.
            regex: compile(&format!(
                "{ADDR_ADMIN}{ADDR_SUB}(?:{ADDR_ROAD_CORE}|{ADDR_JIBUN_CORE}){ADDR_DETAIL}"
            )),
            base_confidence: 0.5,
            validate: validate_none,
            anchors: &[AnchorGroup { keywords: ADDRESS_ANCHOR, reclassify: None }],
            anchor_required: false,
        },
        DetectionRule {
            category: "Address",
            pattern_type: "AddressDict",
            // ①-b 지번이 없는 "○○구/시 + 법정동/리"(예: "용산구 서빙고동 신동아APT").
            // 끝 동/리를 법정동 사전에서 검증(validate_address_dict) — 실존 법정동만
            // 인정해 recall↑(지번 없는 주소)·precision↑(비-법정동 "사무동" 배제).
            // 지번 있는 주소는 위 ①이 먼저 선점하므로 지번 없는 경우만 여기서 잡힌다.
            regex: compile(&format!("{ADDR_ADMIN}{ADDR_SUB}{ADDR_DONG_TOKEN}")),
            base_confidence: 0.5,
            validate: validate_address_dict,
            anchors: &[AnchorGroup { keywords: ADDRESS_ANCHOR, reclassify: None }],
            anchor_required: false,
        },
        DetectionRule {
            category: "Address",
            pattern_type: "AddressFuzzy",
            // ①-c OCR로 동 접미가 손상된 동("영등포구 여의도를"→여의도동)만 법정동
            // 사전과 편집거리 1로 매칭. 후보를 **동의 시각적 변형 접미(를/롱/둥/등)로
            // 끝나는 경우로 한정**해, 사람이름·시군구 조각의 퍼지 오탐을 배제하고
            // greedy 과다매칭도 그 접미에서 멈춘다. 정확 일치는 ①-b가 먼저 선점.
            regex: compile(&format!(r"{ADDR_ADMIN}{ADDR_SUB}[가-힣]{{2,5}}(?:를|롱|둥|등)")),
            base_confidence: 0.45,
            validate: validate_address_fuzzy_dict,
            anchors: &[AnchorGroup { keywords: ADDRESS_ANCHOR, reclassify: None }],
            anchor_required: false,
        },
        DetectionRule {
            category: "Address",
            pattern_type: "AddressBuilding",
            // ①-d 법정동/도로명/지번이 없어도 "○○구/시 + △△마을/단지/주공/APT"는
            // 주소로 인정(사용자 요청 — "경기도 성남시 분당구 매화마을"). 좌표 셀
            // 재구성이 뒤 건물·호수를 마저 묶는다. 정확 동/도로명은 위 규칙이 선점.
            regex: compile(&format!("{ADDR_ADMIN}{ADDR_SUB}{ADDR_BUILDING_TOKEN}")),
            base_confidence: 0.4,
            validate: validate_none,
            anchors: &[AnchorGroup { keywords: ADDRESS_ANCHOR, reclassify: None }],
            anchor_required: false,
        },
        DetectionRule {
            category: "Address",
            pattern_type: "Address",
            // ② 도로명 핵심만(행정구역 없음) — anchor 필수. 예: "주소: 테헤란로 123".
            regex: compile(&format!("{ADDR_ROAD_CORE}{ADDR_DETAIL}")),
            base_confidence: 0.5,
            validate: validate_none,
            anchors: &[AnchorGroup { keywords: ADDRESS_ANCHOR, reclassify: None }],
            anchor_required: true,
        },
        DetectionRule {
            category: "Address",
            pattern_type: "Address",
            // ③ 지번 핵심만(행정구역 없음) — anchor 필수. 예: "거주: 역삼동 123-45".
            regex: compile(&format!("{ADDR_JIBUN_CORE}{ADDR_DETAIL}")),
            base_confidence: 0.5,
            validate: validate_none,
            anchors: &[AnchorGroup { keywords: ADDRESS_ANCHOR, reclassify: None }],
            anchor_required: true,
        },
        DetectionRule {
            category: "Address",
            pattern_type: "AddressDamagedDong",
            // ⑤ 동명이 OCR로 손상된 주소: **강한 행정구역**(시도접미+시군구) + [손상된
            // 동?] + 맨 지번(N-N[번지]). 예 "광주광역시 서구 (양2)동 60-2"에서 동명이
            // "동"만 남아 ①~③이 못 잡는 경우. 강한 행정구역 + 지번이라 FP는 제한적.
            regex: compile(&format!(
                r"{ADDR_ADMIN_STRONG}{ADDR_SUB}(?:[가-힣]{{0,4}}[\s\d]{{0,3}}동\s*)?\d{{1,4}}\s*-\s*\d{{1,4}}(?:번지)?"
            )),
            base_confidence: 0.4,
            validate: validate_none,
            anchors: &[AnchorGroup { keywords: ADDRESS_ANCHOR, reclassify: None }],
            anchor_required: false,
        },
        DetectionRule {
            category: "Address",
            pattern_type: "AddressBuildingLine",
            // ④ A-3: 둘째 줄 건물 상세(행정구역 없이 "건물키워드+숫자"). 위 ①~③이
            // 먼저 선점하고 주소 셀 범위를 claim하므로, 같은 줄 건물은 여기서 다시
            // 안 잡히고 **행정구역이 없어 위에서 못 잡은 별도 줄 건물만** 잡힌다.
            regex: compile(ADDR_BUILDING_LINE),
            base_confidence: 0.35,
            validate: validate_none,
            anchors: &[AnchorGroup { keywords: ADDRESS_ANCHOR, reclassify: None }],
            anchor_required: false,
        },
        // 서울(02) 국번 생략형 로컬 번호(사용자 요청) — 예전 문서는 서울 번호에서
        // 02를 흔히 생략했다("788-2791"). anchor 없이도 잡되, 오탐을 줄이려
        // (1) 구분자를 하이픈/점으로 한정(공백 제외 — 표의 다른 숫자열과 섞임 방지),
        // (2) 뒷자리를 정확히 4자리로 요구(아파트 "203-705" 같은 3-3 동-호 배제),
        // (3) **가장 낮은 우선순위**로 둬 다른 규칙(주소·계좌 등)이 먼저 선점하게 한다.
        // (02)·02) 등 02가 표기된 형태는 위 지역번호 규칙(PhoneNumber ①)이 이미 처리.
        DetectionRule {
            category: "PhoneNumber",
            pattern_type: "PhoneNumberSeoulLocal",
            regex: compile(r"\d{3,4}[-.]\d{4}(?:,\s?\d{4})*"),
            base_confidence: 0.35,
            validate: validate_no_checksum,
            anchors: &[
                AnchorGroup { keywords: FAX_CONTEXT, reclassify: Some(("FaxNumber", "FaxNumber")) },
                AnchorGroup { keywords: PHONE_FAX_CONTEXT, reclassify: None },
            ],
            anchor_required: false,
        },
    ]
}

/// DET-03(§5.3 RRN 행): 11-modulus 체크섬. 13자리 숫자가 아니면(정규식이
/// 보장하지만 방어적으로) 검증 대상이 아니라고 보아 invalid로 처리한다.
fn rrn_checksum_valid(matched_text: &str) -> bool {
    const WEIGHTS: [u32; 12] = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];

    let digits: Vec<u32> = matched_text.chars().filter_map(|c| c.to_digit(10)).collect();
    if digits.len() != 13 {
        return false;
    }

    let sum: u32 = digits[..12].iter().zip(WEIGHTS).map(|(d, w)| d * w).sum();
    let check_digit = (11 - (sum % 11)) % 10;
    check_digit == digits[12]
}

/// Luhn(카드) 체크섬. 구분자·공백은 무시하고 숫자만 취한다. ko-pii checksum/luhn.py 참고.
fn luhn_valid(matched_text: &str) -> bool {
    let digits: Vec<u32> = matched_text.chars().filter_map(|c| c.to_digit(10)).collect();
    if digits.len() < 12 {
        return false;
    }
    let sum: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(i, &d)| {
            if i % 2 == 1 {
                let doubled = d * 2;
                if doubled > 9 {
                    doubled - 9
                } else {
                    doubled
                }
            } else {
                d
            }
        })
        .sum();
    sum % 10 == 0
}

/// 1:1 정규화(§ 정규화 1단계): 전각 형태(U+FF01..FF5E)를 반각 ASCII로, 전각
/// 공백(U+3000)을 일반 공백으로 치환한다. **글자 수를 바꾸지 않으므로**(1 char →
/// 1 char) `chars` 배열과 텍스트 인덱스 정렬이 유지되어 back-map이 필요 없다.
/// 전각 숫자(`０１０`)로 패턴을 우회하는 것을 차단한다.
fn normalize_char(c: char) -> char {
    match c {
        '\u{FF01}'..='\u{FF5E}' => {
            // 전각 ASCII 구간을 반각으로: 오프셋 0xFEE0.
            char::from_u32(c as u32 - 0xFEE0).unwrap_or(c)
        }
        '\u{3000}' => ' ', // 전각 공백
        _ => c,
    }
}

/// DET-13(사용자 요청): OCR이 숫자를 라틴/기호로 오인식한 것을 **숫자 문맥에
/// 한해** 되돌린다(l·I·|→1, O·o→0, 한글 'ㅡ'→'-'). 일반 텍스트(IBM 등) 훼손을
/// 막기 위해, "숫자·혼동문자·구분자(- .)"로 이어진 토큰 **안에 실제 숫자가 하나라도
/// 있을 때만** 그 토큰의 혼동문자를 치환한다. 글자 수를 바꾸지 않아(1:1) 원본
/// char 인덱스 정렬이 유지된다.
fn normalize_ocr_digits(chars: &[char]) -> Vec<char> {
    fn is_conf(c: char) -> bool {
        matches!(c, 'l' | 'I' | '|' | 'O' | 'o' | 'ㅡ')
    }
    fn is_token(c: char) -> bool {
        c.is_ascii_digit() || is_conf(c) || matches!(c, '-' | '.')
    }
    fn to_digit(c: char) -> char {
        match c {
            'l' | 'I' | '|' => '1',
            'O' | 'o' => '0',
            'ㅡ' => '-',
            _ => c,
        }
    }

    let mut out = chars.to_vec();
    let n = chars.len();
    let mut i = 0;
    while i < n {
        if !is_token(chars[i]) {
            i += 1;
            continue;
        }
        let start = i;
        while i < n && is_token(chars[i]) {
            i += 1;
        }
        // 이 토큰 안에 진짜 숫자가 있으면(=번호 맥락) 혼동문자를 숫자로 보정.
        if chars[start..i].iter().any(|c| c.is_ascii_digit()) {
            for slot in out[start..i].iter_mut() {
                *slot = to_digit(*slot);
            }
        }
    }
    out
}

/// UTC now, 프론트 `Date.toISOString()`과 동일한 형식("...000Z").
pub fn current_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// §5.3.2: 매치 앞쪽 문맥을 살펴볼 범위(문자 수, "약 15자"). 접두어 자체에
/// 공백이 낄 수 있고("passport number", "여권 번호") 공백 유무와 무관하게
/// 인식해야 하므로, 공백 제거 전 원본 기준으로는 여유를 두고 조금 더 넓게 잡는다.
const CONTEXT_WINDOW_CHARS: usize = 24;

/// 매치 시작 위치 바로 앞 `CONTEXT_WINDOW_CHARS`자를 소문자로 반환한다.
fn context_before(text: &str, start_char: usize) -> String {
    let from = start_char.saturating_sub(CONTEXT_WINDOW_CHARS);
    text.chars().skip(from).take(start_char - from).collect::<String>().to_lowercase()
}

fn strip_whitespace(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

fn context_matches(window: &str, keywords: &[&str]) -> bool {
    let normalized = strip_whitespace(window);
    keywords.iter().any(|keyword| normalized.contains(keyword))
}

/// §5.3.2: 매치 앞쪽 문맥을 훑어, 첫 번째로 매치되는 anchor 그룹의 재분류·가점을
/// 돌려준다(재분류가 있으면 category/pattern_type 교체, 매치 시 confidence 가점).
/// **매치가 없으면 `None`** — 호출부가 anchor 필수 여부에 따라 검출 제외/기본값을 정한다.
fn resolve_anchor(
    category: &'static str,
    pattern_type: &'static str,
    anchors: &[AnchorGroup],
    context: &str,
) -> Option<(&'static str, &'static str, f32)> {
    for group in anchors {
        if context_matches(context, group.keywords) {
            let (cat, ptype) = group.reclassify.unwrap_or((category, pattern_type));
            return Some((cat, ptype, CONTEXT_CONFIDENCE_BOOST));
        }
    }
    None
}

/// 매치 구간이 **표 셀 경계**를 넘었는지(사용자 재현: "유동훈 2275-0566 2278-7202"가
/// 하나의 신용카드로 오인식). 좌표 기반: 글자당 평균 가로 폭이 대표 글자 폭의 2배를
/// 넘으면(=비정상적으로 벌어짐) 셀 경계를 넘어 두 값을 잘못 묶은 것으로 본다. 공백
/// 제거 등 정규화 이전, 원본 글자 좌표로만 판단하는 로직이다.
fn spans_a_cell_gap(chars: &[PositionedChar]) -> bool {
    if chars.len() < 2 {
        return false;
    }
    let typical = chars[0].bbox.width.max(1e-4);
    // 인접 글자 사이 최대 진행폭(next.x - cur.x)이 대표 글자폭의 2배를 넘으면,
    // 그 지점에 표 셀 경계 수준의 빈틈이 있다고 본다(넓은 공백 글자·좌표 점프 모두 포함).
    chars.windows(2).any(|w| (w[1].bbox.x - w[0].bbox.x) > typical * 2.0)
}

fn median_f32(mut v: Vec<f32>) -> f32 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    v[v.len() / 2]
}

/// 컬럼 경계(가로 거리) 측정에 쓸 "주소 글자" — 한글·영문·숫자·하이픈만 참으로
/// 본다. 표 세로줄(`|`)·OCR 노이즈(`~ ^ ; " ' \` 등)는 **투명 취급**해, 그것들이
/// 컬럼 사이 빈틈을 메워 경계 감지를 무력화하지 못하게 한다(실 스캔 표에서 이름
/// 컬럼이 주소로 흡수되던 오검출의 원인). content 포함은 좌표 기반(in_col)이라
/// 확정된 셀 범위 안의 문장부호(`.`·`(`·`)` 등)는 그대로 유지된다.
fn is_address_glyph(c: char) -> bool {
    is_hangul_syllable(c) || c.is_ascii_alphanumeric() || c == '-'
}

/// 한국 우편번호 형태인지(사용자 규칙). 좌측 셀 확장에서 주소 왼쪽의 숫자 토큰이
/// 우편번호면 주소의 일부로 포함하고, 아니면(전화·코드 등) 흡수하지 않게 구분한다.
/// - 구 우편번호: `ddd-ddd`, 맨 앞자리 1~7
/// - 신 우편번호: `ddddd`(5자리), 맨 앞 두 자리 01~63
fn is_postal_token(s: &str) -> bool {
    let digits: Vec<char> = s.chars().filter(|c| c.is_ascii_digit()).collect();
    let has_hyphen = s.contains('-');
    if has_hyphen && digits.len() == 6 {
        // ddd-ddd, 첫자리 1~7
        return matches!(digits[0], '1'..='7');
    }
    if !has_hyphen && digits.len() == 5 {
        // ddddd, 앞 두자리 01~63
        let head: u32 = format!("{}{}", digits[0], digits[1]).parse().unwrap_or(99);
        return (1..=63).contains(&head);
    }
    false
}

/// 좌측 확장을 멈춰야 하는 "비-우편번호 유의미 숫자"인지 — 3자리 이상 숫자 토큰
/// 인데 우편번호 형태가 아니면(전화·코드·행번호 등) 주소 밖으로 보고 흡수하지 않는다.
fn is_nonpostal_significant_number(s: &str) -> bool {
    let digit_count = s.chars().filter(|c| c.is_ascii_digit()).count();
    digit_count >= 3 && !is_postal_token(s)
}

/// 이어지는 줄(연속 셀 후보)이 **새 행정구역으로 시작**하는지. 그렇다면 위 주소의
/// 이어짐(건물 상세 줄)이 아니라 아래 행의 **새 주소**이므로 한 셀로 합치지 않는다
/// (사용자 요청: [도-시-구-동] 체계가 연달아 나오면 별개 주소로 분리 — 예 "광주시
/// 서구 …" 아래 "중북 청주시 …"). 건물 상세 줄("금호 APT …")은 행정구역으로 시작
/// 하지 않아 영향받지 않는다.
fn line_starts_with_admin(text: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| compile(&format!(r"^\s*{ADDR_ADMIN}")))
        .is_match(text)
}

/// DET-14(좌표 기반 셀 재구성): 검출된 주소 씨앗 글자범위 `[start,end)`를 시작으로,
/// **같은 표 셀**(같은 x-컬럼 + 바로 아래로 이어지는 줄)의 글자들을 좌표로 모아
/// 반환한다(시각적 읽기순서로 정렬). 건물명·상세·셀 내 줄바꿈까지 한 주소로
/// 묶되, **가로 빈틈(컬럼 경계)**을 넘어 옆 칸(전화 등)으로 번지지 않고, 어떤 줄에
/// 성명 컬럼(셀 좌측 경계 왼쪽)에 글자가 나타나면 **새 행**으로 보고 멈춘다.
/// 좌표가 불충분하면 원래 범위를 그대로 돌려준다(안전).
///
/// `max_cont_lines`: 씨앗 줄 아래로 몇 줄까지 같은 셀로 이어붙일지. ①~③(지역+지번)
/// 은 2(같은 셀 건물 줄을 마저 묶음), ④ 건물줄(A-3)은 0(그 줄 자체가 건물이라 아래로
/// 안 번지게 — 스캔 좌표가 뒤섞여 아래 행을 잘못 흡수하는 것 방지).
fn address_cell_indices(
    chars: &[PositionedChar],
    start: usize,
    end: usize,
    max_cont_lines: usize,
) -> Vec<usize> {
    let fallback: Vec<usize> = (start..end).collect();
    let seed = &chars[start..end];
    if seed.len() < 2 {
        return fallback;
    }
    let cw = median_f32(seed.iter().map(|c| c.bbox.width).collect()).max(1e-4);
    let ch = median_f32(seed.iter().map(|c| c.bbox.height).collect()).max(1e-4);
    let col_gap = cw * 2.0; // 컬럼 경계로 볼 가로 빈틈
    let name_margin = cw * 0.8; // 성명 컬럼 진입 판정 여유
    // max_cont_lines: 셀 내 이어지는 줄 최대(크로스-행 번짐 억제) — 인자로 받는다.

    let seed_left = seed.iter().map(|c| c.bbox.x).fold(f32::MAX, f32::min);
    let seed_right = seed.iter().map(|c| c.bbox.x + c.bbox.width).fold(f32::MIN, f32::max);
    let center_y = |c: &PositionedChar| c.bbox.y + c.bbox.height * 0.5;
    let seed_yc = median_f32(seed.iter().map(|c| center_y(c)).collect());

    let same_seed_line = |c: &PositionedChar| (center_y(c) - seed_yc).abs() < ch * 0.6;

    // 표 세로줄(`|` 등 vertical bar)은 **명시적 컬럼 경계**로 취급한다 — 투명
    // 취급되는 다른 노이즈와 달리, 이름 컬럼이 주소에 좁게 붙어(가로 빈틈이
    // col_gap 미만) 간격만으로는 안 갈리는 경우에도 세로줄에서 확실히 끊는다
    // (실 스캔 표 다수 행이 `성명 | 주소` 형태). 씨앗 좌/우로 가장 가까운
    // 세로줄 위치를 구해, 좌/우 확장이 그 선을 넘지 못하게 한다.
    let is_bar = |c: char| matches!(c, '|' | '│' | '┃' | '｜' | '∣' | 'ǀ' | '⏐' | '￨' | 'ｌ');
    let bar_left_edge = chars
        .iter()
        .filter(|c| same_seed_line(c) && is_bar(c.ch) && c.bbox.x + c.bbox.width <= seed_left + cw * 0.1)
        .map(|c| c.bbox.x)
        .fold(f32::NEG_INFINITY, f32::max);
    let bar_right_edge = chars
        .iter()
        .filter(|c| same_seed_line(c) && is_bar(c.ch) && c.bbox.x >= seed_right - cw * 0.1)
        .map(|c| c.bbox.x + c.bbox.width)
        .fold(f32::INFINITY, f32::min);

    // 1) 윗줄 우측 경계(cell_right): 같은 줄에서 씨앗 오른쪽 글자들을 x순으로 훑어,
    //    직전 오른끝과의 빈틈이 col_gap을 넘으면 그 앞에서 멈춘다.
    let mut right_run: Vec<(f32, f32)> = chars
        .iter()
        .filter(|c| {
            same_seed_line(c) && is_address_glyph(c.ch) && c.bbox.x + c.bbox.width > seed_right + cw * 0.1
        })
        .map(|c| (c.bbox.x, c.bbox.x + c.bbox.width))
        .collect();
    right_run.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut cell_right = seed_right;
    for (x, xr) in right_run {
        if x >= bar_right_edge {
            break; // 표 세로줄(오른쪽 컬럼 경계) 너머 → 셀 밖
        }
        if x - cell_right > col_gap {
            break;
        }
        cell_right = cell_right.max(xr);
    }

    // 1-b) 윗줄 좌측 경계(cell_left) 확장(사용자 통찰 — 인접성=앵커): 같은 줄에서
    //    씨앗 왼쪽 글자들을 오른→왼으로 훑어, 큰 빈틈(컬럼 경계)을 만나기 전까지는
    //    같은 셀(주소 접두 "중남"·"서 울시" 등)로 보고 포함한다. 큰 빈틈이 아예
    //    없으면(연속 산문 "주소: …") 확장하지 않아 라벨을 끌어오지 않는다.
    let mut left_run: Vec<(f32, f32, char)> = chars
        .iter()
        .filter(|c| same_seed_line(c) && is_address_glyph(c.ch) && c.bbox.x < seed_left - cw * 0.1)
        .map(|c| (c.bbox.x, c.bbox.x + c.bbox.width, c.ch))
        .collect();
    left_run.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)); // 오른끝 내림차순
    let mut cell_left = seed_left;
    let mut found_left_boundary = false;
    // A-1(개정): 좌측으로 이어붙이는 숫자 토큰을 **우편번호 형태로만** 포함한다.
    // 우편번호(ddd-ddd·ddddd)면 주소의 일부로 보고 그 왼쪽 끝을 주소 좌측 경계로
    // 확정하고, 우편번호가 아닌 3자리+ 숫자(전화·코드·행번호 등)면 그 토큰을 흡수
    // 하지 않고 멈춘다 — "334 앙천구…"의 앞 코드번호나 옆 칸 전화 흡수를 막는다.
    let mut num_token = String::new(); // 진행 중 숫자 토큰(우→좌라 앞에 붙임)
    let mut cell_left_before_token = seed_left; // 비-우편번호면 이 값으로 복원(토큰 제외)
    for (x, xr, ch) in left_run {
        if x <= bar_left_edge {
            found_left_boundary = true;
            break; // 표 세로줄(왼쪽 컬럼 경계) 너머 → 셀 밖(성명 칸 등)
        }
        if cell_left - xr > col_gap {
            found_left_boundary = true;
            break; // 컬럼 경계(성명 칸 등) → 여기서 멈춤(그 앞은 셀 밖)
        }
        if ch.is_ascii_digit() || ch == '-' {
            if num_token.is_empty() {
                cell_left_before_token = cell_left; // 이 숫자 토큰을 포함하기 직전 경계
            }
            num_token.insert(0, ch);
            cell_left = cell_left.min(x);
        } else {
            // 한글 등 → 숫자 토큰 종료.
            if is_nonpostal_significant_number(&num_token) {
                cell_left = cell_left_before_token; // 전화·코드 등 → 그 토큰 제외
                found_left_boundary = true;
                break;
            }
            if is_postal_token(&num_token) {
                found_left_boundary = true; // 우편번호 = 주소 좌측 끝 → 확정하고 멈춤
                break;
            }
            num_token.clear();
            cell_left = cell_left.min(x);
        }
    }
    // 루프가 왼쪽 끝까지 갔을 때 마지막 숫자 토큰도 검증한다("(138-200) 서울시…"의
    // 우편번호는 포함해 좌측을 확정, 비-우편번호 코드는 제외).
    if is_nonpostal_significant_number(&num_token) {
        cell_left = cell_left_before_token;
        found_left_boundary = true;
    } else if is_postal_token(&num_token) {
        found_left_boundary = true;
    }
    // 좌측에 경계(컬럼 빈틈·세로줄·우편번호)가 전혀 없으면 연속 산문("주소: …")이
    // 므로 확장하지 않는다 — 라벨을 주소로 끌어오지 않도록.
    if !found_left_boundary {
        cell_left = seed_left;
    }

    // 2) 줄 그룹핑(y-중심 클러스터). 씨앗 줄부터 아래로 이어지는 줄만 셀에 포함.
    let mut by_line: Vec<(f32, Vec<usize>)> = Vec::new(); // (대표 y, 글자 인덱스들)
    let mut order: Vec<usize> = (0..chars.len()).collect();
    order.sort_by(|&a, &b| center_y(&chars[a]).partial_cmp(&center_y(&chars[b])).unwrap_or(std::cmp::Ordering::Equal));
    for i in order {
        let y = center_y(&chars[i]);
        match by_line.last_mut() {
            Some((ly, idxs)) if (y - *ly).abs() < ch * 0.6 => idxs.push(i),
            _ => by_line.push((y, vec![i])),
        }
    }

    // 포함 좌측 경계는 셀 좌측에 거의 붙여(씨앗 앞의 공백·라벨을 끌어오지 않음),
    // 우측은 컬럼 경계까지. name_margin은 아래 새 행(성명) 판정에만 쓴다.
    let in_col = |c: &PositionedChar| {
        // 표 세로줄(|)은 경계 표식일 뿐 주소 내용이 아니므로 content에서 제외한다.
        if is_bar(c.ch) {
            return false;
        }
        let cx = c.bbox.x + c.bbox.width * 0.5;
        cx >= cell_left - cw * 0.25 && cx <= cell_right + col_gap
    };
    let has_name_col = |idxs: &[usize]| idxs.iter().any(|&i| chars[i].bbox.x + chars[i].bbox.width < cell_left - name_margin);

    let mut selected: Vec<usize> = Vec::new();
    let mut prev_y = seed_yc;
    let mut started = false;
    let mut cont = 0usize;
    for (ly, idxs) in &by_line {
        if !started {
            if (ly - seed_yc).abs() < ch * 0.6 {
                started = true;
            } else {
                continue;
            }
        } else {
            // 이어지는 줄: 바로 아래(줄 간격 ~1)이고, 성명 컬럼에 글자가 없어야 한다.
            if *ly <= prev_y + ch * 0.2 {
                continue; // 같은/윗줄은 이미 처리
            }
            cont += 1;
            if cont > max_cont_lines || *ly - prev_y > ch * 3.5 || has_name_col(idxs) {
                break; // 연속줄 한도 초과·줄 간격 큼·새 행(성명 등장) → 셀 끝
            }
            // 이 줄에 컬럼 안 글자가 하나도 없으면 셀과 무관 → 끝.
            if !idxs.iter().any(|&i| in_col(&chars[i])) {
                break;
            }
            // 이 줄이 **새 행정구역으로 시작**하면 아래 행의 새 주소다 → 합치지 않고
            // 끝낸다(체계 연속 분리 — 스캔 좌표가 뒤섞여 행간만으론 못 가르는 경우 대비).
            let mut line_idxs: Vec<usize> = idxs.iter().copied().filter(|&i| in_col(&chars[i])).collect();
            line_idxs.sort_by(|&a, &b| {
                chars[a].bbox.x.partial_cmp(&chars[b].bbox.x).unwrap_or(std::cmp::Ordering::Equal)
            });
            let line_text: String = line_idxs.iter().map(|&i| chars[i].ch).collect();
            if line_starts_with_admin(&line_text) {
                break;
            }
        }
        for &i in idxs {
            if in_col(&chars[i]) {
                selected.push(i);
            }
        }
        prev_y = *ly;
    }

    // 씨앗은 반드시 포함(정규화 등으로 in_col을 벗어나는 글자 방어).
    for i in start..end {
        if !selected.contains(&i) {
            selected.push(i);
        }
    }
    if selected.len() < fallback.len() {
        return fallback;
    }
    // 시각적 읽기순서(줄→x)로 정렬.
    selected.sort_by(|&a, &b| {
        let (ca, cb) = (&chars[a], &chars[b]);
        let la = (center_y(ca) / (ch * 0.6)).round();
        let lb = (center_y(cb) / (ch * 0.6)).round();
        la.partial_cmp(&lb).unwrap_or(std::cmp::Ordering::Equal)
            .then(ca.bbox.x.partial_cmp(&cb.bbox.x).unwrap_or(std::cmp::Ordering::Equal))
    });
    selected
}

/// 매치 구간이 걸친 **줄(세로 레벨) 개수**. 글자 y-중심을 정렬해, 이웃 간 간격이
/// 글자 높이의 절반을 넘으면 새 줄로 센다.
fn line_count(chars: &[PositionedChar]) -> usize {
    if chars.is_empty() {
        return 0;
    }
    let height = chars.iter().map(|c| c.bbox.height).fold(0.0f32, f32::max).max(1e-4);
    let mut centers: Vec<f32> = chars.iter().map(|c| c.bbox.y + c.bbox.height * 0.5).collect();
    centers.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mut lines = 1;
    for w in centers.windows(2) {
        if (w[1] - w[0]) > height * 0.5 {
            lines += 1;
        }
    }
    lines
}

/// 표에서 세로로 나열된 한 자리 숫자들("5, 그 아래 5, 그 아래 3 …")이 텍스트로는
/// 연속돼 보여 13자리 주민번호로 오인식되는 것을 배제한다(사용자 재현 p.139).
/// **단, 문단 중 1회 줄바꿈으로 번호가 두 줄에 나뉜 정상 케이스(=2줄)는 살린다** —
/// 3줄 이상 걸칠 때만 세로 나열로 보아 배제한다(사용자 요청).
fn is_stacked_vertically(chars: &[PositionedChar]) -> bool {
    line_count(chars) > 2
}

/// IO-03에서도 재사용(재앵커링 시 매치된 문자 범위의 bbox를 합칠 때).
pub(crate) fn merge_bbox(chars: &[PositionedChar]) -> RelativeBBox {
    let mut min_x = f32::MAX;
    let mut min_y = f32::MAX;
    let mut max_x = f32::MIN;
    let mut max_y = f32::MIN;

    for c in chars {
        min_x = min_x.min(c.bbox.x);
        min_y = min_y.min(c.bbox.y);
        max_x = max_x.max(c.bbox.x + c.bbox.width);
        max_y = max_y.max(c.bbox.y + c.bbox.height);
    }

    RelativeBBox { x: min_x, y: min_y, width: max_x - min_x, height: max_y - min_y }
}

/// 한 페이지의 문자 목록을 규칙별로 스캔해 후보 [`ReviewItem`]을 `items`에 이어
/// 붙인다. 이미 앞선(우선순위 높은) 규칙이 차지한 문자 범위는 건너뛰어, 같은
/// 텍스트가 여러 후보로 중복 검출되는 것을 막는다.
///
/// 텍스트는 1:1 정규화([`normalize_char`])를 거쳐 매칭·검증하되, 후보의 `content`와
/// `bbox`는 **원본** 글자에서 산출한다(정규화는 글자 수를 바꾸지 않아 인덱스가
/// 그대로 맞으므로, 화면·저장에는 PDF의 실제 글자를 쓴다).
pub fn detect_in_page(
    chars: &[PositionedChar],
    page_index: u32,
    rules: &[DetectionRule],
    now: &str,
    next_id: &mut u32,
    items: &mut Vec<ReviewItem>,
) {
    if chars.is_empty() {
        return;
    }

    // 매칭·검증용 정규화 텍스트(원본과 char 인덱스가 1:1로 정렬됨).
    // 전각→반각(normalize_char) 후, **숫자 문맥에 한해** OCR 라틴/기호 혼동을
    // 숫자로 보정(normalize_ocr_digits) — "0l0-l234"→"010-1234".
    let normalized: Vec<char> = chars.iter().map(|c| normalize_char(c.ch)).collect();
    let text_chars: Vec<char> = normalize_ocr_digits(&normalized);
    let text: String = text_chars.iter().collect();
    let mut claimed = vec![false; chars.len()];

    for rule in rules {
        for m in rule.regex.find_iter(&text) {
            let start_char = text[..m.start()].chars().count();
            let end_char = text[..m.end()].chars().count();

            if claimed[start_char..end_char].iter().any(|&c| c) {
                continue;
            }

            // 검증(fail-safe): Reject면 이 카테고리가 아니므로 건너뛴다(범위 미점유).
            let (validation, checksum_bonus) = match (rule.validate)(m.as_str()) {
                Validation::Reject => continue,
                Validation::Accept { status, bonus } => (status, bonus),
            };

            // 표의 세로 숫자열을 하나로 오인식하는 것 방지: RRN/카드처럼 연속 숫자
            // 열이 3줄 이상 세로로 걸쳐 있으면 실제 번호가 아니다(1회 줄바꿈=2줄은
            // 정상 넘김이므로 살린다 — 사용자 요청).
            if matches!(rule.category, "RRN" | "Card")
                && is_stacked_vertically(&chars[start_char..end_char])
            {
                continue;
            }
            // 카드: 표 셀 경계를 넘어 두 숫자를 하나로 묶은 오인식은 버린다(좌표 기반).
            if rule.category == "Card" && spans_a_cell_gap(&chars[start_char..end_char]) {
                continue;
            }

            // anchor 해석 — 점유(claim) 전에 처리해, anchor 필수인데 없으면 범위를
            // 점유하지 않고 건너뛴다(다른 규칙이 그 범위를 쓸 수 있도록).
            let context = context_before(&text, start_char);
            let (category, pattern_type, anchor_boost) =
                match resolve_anchor(rule.category, rule.pattern_type, rule.anchors, &context) {
                    Some(anchor) => anchor,
                    None if rule.anchor_required => continue,
                    None => (rule.category, rule.pattern_type, 0.0),
                };

            // 계좌: 은행명 anchor가 매치 바로 앞에 붙어 있으면 그 은행명까지 함께
            // 가리도록 시작을 당긴다(사용자 요청). 그 외 카테고리는 그대로.
            let span_start = if category == "BankAccount" {
                bank_name_prefix_start(&text_chars, start_char).unwrap_or(start_char)
            } else {
                start_char
            };

            for slot in &mut claimed[span_start..end_char] {
                *slot = true;
            }

            let id = format!("r-{next_id}");
            *next_id += 1;

            let confidence = (rule.base_confidence + checksum_bonus + anchor_boost).min(1.0);

            // content·bbox는 원본 글자에서 산출(정규화는 인덱스 불변이므로 안전).
            // 주소는 좌표 기반 셀 재구성으로 건물명·상세·셀 내 줄바꿈까지 함께 묶는다
            // (address_cell_indices) — 옆 칸(전화 등)은 가로 빈틈으로 제외된다.
            let (content, bbox) = if category == "Address" {
                // 건물줄(④)은 그 줄 자체가 건물이라 아래로 안 번지게(0), 나머지 주소는
                // 같은 셀 건물 줄을 마저 묶도록 2줄까지.
                let max_lines = if pattern_type == "AddressBuildingLine" { 0 } else { 2 };
                let idxs = address_cell_indices(chars, span_start, end_char, max_lines);
                // 재구성된 셀 범위 전체를 claim한다 — 같은 줄 건물·상세가 뒤의
                // 건물줄 규칙(④)이나 다른 규칙에 다시 잡히지 않게(A-3 이중검출 방지).
                for &i in &idxs {
                    claimed[i] = true;
                }
                let cell: Vec<PositionedChar> = idxs.iter().map(|&i| chars[i].clone()).collect();
                let content: String = cell.iter().map(|c| c.ch).collect();
                (content, merge_bbox(&cell))
            } else {
                let content: String = chars[span_start..end_char].iter().map(|c| c.ch).collect();
                (content, merge_bbox(&chars[span_start..end_char]))
            };

            items.push(ReviewItem {
                id,
                origin: ReviewItemOrigin::Detected,
                page: page_index,
                bbox,
                original_bbox: None,
                category: category.to_string(),
                content,
                pattern_type: Some(pattern_type.to_string()),
                confidence: Some(confidence),
                validation,
                modified: false,
                created_at: now.to_string(),
                updated_at: now.to_string(),
            });
        }
    }

    // (b) 후처리(사용자 요청): 지역명(구/시)만 있고 코어(동/도로명/지번)가 없어
    // 미검출된 셀에서, **아래 줄(같은 컬럼)에 건물 키워드가 이어지면** 주소로 만든다.
    // 예: 1줄 "경기도 성남시 분당구", 2줄 "매화마을 동신빌라" — 스트림상 안 붙어
    // ①-d(같은 매치에 지역+건물)가 못 잡던 경우를 좌표로 이어 붙인다.
    let admin_re = compile(&format!("{ADDR_ADMIN}{ADDR_SUB}"));
    let building_re =
        compile(r"(?:마을|마를|아파트|APT|빌라|빌리지|타운|단지|주공|맨션|연립|빌딩)");
    let mut extras: Vec<Vec<usize>> = Vec::new();
    for m in admin_re.find_iter(&text) {
        let rs = text[..m.start()].chars().count();
        let re = text[..m.end()].chars().count();
        if claimed[rs..re].iter().any(|&c| c) {
            continue; // 이미 다른 검출(주소 포함)에 속함
        }
        let idxs = address_cell_indices(chars, rs, re, 2);
        if idxs.len() <= re - rs {
            continue; // 아래 줄로 안 커짐 → 지역명뿐이라 주소로 보지 않음
        }
        if idxs.iter().any(|&i| claimed[i]) {
            continue; // 확장 범위가 이미 다른 검출과 겹침
        }
        let content: String = idxs.iter().map(|&i| text_chars[i]).collect();
        if building_re.is_match(&content) {
            extras.push(idxs);
        }
    }
    for idxs in extras {
        if idxs.iter().any(|&i| claimed[i]) {
            continue; // 앞 후보와 겹치면 스킵(중복 방지)
        }
        for &i in &idxs {
            claimed[i] = true;
        }
        let cell: Vec<PositionedChar> = idxs.iter().map(|&i| chars[i].clone()).collect();
        let id = format!("r-{next_id}");
        *next_id += 1;
        items.push(ReviewItem {
            id,
            origin: ReviewItemOrigin::Detected,
            page: page_index,
            bbox: merge_bbox(&cell),
            original_bbox: None,
            category: "Address".to_string(),
            content: cell.iter().map(|c| c.ch).collect(),
            pattern_type: Some("AddressRegionBuilding".to_string()),
            confidence: Some(0.4),
            validation: ValidationStatus::NotValidated,
            modified: false,
            created_at: now.to_string(),
            updated_at: now.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chars_for(text: &str) -> Vec<PositionedChar> {
        text.chars()
            .enumerate()
            .map(|(i, ch)| PositionedChar {
                ch,
                bbox: RelativeBBox { x: 0.01 * i as f32, y: 0.5, width: 0.01, height: 0.02 },
            })
            .collect()
    }

    /// 특정 위치에서 가로 좌표를 크게 벌린 글자 목록(표 셀 경계 재현용).
    fn chars_with_gap(text: &str, gap_before: usize, gap: f32) -> Vec<PositionedChar> {
        let mut x = 0.0f32;
        text.chars()
            .enumerate()
            .map(|(i, ch)| {
                if i == gap_before {
                    x += gap;
                }
                let c = PositionedChar { ch, bbox: RelativeBBox { x, y: 0.5, width: 0.01, height: 0.02 } };
                x += 0.01;
                c
            })
            .collect()
    }

    /// 세로로 나열된 글자(같은 x, y가 글자 높이만큼씩 증가) — 표의 세로 숫자열 재현.
    fn chars_vertical(text: &str) -> Vec<PositionedChar> {
        text.chars()
            .enumerate()
            .map(|(i, ch)| PositionedChar {
                ch,
                bbox: RelativeBBox { x: 0.5, y: 0.1 + 0.02 * i as f32, width: 0.01, height: 0.02 },
            })
            .collect()
    }

    /// 앞 `split_at`자는 윗줄, 나머지는 아랫줄(1회 줄바꿈). 문단 중 번호가 두 줄에
    /// 걸쳐 나뉜 정상 케이스 재현.
    fn chars_two_lines(text: &str, split_at: usize) -> Vec<PositionedChar> {
        text.chars()
            .enumerate()
            .map(|(i, ch)| {
                let (col, row) = if i < split_at { (i, 0) } else { (i - split_at, 1) };
                PositionedChar {
                    ch,
                    bbox: RelativeBBox {
                        x: 0.01 * col as f32,
                        y: 0.5 + 0.05 * row as f32,
                        width: 0.01,
                        height: 0.02,
                    },
                }
            })
            .collect()
    }

    fn detect_chars(chars: &[PositionedChar]) -> Vec<ReviewItem> {
        let rules = default_rules();
        let mut items = Vec::new();
        let mut next_id = 0;
        detect_in_page(chars, 0, &rules, "2026-01-01T00:00:00.000Z", &mut next_id, &mut items);
        items
    }

    fn detect(text: &str) -> Vec<ReviewItem> {
        let chars = chars_for(text);
        let rules = default_rules();
        let mut items = Vec::new();
        let mut next_id = 0;
        detect_in_page(&chars, 0, &rules, "2026-01-01T00:00:00.000Z", &mut next_id, &mut items);
        items
    }

    fn find<'a>(items: &'a [ReviewItem], category: &str) -> &'a ReviewItem {
        items.iter().find(|i| i.category == category).unwrap_or_else(|| panic!("{category} 후보 없음"))
    }

    /// f32 누적합의 정밀도 오차를 흡수하는 confidence 근사 비교.
    fn assert_conf(item: &ReviewItem, expected: f32) {
        let got = item.confidence.expect("confidence 없음");
        assert!((got - expected).abs() < 1e-4, "confidence {got} != {expected}");
    }

    #[test]
    fn detects_a_phone_number_and_maps_its_bbox_from_matched_chars() {
        let items = detect("연락처 010-1234-5678 입니다");
        let phone = find(&items, "PhoneNumber");
        assert_eq!(phone.content, "010-1234-5678");
        assert_eq!(phone.origin, ReviewItemOrigin::Detected);
        assert_eq!(phone.pattern_type.as_deref(), Some("PhoneNumber"));
        assert!(!phone.modified);
        assert!(phone.bbox.width > 0.0);
        assert!(phone.bbox.x > 0.0);
        // "연락처" 문맥(§5.3.2)으로 0.5 + 0.2 = 0.7.
        assert_eq!(phone.confidence, Some(0.7));
    }

    #[test]
    fn phone_without_context_keeps_base_confidence() {
        let items = detect("010-1234-5678");
        assert_eq!(items[0].category, "PhoneNumber");
        assert_eq!(items[0].confidence, Some(0.5));
    }

    #[test]
    fn fax_context_reclassifies_phone_pattern_as_fax_number() {
        let items = detect("팩스번호 02-3133-2457 입니다");
        let fax = items.iter().find(|i| i.content == "02-3133-2457").expect("팩스 후보 없음");
        assert_eq!(fax.category, "FaxNumber");
        assert_eq!(fax.pattern_type.as_deref(), Some("FaxNumber"));
        assert_eq!(fax.confidence, Some(0.7));
    }

    #[test]
    fn passport_context_boosts_confidence_but_keeps_category() {
        let items = detect("여권번호 M12345678 확인바랍니다");
        let passport = find(&items, "Passport");
        assert_eq!(passport.content, "M12345678");
        assert_eq!(passport.confidence, Some(0.7));
    }

    #[test]
    fn passport_context_matches_regardless_of_whitespace() {
        let items = detect("passport number M12345678 ref");
        let passport = find(&items, "Passport");
        assert_eq!(passport.confidence, Some(0.7));
    }

    #[test]
    fn passport_match_is_always_valid_since_regex_is_the_format_check() {
        let items = detect("M12345678");
        let passport = find(&items, "Passport");
        assert_eq!(passport.validation, ValidationStatus::Valid);
    }

    // ── RRN: fail-safe(체크섬 실패해도 검출) ──────────────────────────────

    #[test]
    fn rrn_with_correct_checksum_is_valid_with_high_confidence() {
        // 901231-1234563: 올바른 체크섬. "주민등록번호" anchor까지 있어 0.6+0.3+0.2 → 1.0.
        let items = detect("주민등록번호 901231-1234563 확인");
        let rrn = find(&items, "RRN");
        assert_eq!(rrn.validation, ValidationStatus::Valid);
        assert_eq!(rrn.confidence, Some(1.0));
    }

    #[test]
    fn rrn_with_bad_checksum_is_still_detected_failsafe() {
        // 체크섬 실패라도 **버리지 않는다**(OCR 오인식·2020년 이후 발급분 대비).
        // Invalid 표시는 하되 confidence는 0.6(base)+0.2(anchor)=0.8로 유지, Included.
        let items = detect("주민등록번호 901231-1234564 확인");
        let rrn = find(&items, "RRN");
        assert_eq!(rrn.validation, ValidationStatus::Invalid);
        assert_eq!(rrn.confidence, Some(0.8));
    }

    #[test]
    fn rrn_bad_checksum_without_anchor_still_detected() {
        let items = detect("901231-1234564");
        let rrn = find(&items, "RRN");
        assert_eq!(rrn.validation, ValidationStatus::Invalid);
        assert_eq!(rrn.confidence, Some(0.6)); // base만, 여전히 검출·Included
    }

    // ── 1:1 정규화(전각→반각) ────────────────────────────────────────────

    #[test]
    fn fullwidth_digits_are_normalized_and_detected() {
        // 전각 숫자로 우회하려 해도 정규화되어 RRN으로 검출되어야 한다.
        let items = detect("주민등록번호 ９０１２３１-１２３４５６３");
        let rrn = find(&items, "RRN");
        assert_eq!(rrn.validation, ValidationStatus::Valid);
        // content는 원본(전각) 글자를 보존한다.
        assert_eq!(rrn.content, "９０１２３１-１２３４５６３");
    }

    #[test]
    fn normalize_char_maps_fullwidth_to_ascii() {
        assert_eq!(normalize_char('０'), '0');
        assert_eq!(normalize_char('Ａ'), 'A');
        assert_eq!(normalize_char('＠'), '@');
        assert_eq!(normalize_char('가'), '가'); // 한글은 그대로
        assert_eq!(normalize_char('7'), '7');
    }

    // ── 신규 카테고리 ────────────────────────────────────────────────────

    #[test]
    fn detects_email() {
        let items = detect("이메일: hong.gildong@example.co.kr 입니다");
        let email = find(&items, "Email");
        assert_eq!(email.content, "hong.gildong@example.co.kr");
        assert_eq!(email.validation, ValidationStatus::Valid);
    }

    #[test]
    fn phone_is_detected_even_when_glued_to_a_korean_name() {
        // 이름은 검출 대상이 아니지만, 이름과 전화번호가 공백 없이 붙어 있어도
        // 전화번호 부분은 그대로 검출되어야 한다(lookbehind가 없어 앞 한글이
        // 매치를 막지 않는다).
        let items = detect("홍길동010-1234-5678");
        let phone = find(&items, "PhoneNumber");
        assert_eq!(phone.content, "010-1234-5678");

        // 뒤에 붙어도 마찬가지.
        let items2 = detect("010-1234-5678홍길동");
        assert_eq!(find(&items2, "PhoneNumber").content, "010-1234-5678");
    }

    #[test]
    fn detects_valid_card_with_luhn_bonus_and_anchor() {
        // 4111 1111 1111 1111: 대표적 Luhn-valid 테스트 Visa 번호.
        let items = detect("카드번호 4111-1111-1111-1111 결제");
        let card = find(&items, "Card");
        assert_eq!(card.validation, ValidationStatus::Valid);
        // 0.4 + 0.3(Luhn) + 0.2(anchor) = 0.9.
        assert_conf(card, 0.9);
    }

    #[test]
    fn card_with_bad_luhn_is_still_detected_failsafe() {
        // 형식(16자리·BIN 4)은 맞지만 Luhn 실패 → 버리지 않고 Invalid로 검출.
        let items = detect("카드번호 4111-1111-1111-1112 결제");
        let card = find(&items, "Card");
        assert_eq!(card.validation, ValidationStatus::Invalid);
        // 0.4 + 0.2(anchor), Luhn 가점 없음 = 0.6.
        assert_conf(card, 0.6);
    }

    #[test]
    fn vertical_column_of_digits_is_not_an_rrn() {
        // 표에서 세로로 나열된 한 자리 숫자들(5,5,3,3,3,2,2,2,2,3,2,3,3)이 텍스트로는
        // 연속 13자리라 RRN으로 오인식되던 문제 — 좌표상 여러 줄이면 배제(p.139).
        let chars = chars_vertical("5533322223233");
        let items = detect_chars(&chars);
        assert!(items.iter().all(|i| i.category != "RRN"));
    }

    #[test]
    fn rrn_wrapped_across_one_line_break_is_still_detected() {
        // 문단 중 1회 줄바꿈으로 번호가 두 줄에 나뉜 정상 케이스(=2줄)는 살린다
        // — 세로 나열(3줄+)만 배제해야 하고 이 정상 넘김을 무력화하면 안 된다(사용자 요청).
        let chars = chars_two_lines("901231-1234563", 7);
        let items = detect_chars(&chars);
        let rrn = items.iter().find(|i| i.category == "RRN").expect("줄바꿈된 RRN 미검출");
        assert_eq!(rrn.validation, ValidationStatus::Valid);
    }

    #[test]
    fn card_spanning_a_table_cell_gap_is_rejected() {
        // "유동훈 2275-0566 2278-7202"(전화/팩스 연속)가 하나의 신용카드로 오인식
        // 되던 문제 — 두 값 사이 좌표 간격이 크면 카드로 묶지 않는다(사용자 재현).
        let chars = chars_with_gap("2275-0566 2278-7202", 9, 0.3);
        let items = detect_chars(&chars);
        assert!(items.iter().all(|i| i.category != "Card"));
    }

    #[test]
    fn phone_includes_shared_prefix_shorthand_trailing_numbers() {
        // "전화:02-2679-8201,8327"에서 뒤 4자리(8327)도 함께 마킹되어야 한다.
        let items = detect("전화:02-2679-8201,8327");
        let phone = find(&items, "PhoneNumber");
        assert_eq!(phone.content, "02-2679-8201,8327");
    }

    #[test]
    fn phone_shorthand_with_space_after_comma() {
        // 실제 PDF(ZZ0001964 p60): "전화: 02-2679-8201, 8327/" — 콤마 뒤 공백.
        let items = detect("전화: 02-2679-8201, 8327/ 전송: 2679-8328");
        let phone = find(&items, "PhoneNumber");
        assert_eq!(phone.content, "02-2679-8201, 8327");
    }

    #[test]
    fn card_with_mixed_separators_is_not_a_card() {
        // 진짜 카드는 구분자가 일관됨. '-'와 공백이 섞이면(표의 두 번호를 잘못
        // 묶음) 카드가 아니다 — 좌표 간격이 없어도 구분자 일관성으로 거른다.
        let items = detect("2020-2264 2020-2265");
        assert!(items.iter().all(|i| i.category != "Card"));
    }

    #[test]
    fn bare_local_number_detected_as_fax_with_jeonsong_anchor() {
        // 지역번호 없는 로컬 번호도 "전송"(팩스 앵커) 뒤에 오면 팩스로 검출.
        let items = detect("전송: 2679-8328");
        let fax = find(&items, "FaxNumber");
        assert_eq!(fax.content, "2679-8328");
    }

    #[test]
    fn international_parenthesized_country_code_detected_with_anchor() {
        // 실제 p.7: "전화: (65)62531033" — (65)는 한국 지역번호 화이트리스트에
        // 없고 구분자(-)도 없이 붙어 있지만, 전화 앵커가 앞서므로 괄호 접두 포함
        // 8자리 연속 숫자까지 검출한다(사용자 재현).
        let items = detect("전화: (65)62531033");
        let phone = find(&items, "PhoneNumber");
        assert_eq!(phone.content, "(65)62531033");

        // 구분자가 있는 형태도 여전히 동작.
        let dashed = detect("팩스: (65)6255-1838");
        assert_eq!(find(&dashed, "FaxNumber").content, "(65)6255-1838");
    }

    #[test]
    fn card_format_mismatch_is_rejected_not_a_card() {
        // 13자리인데 4로 시작하지 않음 → 카드 형식 자체가 아님(Reject).
        // (BankAccount 등 다른 규칙엔 걸릴 수 있으나 Card로는 안 잡혀야 한다.)
        let items = detect("1234567890123");
        assert!(items.iter().all(|i| i.category != "Card"));
    }

    #[test]
    fn account_bank_name_anchor_boosts_confidence_and_is_marked_together() {
        let items = detect("국민은행 123-45-678901 입금");
        let acc = find(&items, "BankAccount");
        assert_eq!(acc.confidence, Some(0.7)); // 0.5 + 0.2("은행" anchor)
        // 은행명이 매치 바로 앞에 붙어 있으면 함께 블랙마킹된다(사용자 요청).
        assert_eq!(acc.content, "국민은행 123-45-678901");
    }

    #[test]
    fn account_detected_via_label_marks_only_the_number() {
        // "계좌" 라벨로 검출되면(은행명이 바로 앞이 아님) 번호만 가린다.
        let items = detect("계좌 123-45-678901 로 입금");
        let acc = find(&items, "BankAccount");
        assert_eq!(acc.content, "123-45-678901");
    }

    #[test]
    fn account_bank_name_span_covers_any_bank_by_suffix() {
        // 고정 목록에 없는 은행("조흥은행")도 "은행" 접미사로 일반 포괄된다
        // (ZZ0001964_01.pdf p.10 "조흥은행 306-04-873546" 사용자 재현).
        let items = detect("조흥은행 306-04-873546 계좌");
        let acc = find(&items, "BankAccount");
        assert_eq!(acc.content, "조흥은행 306-04-873546");
    }

    #[test]
    fn detects_landline_with_parenthesized_area_code() {
        // 사용자 재현(p.67): "(연락처:(02)2679-8201 ... 팩스:(02)2679-8328)".
        let items = detect("연락처:(02)2679-8201 팩스:(02)2679-8328");
        let phone = items.iter().find(|i| i.content == "(02)2679-8201").expect("괄호 지역번호 전화 미검출");
        assert_eq!(phone.category, "PhoneNumber");
        let fax = items.iter().find(|i| i.content == "(02)2679-8328").expect("괄호 지역번호 팩스 미검출");
        assert_eq!(fax.category, "FaxNumber");
    }

    #[test]
    fn fax_anchor_reclassifies_without_covering_the_label() {
        // 팩스 앵커(팩스/팩스번호/fax·대소문자 무관)로 FaxNumber 재분류하되,
        // 은행명과 달리 앵커 단어("팩스번호")는 함께 가리지 않는다(번호만).
        let items = detect("팩스번호 02-3133-2457");
        let fax = find(&items, "FaxNumber");
        assert_eq!(fax.content, "02-3133-2457");

        let upper = detect("FAX 02-3133-2457");
        assert_eq!(find(&upper, "FaxNumber").content, "02-3133-2457");
    }

    #[test]
    fn account_without_anchor_is_not_detected() {
        // 계좌 형식이지만 anchor("은행/계좌/입금처/지급처/계좌번호")가 없어 제외.
        let items = detect("정산코드 123-45-678901 참조");
        assert!(items.iter().all(|i| i.category != "BankAccount"));
    }

    #[test]
    fn dob_detected_only_with_anchor() {
        let items = detect("생년월일 1990.01.01 입니다");
        let dob = find(&items, "DateOfBirth");
        // 정규식 꼬리(\s*)가 뒤 공백을 포함할 수 있어 trim 후 비교.
        assert_eq!(dob.content.trim_end(), "1990.01.01");
        assert_conf(dob, 0.5); // 0.3 + 0.2(anchor)
    }

    #[test]
    fn dob_without_anchor_is_not_detected() {
        // 날짜 형식이지만 "생년월일/생일" anchor가 없어 제외.
        let items = detect("작성일 2026.08.13 결재");
        assert!(items.iter().all(|i| i.category != "DateOfBirth"));
    }

    // ── 기존 파이프라인 불변 ──────────────────────────────────────────────

    #[test]
    fn does_not_double_count_overlapping_matches_across_rules() {
        let items = detect("010-1234-5678");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].category, "PhoneNumber");
    }

    #[test]
    fn assigns_sequential_ids_across_multiple_pages() {
        let chars = chars_for("010-1234-5678");
        let rules = default_rules();
        let mut items = Vec::new();
        let mut next_id = 0;
        detect_in_page(&chars, 0, &rules, "2026-01-01T00:00:00.000Z", &mut next_id, &mut items);
        detect_in_page(&chars, 1, &rules, "2026-01-01T00:00:00.000Z", &mut next_id, &mut items);
        assert_eq!(items[0].id, "r-0");
        assert_eq!(items[1].id, "r-1");
    }

    #[test]
    fn empty_page_produces_no_candidates() {
        let rules = default_rules();
        let mut items = Vec::new();
        let mut next_id = 0;
        detect_in_page(&[], 0, &rules, "2026-01-01T00:00:00.000Z", &mut next_id, &mut items);
        assert!(items.is_empty());
    }

    #[test]
    fn rrn_checksum_valid_accepts_correct_check_digit() {
        assert!(rrn_checksum_valid("901231-1234563"));
    }

    #[test]
    fn rrn_checksum_valid_rejects_wrong_check_digit() {
        assert!(!rrn_checksum_valid("901231-1234564"));
    }

    #[test]
    fn rrn_checksum_valid_rejects_wrong_digit_count() {
        assert!(!rrn_checksum_valid("12345"));
    }

    #[test]
    fn luhn_valid_accepts_known_test_number() {
        assert!(luhn_valid("4111111111111111"));
        assert!(!luhn_valid("4111111111111112"));
    }

    #[test]
    fn current_timestamp_matches_iso8601_millis_format_with_trailing_z() {
        let ts = current_timestamp();
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.len(), "2026-07-26T04:56:20.000Z".len());
    }

    // ── DET-14 주소 ─────────────────────────────────────────────────────────

    #[test]
    fn address_full_with_region_detected_and_captures_full_span() {
        let items = detect("주소: 서울특별시 강남구 테헤란로 123");
        let addr = find(&items, "Address");
        assert_eq!(addr.content, "서울특별시 강남구 테헤란로 123");
        assert_eq!(addr.validation, ValidationStatus::NotValidated);
        // ① 규칙 + anchor("주소") 가점: base 0.5 + 0.2.
        assert_conf(addr, 0.7);
    }

    #[test]
    fn address_with_region_detected_without_anchor_table_column_case() {
        // 표의 '주소' 컬럼 셀처럼 헤더(anchor)가 인접하지 않아도, 셀 안의
        // 전체 주소(시도/시군구 포함)는 ① 규칙으로 검출된다 — 사용자 재현.
        let items = detect("홍길동 경기도 성남시 분당구 판교로 228 5층");
        let addr = find(&items, "Address");
        assert!(addr.content.contains("성남시 분당구 판교로 228"));
        // anchor 없음 → 가점 없이 base 0.5.
        assert_conf(addr, 0.5);
    }

    #[test]
    fn address_jibun_with_region_detected_without_anchor() {
        let items = detect("성명 홍길동 서울특별시 강남구 역삼동 123-45");
        let addr = find(&items, "Address");
        assert!(addr.content.contains("역삼동 123-45"));
    }

    #[test]
    fn address_road_core_only_needs_anchor() {
        // 행정구역이 없는 짧은 주소는 anchor(자택)가 있어야 검출된다.
        let items = detect("자택 종로3길 12-4 5층 501호");
        let addr = find(&items, "Address");
        assert_eq!(addr.content, "종로3길 12-4 5층 501호");
    }

    #[test]
    fn address_all_user_anchors_trigger_core_only_detection() {
        for anchor in ["주소", "거주", "본적", "자택", "배송", "발송"] {
            let text = format!("{anchor} 테헤란로 123");
            let items = detect(&text);
            assert!(
                items.iter().any(|i| i.category == "Address"),
                "anchor '{anchor}' 로 주소가 검출돼야 함"
            );
        }
    }

    #[test]
    fn address_core_only_without_anchor_or_region_is_not_detected() {
        // 행정구역도 anchor도 없으면 검출하지 않는다(오탐 억제).
        let items = detect("우리 회사는 테헤란로 123 에 있습니다");
        assert!(!items.iter().any(|i| i.category == "Address"));
    }

    #[test]
    fn address_tolerates_ocr_space_before_dong_suffix() {
        // 스캔본 OCR이 "반포동"을 "반포 동"으로 쪼개도 검출한다(ZZ0002376 p.10 재현).
        let items = detect("서초구 반포 동 32-8");
        let addr = find(&items, "Address");
        assert!(addr.content.contains("반포 동 32-8"));
    }

    #[test]
    fn address_handles_eup_myeon_subdistrict_before_ri() {
        // 시/군 아래 읍/면이 낀 주소("용인시 수지읍 성목리 155")도 검출한다.
        let items = detect("용인시 수지읍 성목리 155");
        let addr = find(&items, "Address");
        assert!(addr.content.contains("수지읍 성목리 155"));
    }

    #[test]
    fn address_includes_abbreviated_metro_name_seoul() {
        // 사용자 요청: "서울"처럼 '시'가 생략돼도 '서울'부터 검출돼야 한다.
        let items = detect("서울 동작구 흑석동 123");
        let addr = find(&items, "Address");
        assert_eq!(addr.content, "서울 동작구 흑석동 123");
    }

    #[test]
    fn address_abbreviated_metro_requires_a_district_to_avoid_false_positive() {
        // 약칭 뒤에 시군구가 없으면(일반어 "경기 침체로 3") 오탐하지 않는다.
        let items = detect("올해 경기 침체로 3년째 어렵다");
        assert!(!items.iter().any(|i| i.category == "Address"));
    }

    // ── 서울(02) 국번 생략형 전화 ──────────────────────────────────────────

    #[test]
    fn seoul_local_number_without_area_code_or_anchor_is_detected() {
        // 사용자 요청: 02가 생략된 서울 번호("788-2791")를 anchor 없이도 검출.
        let items = detect("사무처 788-2791 로 연락");
        let phone = find(&items, "PhoneNumber");
        assert_eq!(phone.content, "788-2791");
    }

    #[test]
    fn ocr_digit_confusables_normalized_in_number_context() {
        // 사용자 요청: 숫자 문맥의 라틴/기호 오인식 보정(l·I→1, O→0, ㅡ→-).
        assert!(detect("연락처 0l0-l234-5678").iter().any(|i| i.category == "PhoneNumber"));
        assert!(detect("연락처 O2-l234-5678").iter().any(|i| i.category == "PhoneNumber"));
        assert!(detect("연락처 010ㅡ1234ㅡ5678").iter().any(|i| i.category == "PhoneNumber"));
        // RRN도 라틴 혼동 보정 후 검출.
        assert!(detect("주민등록번호 90l0l0-l234567").iter().any(|i| i.category == "RRN"));
    }

    #[test]
    fn ocr_digit_normalization_leaves_plain_letters_untouched() {
        // 숫자 없는 토큰(IBM 등)은 건드리지 않아 오검출 없음.
        assert!(!detect("회사명은 IBM 입니다").iter().any(|i| i.category == "PhoneNumber"));
        assert!(!detect("모델 Ollo 설명").iter().any(|i| i.category == "PhoneNumber"));
    }

    #[test]
    fn seoul_local_rule_ignores_three_three_apartment_number() {
        // 아파트 동-호 "203-705"(뒷자리 3자리)는 전화로 보지 않는다(오탐 억제).
        let items = detect("현대아파트 203-705 호");
        assert!(!items.iter().any(|i| i.category == "PhoneNumber"));
    }

    #[test]
    fn parenthesized_seoul_area_code_is_detected() {
        // (02)·02) 표기(02가 살아있는 형태)는 지역번호 규칙이 처리한다.
        let items = detect("(02)2679-8201");
        let phone = find(&items, "PhoneNumber");
        assert!(phone.content.contains("2679-8201"));
    }

    // ── DET-14 후속: 법정동 사전(지번 없는 주소) ─────────────────────────────

    #[test]
    fn address_without_jibun_detected_when_dong_is_a_legal_dong() {
        // 동 뒤에 지번이 없어도 실존 법정동이면 검출하고(사전 검증), 좌표 셀
        // 재구성으로 같은 줄/컬럼의 건물(신동아APT 12-706)까지 한 주소로 묶는다.
        let items = detect("용산구 서빙고동 신동아APT 12-706");
        let addr = find(&items, "Address");
        assert_eq!(addr.content, "용산구 서빙고동 신동아APT 12-706");
        assert_eq!(addr.pattern_type.as_deref(), Some("AddressDict"));
    }

    #[test]
    fn address_dict_rejects_non_legal_dong_word() {
        // "사무동"은 법정동이 아니므로 "구 사무동"은 주소로 보지 않는다(오탐 배제).
        let items = detect("강남구 사무동 회의");
        assert!(!items.iter().any(|i| i.category == "Address"));
    }

    #[test]
    fn address_dict_does_not_match_longer_word_ending_in_short_dong() {
        // "정동"은 실존 법정동이지만 "행정동"의 꼬리로 잘못 걸리면 안 된다
        // (경계 조건: 후보 앞이 구/시/군/읍/면이어야 함). "행정동"도 법정동이라
        // "구 행정동"은 정상 검출되지만 "구청행정동" 같은 붙은 단어는 걸리지 않는다.
        let items = detect("서초구청 총무행정동 업무");
        assert!(!items.iter().any(|i| i.category == "Address"));
    }

    #[test]
    fn address_fuzzy_recovers_one_char_ocr_corruption_of_dong() {
        // OCR로 동→를 손상("여의도를")도 편집거리 1로 여의도동에 매칭해 검출.
        let items = detect("영등포구 여의도를");
        let addr = find(&items, "Address");
        assert_eq!(addr.pattern_type.as_deref(), Some("AddressFuzzy"));
    }

    #[test]
    fn address_fuzzy_does_not_rescue_words_ending_in_exact_dong() {
        // 접미가 정확한 동/리인 비-법정동("사무동")은 퍼지 대상이 아니다(오탐 방지).
        assert!(!detect("강남구 사무동 회의").iter().any(|i| i.category == "Address"));
        // 손상 접미라도 사전 편집거리 1에 없으면 검출 안 함("사무롱").
        assert!(!detect("강남구 사무롱 회의").iter().any(|i| i.category == "Address"));
    }

    // ── DET-14 좌표 기반 셀 재구성 ─────────────────────────────────────────

    /// 한 줄에 글자들을 x0부터 배치.
    fn line_chars(text: &str, x0: f32, y: f32) -> Vec<PositionedChar> {
        let mut x = x0;
        text.chars()
            .map(|ch| {
                let c = PositionedChar { ch, bbox: RelativeBBox { x, y, width: 0.02, height: 0.02 } };
                x += 0.02;
                c
            })
            .collect()
    }

    #[test]
    fn address_cell_includes_building_but_stops_at_column_gap() {
        // 주소+건물 뒤 **큰 가로 간격**으로 전화 컬럼 → 전화는 셀에 안 들어와야 한다.
        let mut chars = line_chars("강남구 역삼동 123 우성APT 101동 202호", 0.10, 0.5);
        let phone_x = chars.last().unwrap().bbox.x + 0.30; // 컬럼 경계 수준의 간격
        chars.extend(line_chars("02-1234-5678", phone_x, 0.5));

        let items = detect_chars(&chars);
        let addr = find(&items, "Address");
        assert!(addr.content.contains("우성APT 101동 202호"), "건물·호수 포함: {}", addr.content);
        assert!(!addr.content.contains("1234"), "옆 칸 전화는 미포함이어야: {}", addr.content);
    }

    #[test]
    fn address_cell_extends_down_a_continuation_line_but_stops_at_next_row() {
        // 줄1 주소, 줄2 같은 컬럼 건물(이어짐), 줄3 성명 컬럼(x 작음)=새 행.
        let mut chars = line_chars("강남구 역삼동 123", 0.20, 0.50);
        chars.extend(line_chars("우성APT 101동", 0.20, 0.54)); // 이어지는 줄
        chars.extend(line_chars("홍길동", 0.04, 0.58)); // 새 행 성명(왼쪽 컬럼)
        chars.extend(line_chars("서초구 방배동 9", 0.20, 0.58)); // 새 행 주소

        let items = detect_chars(&chars);
        let first = items.iter().find(|i| i.category == "Address").expect("주소 없음");
        assert!(first.content.contains("우성APT 101동"), "이어지는 건물줄 포함: {}", first.content);
        assert!(!first.content.contains("홍길동"), "새 행 성명 미포함: {}", first.content);
        assert!(!first.content.contains("방배동"), "새 행 주소 미포함: {}", first.content);
    }

    #[test]
    fn address_cell_splits_when_next_line_starts_new_admin_region() {
        // 사용자 요청(p.8): "광주시 서구 쌍촌동 149" 아래에 "충북 청주시 …"가 바로
        // 붙어(좁은 행간) 한 셀로 병합되던 것을, 둘째 줄이 새 행정구역으로 시작하면
        // 별개 주소로 분리한다(체계 [도-시-구-동] 연속 인식).
        let mut chars = line_chars("광주시 서구 쌍촌동 149", 0.20, 0.50);
        chars.extend(line_chars("충북 청주시 상당구 용암동", 0.20, 0.52)); // 바로 아래
        let items = detect_chars(&chars);
        let addrs: Vec<_> = items.iter().filter(|i| i.category == "Address").collect();
        let first = addrs.iter().find(|a| a.content.contains("쌍촌동")).expect("1번째 주소 없음");
        assert!(!first.content.contains("청주"), "새 행정구역 줄 미포함: {}", first.content);
        assert!(
            addrs.iter().any(|a| a.content.contains("청주시 상당구 용암동")),
            "2번째 주소 별도 검출: {addrs:?}"
        );
    }

    #[test]
    fn postal_token_recognizes_old_and_new_formats() {
        assert!(is_postal_token("137-785")); // 구: 첫자리 1~7
        assert!(is_postal_token("138-200"));
        assert!(is_postal_token("03925")); // 신: 앞 두자리 01~63
        assert!(is_postal_token("10881"));
        assert!(!is_postal_token("800-123")); // 첫자리 8
        assert!(!is_postal_token("99999")); // 앞 두자리 99>63
        assert!(!is_postal_token("334")); // 3자리
        assert!(!is_postal_token("01012345678")); // 전화
    }

    #[test]
    fn address_left_expansion_includes_postal_excludes_nonpostal_number() {
        // 우편번호(ddd-ddd)는 주소 좌측으로 포함, 비-우편번호 코드번호(334)는 배제.
        let with_postal = detect_chars(&line_chars("138-200 서울 강남구 역삼동 123", 0.30, 0.5));
        let a = find(&with_postal, "Address");
        assert!(a.content.contains("138-200"), "우편번호 포함: {}", a.content);

        let with_code = detect_chars(&line_chars("334 서울 강남구 역삼동 123", 0.30, 0.5));
        let b = find(&with_code, "Address");
        assert!(b.content.contains("역삼동"), "주소 본체: {}", b.content);
        assert!(!b.content.contains("334"), "비-우편번호 코드 배제: {}", b.content);
    }

    #[test]
    fn address_cell_stops_at_table_vertical_bar_excluding_name_column() {
        // 실 스캔 표 오검출(ZZ0002376 p.10): "…김문구 | 성남시 문당구 판교동 208-18"
        // 에서 좌측 확장이 표 세로줄(|)로만 구분된 이름 컬럼을 흡수하던 문제. |를
        // 하드 컬럼 경계로 취급해 이름을 배제하고, | 자체도 content에서 뺀다.
        let chars = line_chars("김문구|성남시 문당구 판교동 208-18", 0.30, 0.5);
        let items = detect_chars(&chars);
        let addr = find(&items, "Address");
        assert!(addr.content.contains("성남시 문당구 판교동"), "주소 본체: {}", addr.content);
        assert!(!addr.content.contains("김문구"), "이름 컬럼 제외: {}", addr.content);
        assert!(!addr.content.contains('|'), "세로줄 제외: {}", addr.content);
    }

    #[test]
    fn address_cell_measures_gap_over_noise_transparently() {
        // 표 세로줄이 없어도, 이름과 주소 사이 넓은 빈틈을 OCR 노이즈(~^;)가 메워도
        // 그 노이즈를 투명 취급해(주소 글자끼리) 실제 간격을 재 이름을 배제한다.
        let mut chars = line_chars("홍길동", 0.05, 0.5); // 이름(0.05~0.11)
        chars.extend(line_chars("~^;", 0.13, 0.5)); // 노이즈(빈틈을 메움)
        chars.extend(line_chars("서울 강남구 역삼동 123", 0.24, 0.5)); // 주소(넓은 간격 너머)
        let items = detect_chars(&chars);
        let addr = find(&items, "Address");
        assert!(addr.content.contains("역삼동"), "주소 본체: {}", addr.content);
        assert!(!addr.content.contains("홍길동"), "이름 제외(노이즈 투명): {}", addr.content);
    }

    #[test]
    fn address_cell_extends_left_to_include_adjacent_city_prefix() {
        // 사용자 통찰(인접성=앵커): 검출된 주소 왼쪽에 같은 셀로 붙은 시/도 접두
        // ("중남"=충남 OCR)를, 성명 칸(큰 빈틈 너머)은 빼고, 함께 포함한다.
        let mut chars = line_chars("홍길동", 0.05, 0.5); // 성명(큰 빈틈 너머, ~0.11에서 끝)
        // 주소 칸: "중남 서산시 대곡리 12"(중남은 시도 접두, 성명과는 큰 빈틈).
        chars.extend(line_chars("중남 서산시 대곡리 12", 0.24, 0.5));

        let items = detect_chars(&chars);
        let addr = find(&items, "Address");
        assert!(addr.content.contains("중남"), "인접 시도 접두 포함: {}", addr.content);
        assert!(!addr.content.contains("홍길동"), "성명 칸은 제외: {}", addr.content);
    }

    #[test]
    fn address_detects_numbered_administrative_dong() {
        // 행정동 번호가 붙은 동(반포1동·양2동)도 검출(사전은 숫자 무시로 반포동에 매칭).
        assert!(detect("서울시 서초구 반포1동 344").iter().any(|i| i.category == "Address"));
        assert!(detect("광주광역시 서구 양2동 60").iter().any(|i| i.category == "Address"));
        // 공백 없는 OCR + 지번 없는 번호동도 사전 규칙으로.
        let items = detect("서울시서초구반포1동주공3단지344동302호");
        assert!(items.iter().any(|i| i.category == "Address"), "번호동+무공백 검출");
    }

    #[test]
    fn address_region_line1_plus_building_line2_across_stream_gap() {
        // 1줄 지역명(코어 없음) + (스트림상 사이에 전화가 끼어 안 붙음) + 2줄 건물.
        // 좌표 후처리로 지역명→아래 줄 건물을 이어 붙여 검출한다(옆 칸 전화는 제외).
        let mut chars = line_chars("경기도 성남시 분당구", 0.20, 0.50); // 지역(줄1)
        chars.extend(line_chars("010-1234-5678", 0.62, 0.50)); // 전화(줄1, 오른 칸)
        chars.extend(line_chars("매화마을 동신빌라", 0.20, 0.54)); // 건물(줄2, 같은 컬럼)

        let items = detect_chars(&chars);
        let addr = items
            .iter()
            .find(|i| i.category == "Address")
            .expect("주소 검출 실패");
        assert_eq!(addr.pattern_type.as_deref(), Some("AddressRegionBuilding"));
        assert!(addr.content.contains("매화마을"), "건물줄 포함: {}", addr.content);
        assert!(!addr.content.contains("1234"), "옆 칸 전화 제외: {}", addr.content);
    }

    #[test]
    fn address_building_line_detected_standalone_without_admin_region() {
        // A-3(DET-17): 행정구역 없는 둘째 줄 "건물+호수"도 별도 주소로 검출.
        for s in ["쌍용 APT 205-501", "궁전 아파트 901호", "금호 APT 2차 2동 910호", "삼익빌라 101동 204호"] {
            let items = detect(s);
            let addr = items.iter().find(|i| i.category == "Address");
            assert!(addr.is_some(), "건물줄 검출 실패: {s}");
        }
    }

    #[test]
    fn address_damaged_dong_detected_via_strong_admin_plus_jibun() {
        // #2 케이스: 동명이 OCR로 손상돼(예 "양2동"→"동"·아예 소실) ①~③이 못 잡는
        // 주소를 강한 행정구역(시도접미+시군구) + 맨 지번(N-N)으로 검출. 동이 아예
        // 없는 "광주광역시 서구 60-2"는 ①(지번 규칙)이 못 잡으므로 ⑤가 잡는다.
        let items = detect("광주광역시 서구 60-2");
        let addr = items.iter().find(|i| i.category == "Address").expect("미검출");
        assert_eq!(addr.pattern_type.as_deref(), Some("AddressDamagedDong"));
        // "동"이 남은 경우도 어떻게든 주소로 검출된다(①이 서구를 동명으로 파싱하든 ⑤든).
        assert!(detect("광주광역시 서구 동 60-2").iter().any(|i| i.category == "Address"));
        // FP 억제: 강한 행정구역(시도+시군구)이 아니면 이 규칙으로 안 잡힘.
        assert!(!detect("강남구 60-2").iter().any(|i| i.pattern_type.as_deref() == Some("AddressDamagedDong")));
    }

    #[test]
    fn address_building_line_new_patterns() {
        // 사용자 p.8/p.10 케이스: T(한글접두)·빌 접미·알파-숫자 호수(A-3)·점 구분자(APT.).
        for s in [
            "궁전 T 동 901호",       // 케이스1: T(APT OCR), 한글접두
            "현 대 T 105동 403호",   // 케이스6: 공백 낀 접두 + T
            "동일하이빌 109동 901호", // 케이스4: '빌' 접미
            "광명빌라 A-3",           // 케이스7: 알파-숫자 호수
            "현대APT.101-406",        // 케이스11: 점 구분자
        ] {
            assert!(detect(s).iter().any(|i| i.category == "Address"), "건물줄 검출 실패: {s}");
        }
        // T는 한글 접두가 반드시 있어야(단독 T FP 방지) — "T 3호"는 검출 안 함.
        assert!(!detect("메뉴 T 3호").iter().any(|i| i.pattern_type.as_deref() == Some("AddressBuildingLine")));
    }

    #[test]
    fn address_building_line_requires_both_keyword_and_number() {
        // FP 방지: 건물 키워드만(숫자 없음)·숫자만(건물 키워드 없음)은 검출 안 함.
        assert!(!detect("아파트 관리사무소").iter().any(|i| i.category == "Address"));
        assert!(!detect("회의실 302호").iter().any(|i| i.category == "Address"));
    }

    #[test]
    fn address_first_line_and_building_line_are_two_separate_bboxes() {
        // 1줄 지역+지번, 2줄 건물이 각각 별도 주소 bbox가 된다(A-3). 스캔 표에서
        // 행간이 좁아 좌표로 한 셀에 못 묶는 경우 대비 — 개별 검출로 FN을 막는다.
        let mut chars = line_chars("강남구 역삼동 123", 0.20, 0.50);
        chars.extend(line_chars("우성빌라 101동 202호", 0.20, 0.70)); // 행간 넓게(별도 셀처럼)
        let items = detect_chars(&chars);
        let addrs: Vec<_> = items.iter().filter(|i| i.category == "Address").collect();
        assert!(addrs.iter().any(|a| a.content.contains("역삼동")), "1줄 주소: {addrs:?}");
        assert!(
            addrs.iter().any(|a| a.content.contains("우성빌라") && a.content.contains("202호")),
            "2줄 건물줄: {addrs:?}"
        );
    }

    #[test]
    fn address_detects_region_plus_apartment_brand() {
        // A-4(DET-18): 법정동/도로명/지번이 없어도 "행정구역 + 아파트 브랜드"를 주소로.
        // 이름 접두 유무 모두, 공백/영문 변형도 대응.
        for s in [
            "서울시 강남구 반포자이",
            "성남시 분당구 자이",
            "서초구 래미안",
            "서울시 마포구 힐스테이트",
            "성남시 분당구 더 샵",
            "부산 해운대구 롯데캐슬",
            "수원시 영통구 푸르지오",
            "서울시 강동구 e편한세상",
            "인천 연수구 SK뷰",
            "고양시 일산구 아이파크",
            "서울시 성북구 위브",
            // 신규 일반 키워드(맨숀·주택·시티)
            "서울시 용산구 남산맨숀",
            "성남시 분당구 파크시티",
        ] {
            assert!(
                detect(s).iter().any(|i| i.category == "Address"),
                "브랜드/건물 주소 검출 실패: {s}"
            );
        }
    }

    #[test]
    fn address_left_expansion_caps_postal_stops_at_phone_digits() {
        // A-1(DET-15): 좌측 확장이 우편번호(≤6자리)까지만 흡수하고, 그 너머 전화번호는
        // 배제한다. 같은 줄에 작은 간격으로 [전화][우편][주소]가 붙어 컬럼 경계로 안
        // 갈릴 때도, 연속 숫자 6자리 제한으로 전화 흡수를 막는다.
        let mut chars = line_chars("031-999-8282", 0.05, 0.5); // 전화(왼쪽, 흡수되면 안 됨)
        let x2 = chars.last().unwrap().bbox.x + 0.021; // 작은 간격(컬럼 경계 미만)
        chars.extend(line_chars("06236", x2, 0.5)); // 우편번호(5자리 → 통과)
        let x3 = chars.last().unwrap().bbox.x + 0.021;
        chars.extend(line_chars("서울 강남구 역삼동 123", x3, 0.5)); // 주소 씨앗

        let items = detect_chars(&chars);
        let addr = find(&items, "Address");
        assert!(addr.content.contains("역삼동"), "주소 본체: {}", addr.content);
        assert!(!addr.content.contains("999"), "좌측 전화 제외: {}", addr.content);
        assert!(!addr.content.contains("8282"), "좌측 전화 제외: {}", addr.content);
    }

    #[test]
    fn address_detects_region_plus_village_or_complex_keyword() {
        // 법정동/도로명/지번이 없어도 "행정구역 + 마을/단지"는 주소로 인정.
        assert!(detect("경기도 성남시 분당구 매화마을 동신빌라 903-202").iter().any(|i| i.category == "Address"));
        assert!(detect("성남시 분당구 매화마을").iter().any(|i| i.category == "Address"));
        // 사용자 요청: 주공, 그리고 불완전 OCR 변형(마를=마을, T=APT)도 앵커.
        assert!(detect("서울시 강남구 개포주공").iter().any(|i| i.category == "Address"));
        assert!(detect("성남시 분당구 매화마를").iter().any(|i| i.category == "Address"));
        assert!(detect("성남시 분당구 신동아 T").iter().any(|i| i.category == "Address"));
    }
}
