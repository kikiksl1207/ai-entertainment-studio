/* #319 — root *.html 파일의 nav/footer/cta 링크를 clean URL 로 일괄 교체.
 *
 * 사용법: `node scripts/rewrite-nav-clean-urls.mjs`
 *
 * - root *.html 파일만 대상 (subdirectory shim 은 제외)
 * - 단순 치환 (`./<page>.html` → `./<clean>/`)이라 inline scripts/문서 본문에 같은
 *   문자열 토큰이 있을 경우도 같이 바뀐다. 이때를 위해 사전에 `<a href>` / data-tab-key /
 *   meta og:url 같은 안전 케이스만 명시적으로 처리. */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Users/하마다랩스/Documents/New project/workspace-core";

// .html target → clean URL slug
const CLEAN_URL_MAP = {
  "characters.html":       "characters/",
  "character-detail.html": "character-detail/",
  "character-chat.html":   "character-chat/",
  "popular-vote.html":     "lumina-pick/",
  "lumina-feed.html":      "lumina-feed/",
  "shortform.html":        "shortform/",
  "mypage.html":           "mypage/",
  "user-profile.html":     "my-profile/",
  "creator-studio.html":   "creator-studio/",
  "backstage.html":        "backstage/",
  "debut.html":            "debut/",
  "charge.html":           "charge/",
  "verify-email.html":     "verify-email/",
  "reset-password.html":   "reset-password/"
};

// index.html, terms.html, privacy.html, refund-policy.html, debut-terms.html, business.html 은
// clean URL 매핑이 없으므로 그대로 둔다.

const rootFiles = readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith(".html"))
  .map(d => d.name);

let updatedFiles = 0;
for (const file of rootFiles) {
  const path = join(ROOT, file);
  let html = readFileSync(path, "utf8");
  const before = html;

  // <a href="./<page>.html"> 그리고 <a href="./<page>.html#anchor"> / ?query 도 함께
  // <a class="..." href="./<page>.html"> 형태도 같이 매칭
  for (const [target, slug] of Object.entries(CLEAN_URL_MAP)) {
    // href 속성 안의 깔끔한 케이스: href="./<page>.html" 또는 href="./<page>.html#..." 또는 ?...
    const hrefRel = new RegExp(`href="\\./${target.replace(/\\./g, "\\\\.")}(["#?])`, "g");
    html = html.replace(hrefRel, (_m, tail) => `href="./${slug}${tail === "\"" ? "\"" : tail}`);

    // window.location 또는 inline JS 안의 location.href = "./<page>.html" 도 보조 처리
    // (보수적으로 따옴표로 감싸진 ./xxx.html 형태)
    const locationRel = new RegExp(`(["'])\\./${target.replace(/\\./g, "\\\\.")}(["'#?])`, "g");
    html = html.replace(locationRel, (_m, q, tail) => `${q}./${slug}${tail === q ? q : tail}`);

    // og:url 절대 URL 도 갱신: https://www.lumina-stage.com/<page>.html → /<slug>
    const ogUrl = new RegExp(`(https://www\\.lumina-stage\\.com)/${target.replace(/\\./g, "\\\\.")}`, "g");
    html = html.replace(ogUrl, (_m, host) => `${host}/${slug}`);
  }

  if (html !== before) {
    writeFileSync(path, html, "utf8");
    updatedFiles += 1;
    process.stdout.write(`+nav ${file}\n`);
  } else {
    process.stdout.write(`. ${file} (no change)\n`);
  }
}

process.stdout.write(`\n#319 nav rewrite done. ${updatedFiles} files updated.\n`);
