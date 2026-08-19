# 서드파티 라이선스 및 출처 표기 (Third-Party Licenses & Attributions)

이 문서는 PDF-Redactify가 사용·재배포하는 서드파티 구성요소의 출처·라이선스를
정리합니다. 크게 두 종류입니다.

1. **바이너리로 재배포하는 구성요소** — 특히 PDF 엔진 **pdfium**. 배포물에 실제로
   포함되므로 라이선스 고지가 배포물에 **동반**되어야 합니다.
2. **알고리즘 참고·재구현** — 자동검출 엔진(`src-tauri/src/detection.rs`)이 ko-pii의
   규칙 일부를 참고·재구현. 코드 직접 복사가 아닌 참고가 대부분이나 원저작자 존중을
   위해 명시합니다.

> **배포물 동봉 고지:** 실제 배포 앱에는 pdfium 및 전체 Rust/npm 의존성 라이선스
> 전문을 담은 파일이 리소스로 함께 번들됩니다 —
> `src-tauri/licenses/`(`THIRD-PARTY-NOTICES.txt`, `pdfium-LICENSE.txt`,
> `pdfium-binaries-LICENSE.txt`). 재생성: `npm run gen:notices`.

---

## pdfium (PDF 렌더·좌표·저장 엔진)

- **pdfium 자체:** Copyright The PDFium Authors — **BSD-3-Clause**(일부 파일 Apache-2.0).
  전문: `src-tauri/licenses/pdfium-LICENSE.txt`.
- **배포 바이너리 패키징:** [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries)
  — Copyright Benoit Blanchon, **MIT**(빌드 스크립트/패키징). 전문:
  `src-tauri/licenses/pdfium-binaries-LICENSE.txt`.
- **활용:** `pdfium-render`(BSD-3-Clause) 크레이트를 통해 pdfium 동적 라이브러리를
  로드해 렌더링·텍스트/좌표 추출·블랙마킹 반영에 사용. 라이브러리 바이너리는
  `npm run setup:pdfium`으로 받아 배포 번들에 리소스로 포함됨.

---

## Rust / npm 의존성 (전체)

앱 바이너리에 컴파일되어 재배포되는 Rust 크레이트(≈518개)와 프론트 런타임 npm
패키지의 라이선스(대부분 MIT·Apache-2.0·BSD·ISC·Zlib 등 허용형)는
`src-tauri/licenses/THIRD-PARTY-NOTICES.txt`에 이름·버전·SPDX·라이선스 전문으로
정리되어 있으며 배포물에 동봉됩니다.

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
