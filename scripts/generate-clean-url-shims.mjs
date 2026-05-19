/* #319 — clean URL shim generator.
 *
 * 사용법: `node scripts/generate-clean-url-shims.mjs`
 *
 * - 입력: CLEAN_URL_MAP 의 각 entry { route, target }
 * - 출력: `<route>/index.html` shim 파일
 * - shim 은 location.search + location.hash 를 보존하면서 location.replace 로 target 으로 이동
 * - JS 가 꺼져 있는 환경을 위해 <noscript> 안에 meta refresh fallback (query 손실 가능, 동작 보장 우선)
 * - shim 은 noindex/nofollow + canonical=clean URL 으로 SEO 중복 방지
 *
 * 정적 호스팅에서 동작 가능한 구조. backend / server-rewrite 의존 없음. */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CLEAN_URL_MAP = [
  // route(slug)        target(.html 파일)         설명
  { route: "characters",       target: "characters.html" },
  { route: "character-detail", target: "character-detail.html" },
  { route: "character-chat",   target: "character-chat.html" },
  { route: "lumina-pick",      target: "popular-vote.html" },
  { route: "lumina-feed",      target: "lumina-feed.html" },
  { route: "shortform",        target: "shortform.html" },
  { route: "mypage",           target: "mypage.html" },
  { route: "my-profile",       target: "user-profile.html" },
  { route: "creator-studio",   target: "creator-studio.html" },
  { route: "backstage",        target: "backstage.html" },
  { route: "debut",            target: "debut.html" },
  { route: "charge",           target: "charge.html" },
  { route: "verify-email",     target: "verify-email.html" },
  { route: "reset-password",   target: "reset-password.html" }
];

const TEMPLATE = ({ route, target }) => `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>이동 중 — Lumina Stage</title>
    <meta name="robots" content="noindex, nofollow" />
    <link rel="canonical" href="/${route}/" />
    <!-- #319 — clean URL shim. JS 켜진 환경에서는 location.replace 로 query/hash 보존하며 이동.
         JS 꺼진 환경에서는 meta refresh 로 fallback (query 일부 손실 가능, 동작 보장 우선). -->
    <noscript><meta http-equiv="refresh" content="0;url=/${target}" /></noscript>
    <script>
      (function () {
        var target = "/${target}" + (location.search || "") + (location.hash || "");
        location.replace(target);
      }());
    </script>
  </head>
  <body>
    <p style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#888;padding:24px;line-height:1.6;">
      잠시만요. 자동으로 이동되지 않으면 <a href="/${target}">여기를 눌러 페이지로 이동</a>해주세요.
    </p>
  </body>
</html>
`;

let written = 0;
for (const entry of CLEAN_URL_MAP) {
  const dir = join(ROOT, entry.route);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "index.html");
  writeFileSync(file, TEMPLATE(entry), "utf8");
  written += 1;
  process.stdout.write(`wrote ${entry.route}/index.html → /${entry.target}\n`);
}

process.stdout.write(`\n#319 generator done. ${written} shim files written.\n`);
