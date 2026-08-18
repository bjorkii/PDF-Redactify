#!/usr/bin/env node
// pdfium-binaries(bblanchon)에서 현재 OS/아키텍처에 맞는 pdfium 동적 라이브러리를 내려받아
// src-tauri/vendor/pdfium/<platform>/ 에 배치한다.
// 버전은 재현 가능한 빌드를 위해 고정한다(재검증/업데이트 시 이 상수만 변경).
import { mkdtempSync, mkdirSync, createWriteStream, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";

// pdfium-render의 기본 바인딩(pdfium_latest = pdfium_7881 feature)과 반드시
// 같은 버전이어야 한다 — 어긋나면 렌더링처럼 단순한 호출은 우연히 동작하지만
// 객체 제거(SAVE-01) 같은 내부 구조를 건드리는 호출에서 세그폴트가 난다.
const PDFIUM_TAG = "chromium/7881";
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const VENDOR_ROOT = join(REPO_ROOT, "src-tauri", "vendor", "pdfium");

const TARGETS = {
  "darwin": { asset: "pdfium-mac-univ.tgz", dir: "macos-universal", lib: "libpdfium.dylib" },
  "win32-x64": { asset: "pdfium-win-x64.tgz", dir: "windows-x64", lib: "pdfium.dll" },
  "win32-arm64": { asset: "pdfium-win-arm64.tgz", dir: "windows-arm64", lib: "pdfium.dll" },
};

function resolveTarget() {
  const key = process.platform === "darwin" ? "darwin" : `${process.platform}-${process.arch}`;
  const target = TARGETS[key];
  if (!target) {
    throw new Error(`지원하지 않는 플랫폼입니다: ${key}`);
  }
  return target;
}

async function download(url, destPath) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`다운로드 실패 (${res.status}): ${url}`);
  await pipeline(res.body, createWriteStream(destPath));
}

async function main() {
  const target = resolveTarget();
  const destDir = join(VENDOR_ROOT, target.dir);
  const destLib = join(destDir, target.lib);

  if (existsSync(destLib) && !process.argv.includes("--force")) {
    console.log(`이미 존재합니다: ${destLib} (재다운로드하려면 --force)`);
    return;
  }

  mkdirSync(destDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "pdfium-fetch-"));
  const archivePath = join(work, target.asset);
  const url = `https://github.com/bblanchon/pdfium-binaries/releases/download/${PDFIUM_TAG}/${target.asset}`;

  console.log(`받는 중: ${url}`);
  await download(url, archivePath);

  const extractDir = join(work, "extract");
  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", archivePath, "-C", extractDir]);

  const srcLib = join(extractDir, "lib", target.lib);
  if (!existsSync(srcLib)) {
    throw new Error(`압축 해제 결과에서 라이브러리를 찾을 수 없습니다: ${srcLib}`);
  }
  copyFileSync(srcLib, destLib);

  const srcLicense = join(extractDir, "LICENSE");
  if (existsSync(srcLicense)) {
    copyFileSync(srcLicense, join(destDir, "LICENSE"));
  }

  console.log(`설치 완료: ${destLib}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
