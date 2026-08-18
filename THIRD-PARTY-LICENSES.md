# 서드파티 라이선스 및 출처 표기 (Third-Party Licenses & Attributions)

이 프로젝트의 자동검출 엔진(`src-tauri/src/detection.rs`)은 아래 오픈소스의
정규식·체크섬·문맥(anchor) 룰 일부를 **참고·재구현**했습니다. 코드를 직접 복사하지
않고 알고리즘을 참고한 부분이 대부분이나, 고지 의무 준수와 원저작자 존중을 위해
아래에 출처를 명시합니다.

---

## ko-pii

- **출처:** https://github.com/Marker-Inc-Korea/ko-pii
- **저작권:** Copyright (c) 2026 Marker Inc.
- **라이선스:** MIT License
- **활용 범위:** 한국어 PII 검출 규칙(주민등록번호 11-modulus 체크섬, 카드 Luhn
  체크섬, 전화/팩스 문맥 분류, 이메일·IP·URL 형식 검증, 계좌 은행명 anchor 등)의
  **알고리즘 참고 및 재구현**. `person.py`(이름), `io_`(파서), `vault`/`modes` 등은
  사용하지 않음.
- **데이터:** 사전 데이터(법정동 등)는 ko-pii 사본을 쓰지 않고 원 공공데이터
  (행정안전부)에서 직접 취득했습니다 — 아래 "법정동코드" 항목 참조.

### MIT License 전문

```
MIT License

Copyright (c) 2026 Marker Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 법정동코드 (법정동/리 이름 사전)

- **출처:** 행정안전부 「법정동코드 전체자료」 (Ministry of the Interior and Safety,
  Republic of Korea — Legal Dong Codes)
- **라이선스:** 공공누리 제1유형: 출처표시 (KOGL Type 1 — Attribution)
  <https://www.kogl.or.kr/info/license.do>
- **활용 범위:** 원자료에서 **법정동/리 이름만 추출·중복제거**하여 주소 검출의
  사전(`src-tauri/src/data/legal_dongs.txt`, 약 1.4만 건)으로 사용. 좌표·코드 등
  다른 필드는 포함하지 않음. 지번이 없는 주소("○○구 서빙고동")에서 **실존
  법정동일 때만** 주소로 인정하는 데 쓰인다(`detection.rs`, `legal_dong.rs`).
- **출처표시:** 본 사전은 행정안전부의 「법정동코드 전체자료」를 가공하여 제작되었으며,
  해당 공공저작물은 공공누리 제1유형(출처표시) 조건에 따라 이용하였습니다.
