# Site Content CMS — 수정영역 맵 v1 (#361)

운영자가 Backstage `사이트 문구 관리`(#323)에서 수정할 수 있는 사이트 카피 키 목록입니다. 모든 키는 `cms-bootstrap.js`(#324)가 페이지 진입 시 `GET /api/v1/site-content/bootstrap?pageKey=…&characterSlug=…`로 hydrate합니다. 발행된 entry가 없거나 API 실패 시 정적 fallback이 유지되어 빈 화면이 나오지 않습니다.

## 운영 원칙

- **고정 내비게이션 명칭은 수정영역에서 제외합니다.** 메인 메뉴, 모바일 탭바, 헤더 브랜드명, footer 링크 라벨, 약관/개인정보/환불 같은 법적 페이지 진입 라벨은 CMS 키를 부여하지 않습니다.
- **자주 바뀌는 영역만 등록합니다.** hero 제목/설명, CTA 라벨, 안내문, FAQ, 상태 카피.
- **모델별/캐릭터별 문구는 공용과 분리합니다.** `scope=character` + `characterSlug` 필터로 같은 contentKey의 캐릭터별 버전을 따로 발행합니다.
- **민감/계약/금액 문구는 별도 페이지(약관, 정책)로 분리하고 CMS에 올리지 않습니다.**
- **CMS 미발행 키는 정적 HTML이 그대로 노출됩니다.** 즉, 기존 카피를 운영자가 발행하지 않아도 화면이 깨지지 않습니다.

## 페이지별 키 맵

각 항목은 `(contentKey, 권장 scope, pageKey, 위치, fallback 텍스트)` 순으로 정리합니다.

### 1) `/` 홈 (`/index.html`) — v2 (#405)

`<body data-cms-page-key="home">` + `cms-bootstrap.js`로 연결.

| contentKey | scope | pageKey | 위치 | 정적 fallback |
|---|---|---|---|---|
| `home.hero.title` | page | home | `<h1 data-cms-key="home.hero.title">` | 아티스트와 팬이 만나는 공간, Lumina Stage |
| `home.hero.body`  | page | home | `<p class="hero-description" data-cms-key="home.hero.body">` | 팬의 응원이 순위를 만들고, 순위가 다음 무대를 여는 곳. … |

> **고정 유지**: hero-metrics(대표 아티스트 수 등 동적 지표), hero-feature(JS가 좋아요 1위 캐릭터로 채움), hero-actions CTA href(내비게이션 타겟). nav 라벨 제외 원칙 동일.

### 2) `/characters` 아티스트 라인업 (`/characters/index.html`)

| contentKey | scope | pageKey | 위치 | 정적 fallback |
|---|---|---|---|---|
| `characters.hero.title` | page | characters | `<h1>` hero | 각자의 무드를 가진 Lumina Stage 아티스트 |
| `characters.hero.body`  | page | characters | hero `<p>` | 차가운 뮤즈, 밝은 센터, … 팬이 발견할 다음 이름을 이곳에서 만나보세요. |

### 3) `/character-detail` 아티스트 상세 (`/character-detail/index.html`)

캐릭터별로 다른 문구가 노출돼야 하므로 모두 `scope=character` + `characterSlug=<slug>` 로 발행합니다. (생성 시 characterSlug 비워두면 모든 캐릭터에 공통으로 노출됨)

| contentKey | scope | pageKey | 위치 | 정적 fallback |
|---|---|---|---|---|
| `character-detail.intro.publicName` | character | character-detail | `#detailIntro h1` | `${artist.publicName}` |
| `character-detail.intro.summary`    | character | character-detail | `.detail-summary` | `${artist.summary}` |
| `character-detail.intro.body`       | character | character-detail | `.detail-bio p`   | `${artist.intro}` |
| `character-detail.intro.concept`    | character | character-detail | `.detail-concept` | `${artist.concept}` |
| `character-detail.chat.ctaLabel`    | character | character-detail | chatStartLink span | 이 아티스트와 대화하기 |
| `character-detail.chat.note`        | character | character-detail | chatStartLink 아래 안내문 | 처음이라면 추천 인사말로 가볍게… |

### 4) `/character-chat` 캐릭터챗 (`/character-chat/index.html`)

`character-detail`과 동일하게 `scope=character` + `characterSlug=<slug>` 운용.

| contentKey | scope | pageKey | 위치 | 정적 fallback |
|---|---|---|---|---|
| `character-chat.hero.summary`   | character | character-chat | `#chatHeroSummary` | 메시지를 준비하는 중이에요 |
| `character-chat.welcome.body`   | character | character-chat | `#chatWelcomeText` | 반가워요. 오늘은 어떤 이야기로 시작해볼까요? |
| `character-chat.empty.body`     | character | character-chat | `#chatEmpty p`     | 아티스트가 답장 준비 중이에요. 잠시 후 다시 시도해 주세요. |
| `character-chat.starter.eyebrow`| character | character-chat | `#chatStarterEyebrow` | 처음이라 어색하죠? |
| `character-chat.starter.prompt` | character | character-chat | `#chatStarterPrompt`  | 이렇게 말을 걸어볼까요? |

### 5) `/lumina-pick` 루미나 픽 (`/lumina-pick/index.html`)

| contentKey | scope | pageKey | 위치 | 정적 fallback |
|---|---|---|---|---|
| `lumina-pick.hero.title` | page | lumina-pick | `<h1>` hero | 루미나 픽 |
| `lumina-pick.hero.body`  | page | lumina-pick | hero `<p>`  | 팬의 선택이 이달의 주인공을 만듭니다. … |

### 6) `/shortform` 숏폼 (`/shortform/index.html`)

| contentKey | scope | pageKey | 위치 | 정적 fallback |
|---|---|---|---|---|
| `shortform.hero.title` | page | shortform | `<h1>` hero | 아티스트의 장면을 한곳에서 모아보는 숏폼 허브 |
| `shortform.hero.body`  | page | shortform | hero `<p>`  | 무대, 화보, 일상, 팬서비스까지. … |

### 7) `/debut` 데뷔하기 (`/debut/index.html`)

| contentKey | scope | pageKey | 위치 | 정적 fallback |
|---|---|---|---|---|
| `debut.hero.title`         | page | debut | `<h1>` hero | 나의 가능성을, 하나의 아티스트로. |
| `debut.hero.body`          | page | debut | hero `<p>`   | 외모, 목소리, 이야기, 콘셉트까지. … |
| `debut.post-submit.title`  | page | debut | submit 패널 `<strong>` | 마이페이지 데뷔 탭에서 신청 상태를 확인할 수 있어요. |
| `debut.post-submit.body`   | page | debut | submit 패널 안내 `<p>`  | 접수만으로 확정되지는 않아요. … |

> 데뷔 신청 FAQ/3단계 카드 같은 정형 안내는 v1에서는 정적 유지. 운영 변동이 잦으면 v2에서 `debut.faq.<n>.title|body` 키 추가 검토.

### 8) `/charge` 충전소 (`/charge/index.html`)

| contentKey | scope | pageKey | 위치 | 정적 fallback |
|---|---|---|---|---|
| `charge.hero.title`     | page | charge | `<h1>` hero      | 루미나 충전소 |
| `charge.hero.body`      | page | charge | hero `<p>`       | 좋아하는 아티스트에게 보낼 응원을 미리 준비해두세요. … |
| `charge.policy.title`   | page | charge | 결제 준비 카드 `<h2>` | 결제 시스템 준비 중 |
| `charge.policy.body`    | page | charge | 결제 준비 카드 `<p>`  | 결제 기능은 현재 준비 중이에요. … |

> 충전 상품 카드의 가격/지급 루미나 자체는 정책 API에서 내려와야 하므로 CMS 키로 두지 않습니다.

### 9) `/chat-rankings` 소통·후원 랭킹 (`/chat-rankings/index.html`)

| contentKey | scope | pageKey | 위치 | 정적 fallback |
|---|---|---|---|---|
| `chat-rankings.hero.title` | page | chat-rankings | `<h1>` hero | 프리미엄챗 소통·후원 랭킹 |
| `chat-rankings.hero.body`  | page | chat-rankings | hero `<p>`  | 프리미엄챗 방 열기, 대화, 후원 활동으로 집계되는 별도 랭킹이에요. … |

### 10) `/404` 페이지를 찾을 수 없을 때 (`/404.html`)

| contentKey | scope | pageKey | 위치 | 정적 fallback |
|---|---|---|---|---|
| `not-found.hero.title` | page | not-found | `<h1.not-found-title>` | 페이지를 찾을 수 없어요 |
| `not-found.hero.body`  | page | not-found | `.not-found-description` | 주소가 변경되었거나, 삭제된 페이지일 수 있어요. … |

## CMS 키 ↔ 화면 hydration 규칙

`cms-bootstrap.js` 동작 요약:

- `<body data-cms-page-key="X">`가 있는 페이지가 자동 hydrate 대상이 됩니다.
- 캐릭터 페이지(`character-detail`, `character-chat`)는 `data-cms-auto-character-slug="1"`로 URL의 `?slug=…`를 fetch 인자로 전달합니다.
- 각 element에 `data-cms-key="…"`를 부여하면 bootstrap이 해당 entry의 텍스트/링크를 적용합니다.
  - `data-cms-field` 미지정 시 태그로 기본 결정: `<h1~6>` → `title`, `<a>`/`<button>` → `ctaLabel`, 기타 → `body`.
  - `<a>` 태그는 `ctaLabel`과 `ctaHref` 둘 다 자동 적용. 명시적으로 `data-cms-field="ctaHref"`만 부여하면 href만 갱신.
- 응답 실패/키 누락 시 DOM 유지(정적 fallback) → `<html data-cms-state="fallback">`이 노출되어 QA에서 상태 확인 가능.

## 키 신청 가이드 (운영자용)

새로운 키가 필요한 경우:

1. 위 표에 없는 새 키이면 클라우드에게 요청해서 정적 fallback과 함께 추가합니다. (HTML/JS에 `data-cms-key` 부여 + 이 문서 갱신)
2. 모든 캐릭터에 공통이면 `characterSlug` 비워서 발행, 특정 캐릭터만 다르면 `characterSlug=yoon-serin` 등으로 새 entry 생성.
3. CTA URL은 `lumina-stage.com` / `www.lumina-stage.com` 호스트만 허용 (#322 서버 가드). 외부 URL은 거부됩니다.
4. raw HTML/script(`<a>`, `javascript:`, `data:text/html` 등)는 입력 시 서버가 거부합니다. 안내문은 평문으로만 작성합니다.

## 수정영역에 포함하지 않는 항목 (v1)

- 메인 nav 라벨 (홈/아티스트/루미나 픽/루미나 피드/숏폼/데뷔하기)
- 모바일 하단 탭바 라벨
- 헤더 브랜드 / 푸터 회사명 / 법적 페이지 진입 라벨 (이용약관/개인정보처리방침/환불 정책/Business Inquiry)
- 로그인/회원가입/계정 메뉴 버튼 라벨 (인증 흐름과 연결)
- 충전 상품 가격, 지급 루미나, 정산 금액 — 정책/회차 API에서 내려옴
- 데뷔 신청 폼 라벨, 필수 동의 안내 — 계약/법적 가드와 연결
- 백스테이지 관리자 화면 카피 (운영자 전용)
- 사용자 컨텐츠 (피드 본문, 댓글, 채팅 메시지)
- 토큰/이메일 인증 메일 본문 (서버 발송 → `action-token` 계약 측에서 관리)

## v2 신규 적용 (#405)

| contentKey | 페이지 | 상태 |
|---|---|---|
| `home.hero.title` | `/` 홈 | ✅ 연결 완료 (2026-05-23) |
| `home.hero.body`  | `/` 홈 | ✅ 연결 완료 (2026-05-23) |

## v2 → v3 후속 후보

- `debut.faq.<n>.title|body` (데뷔 FAQ 4~6개)
- `character-detail.gallery.note` (갤러리 영역 안내문)
- `lumina-feed.compose.hint` (작성창 placeholder/안내)
- `charge.product-card.note` (결제 안내 보조 문구)
- `creator-studio.dashboard.*` (운영자 대시보드 동기부여 카피)

## 변경 이력

- 2026-05-23 (#405): v2. 홈(`/`) hero 영역 CMS 연결. `home.hero.title` / `home.hero.body` 키 신규 추가. `index.html`에 `data-cms-page-key="home"` + `cms-bootstrap.js` 로드 추가. v2 신규 적용 표 및 v3 후보 목록 정리.
- 2026-05-21 (#361): v1 작성. characters/character-detail/character-chat/lumina-pick/shortform/debut/charge/chat-rankings/not-found 카피 키 분류. lumina-pick·shortform·404·character-chat starter prompt에 `data-cms-key` 신규 부여.
- 2026-05-20 (#324): cms-bootstrap.js로 hydrate 시작. characters/character-detail/character-chat/debut/charge 카피 키 초안 발행.
