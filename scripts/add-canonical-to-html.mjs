/* #319 — 기존 <page>.html 파일에 <link rel="canonical"> 추가.
 *
 * 사용법: `node scripts/add-canonical-to-html.mjs`
 *
 * - clean URL 매핑이 있는 페이지: canonical 을 /<clean-route>/ 로 설정해 SEO 가 clean URL 을 우선
 * - 매핑이 없는 페이지: self-canonical 로 안전한 기본값
 * - 이미 canonical 이 있는 파일은 건너뜀 (idempotent)
 * - <meta name="description" 바로 위 또는 <link rel="stylesheet"> 위에 삽입 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Users/하마다랩스/Documents/New project/workspace-core";

const CANONICAL_MAP = {
  "characters.html":       "/characters/",
  "character-detail.html": "/character-detail/",
  "character-chat.html":   "/character-chat/",
  "popular-vote.html":     "/lumina-pick/",
  "lumina-feed.html":      "/lumina-feed/",
  "shortform.html":        "/shortform/",
  "mypage.html":           "/mypage/",
  "user-profile.html":     "/my-profile/",
  "creator-studio.html":   "/creator-studio/",
  "backstage.html":        "/backstage/",
  "debut.html":            "/debut/",
  "charge.html":           "/charge/",
  "verify-email.html":     "/verify-email/",
  "reset-password.html":   "/reset-password/",
  "index.html":            "/",
  // 약관/정책류는 clean URL 없음 → self-canonical
  "terms.html":            "/terms.html",
  "privacy.html":          "/privacy.html",
  "refund-policy.html":    "/refund-policy.html",
  "debut-terms.html":      "/debut-terms.html",
  "business.html":         "/business.html"
};

let touched = 0;
let skipped = 0;
for (const [file, canonical] of Object.entries(CANONICAL_MAP)) {
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    process.stderr.write(`skip ${file} — not found\n`);
    skipped += 1;
    continue;
  }
  const html = readFileSync(path, "utf8");
  if (/<link\s+rel="canonical"/i.test(html)) {
    process.stdout.write(`skip ${file} — canonical already present\n`);
    skipped += 1;
    continue;
  }
  // <meta name="description" 위에 삽입. 없으면 <head> 끝에 삽입.
  const canonicalTag = `    <link rel="canonical" href="${canonical}" />`;
  let updated;
  const descRegex = /(\n\s*<meta\s+name="description")/i;
  if (descRegex.test(html)) {
    updated = html.replace(descRegex, `\n${canonicalTag}$1`);
  } else {
    updated = html.replace(/(<\/head>)/i, `${canonicalTag}\n  $1`);
  }
  if (updated === html) {
    process.stderr.write(`!! ${file} — no insertion point found, please add manually\n`);
    skipped += 1;
    continue;
  }
  writeFileSync(path, updated, "utf8");
  process.stdout.write(`+canonical ${file} -> ${canonical}\n`);
  touched += 1;
}

process.stdout.write(`\n#319 canonical done. ${touched} files updated, ${skipped} skipped.\n`);
