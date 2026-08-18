//! DET-14 후속: 법정동/리 이름 사전.
//!
//! 출처: 행정안전부 「법정동코드 전체자료」에서 동/리 이름만 추출·중복제거.
//! 공공누리 제1유형(KOGL Type 1, 출처표시). THIRD-PARTY-LICENSES.md 참조.
//!
//! 용도: 지번이 없는 주소("○○구 서빙고동 신동아APT")에서 동/리가 **실존 법정동**
//! 일 때만 주소로 인정해, recall(지번 없는 주소 검출)과 precision(형태만 맞는
//! 비-법정동 배제)을 동시에 올린다(detection.rs `validate_address_dict`).

use std::collections::HashSet;
use std::sync::OnceLock;

static LEGAL_DONGS: OnceLock<HashSet<&'static str>> = OnceLock::new();

fn dongs() -> &'static HashSet<&'static str> {
    LEGAL_DONGS.get_or_init(|| {
        // 파일 상단의 '#' 주석(출처·가공내역)과 빈 줄은 건너뛴다.
        include_str!("data/legal_dongs.txt")
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .collect()
    })
}

/// 이름을 사전 대조용으로 정규화: 공백과 숫자를 제거한다. 공백은 OCR 분리
/// ("반포 동"→"반포동"), 숫자는 행정동 번호("반포1동"→"반포동")를 흡수한다.
fn normalize_for_lookup(name: &str) -> String {
    name.chars().filter(|c| !c.is_whitespace() && !c.is_ascii_digit()).collect()
}

/// 이름이 법정동/리 사전에 있는지(공백·숫자 무시).
pub fn is_legal_dong(name: &str) -> bool {
    dongs().contains(normalize_for_lookup(name).as_str())
}

/// 글자 수(char length)별 사전 버킷 — 퍼지 매칭 시 후보 길이 근처만 비교하기 위함.
static BY_LEN: OnceLock<Vec<Vec<&'static str>>> = OnceLock::new();
fn by_len() -> &'static Vec<Vec<&'static str>> {
    BY_LEN.get_or_init(|| {
        let mut buckets: Vec<Vec<&'static str>> = vec![Vec::new(); 16];
        for name in dongs() {
            let len = name.chars().count();
            if len < 16 {
                buckets[len].push(name);
            }
        }
        buckets
    })
}

/// 두 문자열의 Levenshtein 편집거리가 `max` 이하인지(작은 문자열 전용, cutoff 조기종료).
fn edit_within(a: &[char], b: &[char], max: usize) -> bool {
    if a.len().abs_diff(b.len()) > max {
        return false;
    }
    let (la, lb) = (a.len(), b.len());
    let mut prev: Vec<usize> = (0..=lb).collect();
    for i in 1..=la {
        let mut cur = vec![i; lb + 1];
        let mut row_min = i;
        for j in 1..=lb {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
            row_min = row_min.min(cur[j]);
        }
        if row_min > max {
            return false; // 이 행 전체가 이미 max 초과 → 불가
        }
        prev = cur;
    }
    prev[lb] <= max
}

/// OCR 손상 대응(사용자 요청): 이름이 법정동/리와 **편집거리 `max` 이내**인지.
/// "여의도를"→"여의도동"(1치환)처럼 1글자 오인식을 복구한다. 너무 짧은 후보
/// (2글자 이하)는 오탐이 커 퍼지 매칭에서 제외한다. 정확 일치는 별도(is_legal_dong).
pub fn is_legal_dong_fuzzy(name: &str, max: usize) -> bool {
    let cand: Vec<char> = normalize_for_lookup(name).chars().collect();
    if cand.len() < 3 {
        return false;
    }
    let l = cand.len();
    for len in l.saturating_sub(max)..=(l + max) {
        let Some(bucket) = by_len().get(len) else { continue };
        for entry in bucket {
            let entry_chars: Vec<char> = entry.chars().collect();
            if edit_within(&cand, &entry_chars, max) {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_legal_dongs_are_present() {
        for name in ["서빙고동", "압구정동", "역삼동", "반포동", "성복동"] {
            assert!(is_legal_dong(name), "{name} 은 법정동 사전에 있어야 함");
        }
    }

    #[test]
    fn non_legal_dong_words_are_absent() {
        // 실존하지 않는(법정동이 아닌) 이름 — 오탐 배제 확인.
        for name in ["사무동", "회의동", "총무동"] {
            assert!(!is_legal_dong(name), "{name} 은 법정동이 아니어야 함");
        }
    }

    #[test]
    fn whitespace_is_ignored() {
        assert!(is_legal_dong("반포 동"));
    }
}
