#!/usr/bin/env node
// 배포 앱에 동봉할 서드파티 고지(THIRD-PARTY-NOTICES.txt)를 생성한다.
// - Rust 의존성: `cargo metadata`에서 (이름·버전·SPDX 라이선스) 수집.
// - npm 런타임 의존성: package.json의 dependencies(빌드 전용 devDeps는 배포물에 미포함).
// - 각 라이선스 전문: SPDX license-list-data의 정본 텍스트를 받아 부록으로 첨부.
// pdfium 자체 라이선스는 별도 파일(licenses/pdfium-LICENSE.txt, pdfium-binaries-LICENSE.txt).
//
// 재생성: `node scripts/gen-third-party-notices.mjs`

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src-tauri", "licenses", "THIRD-PARTY-NOTICES.txt");
const SPDX_BASE = "https://raw.githubusercontent.com/spdx/license-list-data/main/text";

// --- Rust deps ---
const meta = JSON.parse(
  execSync("cargo metadata --format-version 1 --all-features", {
    cwd: join(ROOT, "src-tauri"),
    maxBuffer: 64 * 1024 * 1024,
  }).toString(),
);
const members = new Set(meta.workspace_members);
const rustPkgs = meta.packages
  .filter((p) => !members.has(p.id))
  .map((p) => ({ name: p.name, version: p.version, license: p.license || "(unspecified)" }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

// --- npm runtime deps ---
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const npmDeps = Object.keys(pkg.dependencies || {}).sort();
const npmLicense = (name) => {
  const p = join(ROOT, "node_modules", name, "package.json");
  if (existsSync(p)) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return typeof j.license === "string" ? j.license : (j.license?.type ?? "(see package)");
  }
  return "(not installed)";
};

// --- 등장하는 원자 라이선스 ID 수집(OR/AND/WITH/괄호/슬래시 분리) ---
const atomic = new Set();
for (const p of rustPkgs) {
  for (const tok of p.license.split(/\s+(?:OR|AND|WITH)\s+|[()/]/)) {
    const id = tok.trim();
    if (id && !/^(OR|AND|WITH)$/i.test(id)) atomic.add(id);
  }
}
for (const d of npmDeps) {
  for (const tok of npmLicense(d).split(/\s+(?:OR|AND|WITH)\s+|[()/]/)) {
    const id = tok.trim();
    if (id && id !== "(not installed)" && id !== "(see package)") atomic.add(id);
  }
}

// SPDX에 없는/예외 식별자는 부록 대상에서 제외(주석으로만 남김).
const SKIP = new Set(["(unspecified)", "LLVM-exception"]);
const ids = [...atomic].filter((id) => !SKIP.has(id)).sort();

async function fetchText(id) {
  try {
    const res = await fetch(`${SPDX_BASE}/${id}.txt`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const texts = {};
for (const id of ids) {
  const t = await fetchText(id);
  if (t) texts[id] = t.trimEnd();
  else console.warn(`  경고: SPDX 텍스트 못 받음 — ${id}`);
}

// --- 조립 ---
const L = [];
L.push("PDF-Redactify — Third-Party Notices");
L.push("=".repeat(72));
L.push("");
L.push("이 파일은 PDF-Redactify 배포물에 포함·재배포되는 서드파티 구성요소의");
L.push("라이선스 고지입니다. `scripts/gen-third-party-notices.mjs`로 자동 생성됩니다.");
L.push("");
L.push("● PDF 엔진: pdfium(구글/The PDFium Authors, BSD-3-Clause) — 바이너리로 동봉.");
L.push("  전문: 같은 폴더의 `pdfium-LICENSE.txt`(pdfium 자체) 및");
L.push("        `pdfium-binaries-LICENSE.txt`(bblanchon/pdfium-binaries 패키징, MIT).");
L.push("● 검출 규칙 참고·재구현: ko-pii(MIT), 법정동 사전: 행안부(KOGL 제1유형).");
L.push("  자세한 출처는 리포지토리 THIRD-PARTY-LICENSES.md 참조.");
L.push("");
L.push("-".repeat(72));
L.push(`Rust 의존성 (${rustPkgs.length}개) — 이름 버전 · SPDX 라이선스`);
L.push("-".repeat(72));
for (const p of rustPkgs) L.push(`  ${p.name} ${p.version} · ${p.license}`);
L.push("");
L.push("-".repeat(72));
L.push(`npm 런타임 의존성 (${npmDeps.length}개)`);
L.push("-".repeat(72));
for (const d of npmDeps) L.push(`  ${d} ${pkg.dependencies[d]} · ${npmLicense(d)}`);
L.push("");
L.push("=".repeat(72));
L.push("라이선스 전문(부록) — 위 구성요소들이 참조하는 라이선스");
L.push("=".repeat(72));
for (const id of ids) {
  if (!texts[id]) continue;
  L.push("");
  L.push("#".repeat(72));
  L.push(`# ${id}`);
  L.push("#".repeat(72));
  L.push(texts[id]);
}
L.push("");

writeFileSync(OUT, L.join("\n"));
console.log(`생성 완료: ${OUT}`);
console.log(`  Rust ${rustPkgs.length} · npm ${npmDeps.length} · 라이선스 전문 ${Object.keys(texts).length}종`);
