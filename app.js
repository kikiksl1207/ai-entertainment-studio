/* ─────────────────────────────────────────────
   Lumina Stage — app.js
   Claude 담당: 프론트/UI
   Codex 담당: 백엔드/DB/API/Git push
   ───────────────────────────────────────────── */

/* ── API 설정 ──────────────────────────────────
   백엔드 배포 후 API_BASE를 실제 URL로 변경
   예) 'https://api.luminastage.com'
   로컬 개발: 'http://localhost:3000'
   빈 문자열 = 로컬 데이터 fallback 자동 사용
   ─────────────────────────────────────────── */
const API_BASE = "https://api.lumina-stage.com";

async function apiFetch(path, options = {}, _retryDepth = 0) {
  if (!API_BASE) return null;
  const { method = "GET", body, auth = false, throwOnError = false, headers: extraHeaders = {} } = options;

  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  // #057: caller가 추가 헤더를 넘기면 머지 (예: Idempotency-Key)
  // — auth/Content-Type을 의도치 않게 덮어쓰지 않도록 마지막에 머지
  Object.assign(headers, extraHeaders);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    clearTimeout(timer);

    // #088 — auth 요청이 401이고 첫 시도면 refresh + 원래 요청 1회 재시도
    // refresh endpoint 자체는 retry 대상에서 제외 (무한 루프 방지)
    if (res.status === 401 && auth && _retryDepth === 0 && path !== "/api/v1/auth/refresh") {
      const refreshed = await refreshAuthOnce();
      if (refreshed) {
        // 새 토큰으로 동일 method/body/extraHeaders 보존하여 재시도
        return apiFetch(path, options, 1);
      }
      // refresh 실패 → 아래 일반 401 처리로 떨어짐 (사용자 안내는 refreshAuthOnce 안에서 이미 처리)
    }

    if (!res.ok) {
      if (throwOnError) {
        const errBody = await res.json().catch(() => ({}));
        const err = new Error(errBody.message || errBody.error?.message || `요청 실패 (${res.status})`);
        err.status = res.status;
        err.body = errBody;
        throw err;
      }
      return null;
    }

    if (res.status === 204) return null;
    return await res.json();
  } catch (e) {
    if (throwOnError) throw e;
    return null;
  }
}

/* ══════════════════════════════════════════════
   #088 — apiFetch 401 → refresh → retry 흐름 (2026-05-03)
   - 차모 백엔드 계약: POST /api/v1/auth/refresh, body { refreshToken }
     Authorization 헤더 미사용, 응답은 login과 같은 shape (accessToken/refreshToken 둘 다 회전)
     refresh 자체 401/403은 만료/폐기 → clearAuth + 로그인 안내
   - 단일 in-flight (mutex) — 동시 401 wave가 refresh를 중복 호출하지 않도록
   ══════════════════════════════════════════════ */
let _refreshInFlight = null;

async function refreshAuthOnce() {
  if (_refreshInFlight) return _refreshInFlight;

  const auth = getAuth();
  const refreshToken = auth?.refreshToken;
  if (!refreshToken) {
    notifyAuthExpired();
    return null;
  }

  _refreshInFlight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(API_BASE + "/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // #088 — Authorization 헤더 사용 안 함
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        console.warn("[#088 refresh] 실패 status=", res.status);
        clearAuth();
        notifyAuthExpired();
        return null;
      }
      const data = await res.json().catch(() => null);
      // #078 차모 계약: tokens.accessToken/tokens.refreshToken + top-level alias
      const newAccess = data?.accessToken || data?.tokens?.accessToken || data?.access_token;
      const newRefresh = data?.refreshToken || data?.tokens?.refreshToken || data?.refresh_token;
      const user = data?.user || auth.user;
      if (!newAccess) {
        console.warn("[#088 refresh] 응답에 accessToken 없음", data);
        clearAuth();
        notifyAuthExpired();
        return null;
      }
      setAuth({
        accessToken: newAccess,
        refreshToken: newRefresh || refreshToken, // rotation 미적용 시 기존값 유지
        user
      });
      console.info("[#088 refresh] OK");
      return { accessToken: newAccess, refreshToken: newRefresh, user };
    } catch (err) {
      console.warn("[#088 refresh] 예외:", err);
      clearAuth();
      notifyAuthExpired();
      return null;
    } finally {
      // 다음 wave를 위해 microtask 뒤 락 해제 — 동일 wave는 같은 promise 결과 공유
      setTimeout(() => { _refreshInFlight = null; }, 0);
    }
  })();

  return _refreshInFlight;
}

function notifyAuthExpired() {
  // 디바운스 — 동시 다발 401 직후 모달 여러 번 안 띄우게
  if (typeof window === "undefined") return;
  if (window.__authExpiredNotified) return;
  window.__authExpiredNotified = true;
  setTimeout(() => { window.__authExpiredNotified = false; }, 3000);

  // 헤더 UI 동기화 (로그인 버튼 복귀)
  if (typeof updateAuthUI === "function") {
    try { updateAuthUI(); } catch {}
  }
  // 다른 영역에서 듣고 처리할 수 있도록 이벤트 발사
  try { window.dispatchEvent(new CustomEvent("lumina:auth-expired")); } catch {}
  // 로그인 모달 자동 오픈 (있으면)
  if (typeof openAuthModal === "function") {
    try { openAuthModal("login"); } catch {}
  }
}

/* ── 인증 (Auth) ───────────────────────────────
   localStorage 기반 토큰 관리 + 로그인/회원가입/로그아웃
   ─────────────────────────────────────────── */
const AUTH_STORAGE_KEY = "lumina_auth";

function getAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setAuth(auth) {
  if (auth) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  else      localStorage.removeItem(AUTH_STORAGE_KEY);
}
function clearAuth() { setAuth(null); }
function isLoggedIn() { return !!(getAuth()?.accessToken); }
function getAccessToken() { return getAuth()?.accessToken || null; }

/* ══════════════════════════════════════════════
   #064 — i18n 1차 골격 (4개 언어, 2026-05-03)
   - 지원 locale: ko-KR / ja-JP / en-US / zh-CN
   - fallback 순서: localStorage → settings.locale → navigator → ko-KR
   - 로그인 사용자 변경 → PATCH /me/settings 자동 저장
   - 비로그인 → localStorage만
   - 사전: 에밀리 #064 핵심 키 + nav/footer/auth 추가
   ══════════════════════════════════════════════ */
const I18N_LOCALES = ["ko-KR", "ja-JP", "en-US", "zh-CN"];
const I18N_FALLBACK = "ko-KR";
const I18N_STORAGE_KEY = "lumina_locale";

// 사전 — 에밀리 #064 톤/용어집 + 클라우드 추가 nav/footer/auth
const I18N_DICT = {
  // ── 공통 nav ──
  "nav.home": { "ko-KR": "홈", "ja-JP": "ホーム", "en-US": "Home", "zh-CN": "首页" },
  "nav.artists": { "ko-KR": "아티스트", "ja-JP": "アーティスト", "en-US": "Artists", "zh-CN": "艺人" },
  "nav.luminaPick": { "ko-KR": "루미나 픽", "ja-JP": "ルミナピック", "en-US": "Lumina Pick", "zh-CN": "Lumina Pick" },
  "nav.luminaFeed": { "ko-KR": "루미나 피드", "ja-JP": "ルミナフィード", "en-US": "Lumina Feed", "zh-CN": "Lumina Feed" },
  "nav.shortform": { "ko-KR": "숏폼", "ja-JP": "ショート", "en-US": "Shorts", "zh-CN": "短视频" },
  "nav.debut": { "ko-KR": "데뷔하기", "ja-JP": "デビュー申請", "en-US": "Debut", "zh-CN": "出道申请" },
  "nav.mypage": { "ko-KR": "마이페이지", "ja-JP": "マイページ", "en-US": "My Page", "zh-CN": "我的主页" },
  // ── 헤더 auth ──
  "auth.login": { "ko-KR": "로그인", "ja-JP": "ログイン", "en-US": "Log in", "zh-CN": "登录" },
  "auth.signup": { "ko-KR": "회원가입", "ja-JP": "新規登録", "en-US": "Sign up", "zh-CN": "注册" },
  "auth.logout": { "ko-KR": "로그아웃", "ja-JP": "ログアウト", "en-US": "Log out", "zh-CN": "退出登录" },
  "auth.loginRequired": {
    "ko-KR": "로그인 후 이용할 수 있어요.",
    "ja-JP": "ログイン後にご利用いただけます。",
    "en-US": "Please log in to continue.",
    "zh-CN": "请登录后继续使用。"
  },
  // ── 모바일 하단 탭바 ──
  "tab.home": { "ko-KR": "홈", "ja-JP": "ホーム", "en-US": "Home", "zh-CN": "首页" },
  "tab.artists": { "ko-KR": "아티스트", "ja-JP": "アーティスト", "en-US": "Artists", "zh-CN": "艺人" },
  "tab.pick": { "ko-KR": "루미나 픽", "ja-JP": "ルミナピック", "en-US": "Lumina Pick", "zh-CN": "Lumina Pick" },
  "tab.feed": { "ko-KR": "피드", "ja-JP": "フィード", "en-US": "Feed", "zh-CN": "动态" },
  "tab.shortform": { "ko-KR": "숏폼", "ja-JP": "ショート", "en-US": "Shorts", "zh-CN": "短视频" },
  // ── 푸터 ──
  "footer.artistRoster": { "ko-KR": "아티스트 라인업", "ja-JP": "アーティスト一覧", "en-US": "Artist Roster", "zh-CN": "艺人阵容" },
  "footer.terms": { "ko-KR": "이용약관", "ja-JP": "利用規約", "en-US": "Terms of Service", "zh-CN": "服务条款" },
  "footer.privacy": { "ko-KR": "개인정보처리방침", "ja-JP": "プライバシーポリシー", "en-US": "Privacy Policy", "zh-CN": "隐私政策" },
  "footer.refund": { "ko-KR": "환불 정책", "ja-JP": "返金ポリシー", "en-US": "Refund Policy", "zh-CN": "退款政策" },
  "footer.businessInquiry": { "ko-KR": "Business Inquiry", "ja-JP": "Business Inquiry", "en-US": "Business Inquiry", "zh-CN": "商务合作" },
  "footer.businessInquiry.helper": {
    "ko-KR": "브랜드 협업, IP 제휴, 제작 문의는 Lumina Stage 비즈니스 채널로 연결됩니다.",
    "ja-JP": "ブランドコラボ、IP提携、制作のお問い合わせはLumina Stageのビジネス窓口へ。",
    "en-US": "Brand partnerships, IP collaborations, and production inquiries connect to Lumina Stage business.",
    "zh-CN": "品牌合作、IP联动及制作咨询，请通过Lumina Stage商务渠道。"
  },
  // ── 브랜드 ──
  "brand.tagline": { "ko-KR": "아티스트 레이블", "ja-JP": "アーティストレーベル", "en-US": "Artist Label", "zh-CN": "艺人厂牌" },
  // ── 데뷔하기 강조 CTA (모바일) ──
  "cta.debut": { "ko-KR": "데뷔하기", "ja-JP": "デビュー申請", "en-US": "Debut", "zh-CN": "出道申请" }
};

let _currentLocale = I18N_FALLBACK;

/** 사전에 정의된 키를 현재 locale로 변환. 키가 없으면 키 자체 반환. */
function t(key, locale) {
  const useLocale = locale || _currentLocale;
  const entry = I18N_DICT[key];
  if (!entry) return key;
  return entry[useLocale] || entry[I18N_FALLBACK] || key;
}

/** locale 자동 감지: localStorage > navigator.language > ko-KR */
function detectLocale() {
  // localStorage 우선 (사용자가 직접 변경한 적 있는 경우)
  try {
    const stored = localStorage.getItem(I18N_STORAGE_KEY);
    if (stored && I18N_LOCALES.includes(stored)) return stored;
  } catch (_) { /* localStorage 막힌 환경 무시 */ }

  // navigator.language(s) — 정확 매칭 → prefix 매칭
  const langs = [];
  if (typeof navigator !== "undefined") {
    if (navigator.language) langs.push(navigator.language);
    if (Array.isArray(navigator.languages)) langs.push(...navigator.languages);
  }
  for (const l of langs) {
    if (I18N_LOCALES.includes(l)) return l;
    const prefix = (l || "").split("-")[0];
    const match = I18N_LOCALES.find(x => x.startsWith(prefix + "-"));
    if (match) return match;
  }
  return I18N_FALLBACK;
}

/** DOM 안 [data-i18n] 요소를 t()로 갱신.
   - data-i18n="key" → textContent 교체
   - data-i18n-attr="placeholder:key,title:key" → 속성 교체 */
function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if (!key) return;
    const value = t(key);
    // 자식이 있는 요소는 첫 텍스트 노드만 교체 (아이콘 + 라벨 구조 보호)
    if (el.children.length > 0) {
      let textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (textNode) textNode.textContent = value;
      else el.appendChild(document.createTextNode(value));
    } else {
      el.textContent = value;
    }
  });
  scope.querySelectorAll("[data-i18n-attr]").forEach(el => {
    const pairs = (el.dataset.i18nAttr || "").split(",");
    pairs.forEach(pair => {
      const [attr, key] = pair.split(":").map(s => (s || "").trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

/** locale 변경 — UI 즉시 갱신 + localStorage 저장 + 로그인 시 서버 동기화 */
async function setLocale(locale) {
  if (!I18N_LOCALES.includes(locale)) return;
  _currentLocale = locale;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  try { localStorage.setItem(I18N_STORAGE_KEY, locale); } catch (_) {}
  applyI18n();
  // 로그인 사용자만 서버 저장 (실패해도 로컬 적용 유지)
  if (isLoggedIn()) {
    try {
      await apiFetch("/api/v1/me/settings", {
        method: "PATCH",
        auth: true,
        body: { locale }
      });
    } catch (err) {
      console.warn("[Lumina] PATCH /me/settings locale 저장 실패:", err);
    }
  }
}

/** init — 페이지 로드 시 호출. 서버 settings 우선, 그다음 detectLocale. */
async function initI18n() {
  let resolved = detectLocale();
  // 로그인 사용자: 서버 settings.locale을 최우선으로 사용
  if (isLoggedIn()) {
    try {
      const res = await apiFetch("/api/v1/me/settings", { auth: true });
      const serverLocale = res?.settings?.locale || res?.locale;
      if (serverLocale && I18N_LOCALES.includes(serverLocale)) {
        resolved = serverLocale;
        try { localStorage.setItem(I18N_STORAGE_KEY, serverLocale); } catch (_) {}
      }
    } catch (_) { /* 실패해도 로컬 detect 결과 사용 */ }
  }
  _currentLocale = resolved;
  if (typeof document !== "undefined") document.documentElement.lang = resolved;
  applyI18n();
}

// 외부 노출 — 마이페이지 언어 select 등에서 사용
if (typeof window !== "undefined") {
  window.luminaI18n = {
    t,
    setLocale,
    getLocale: () => _currentLocale,
    apply: applyI18n,
    LOCALES: I18N_LOCALES
  };
}

async function authLogin(email, password) {
  const data = await apiFetch("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
    throwOnError: true
  });
  console.log("[Lumina] login 응답:", data);
  // 응답: { user, tokens: { accessToken, refreshToken } } 또는 호환 별칭 (top-level)
  const token = data?.accessToken || data?.tokens?.accessToken || data?.access_token;
  const refresh = data?.refreshToken || data?.tokens?.refreshToken;
  const user = data?.user;
  if (token) setAuth({ accessToken: token, refreshToken: refresh, user });
  return data;
}
async function authRegister(email, password, displayName, referralCode) {
  const body = { email, password, displayName };
  if (referralCode) body.referralCode = referralCode;
  console.log("[Lumina] register 시도:", { ...body, password: "***" });
  const data = await apiFetch("/api/v1/auth/register", {
    method: "POST",
    body,
    throwOnError: true
  });
  // 응답 구조: { user, tokens } 또는 호환 별칭
  const token = data?.accessToken || data?.tokens?.accessToken || data?.access_token;
  const refresh = data?.refreshToken || data?.tokens?.refreshToken;
  const user = data?.user;
  if (token) setAuth({ accessToken: token, refreshToken: refresh, user });
  // 가입 성공 시 저장된 추천인 코드 제거
  try { localStorage.removeItem("lumina_ref"); } catch {}
  return data;
}
async function authLogout() {
  try { await apiFetch("/api/v1/auth/logout", { method: "POST", auth: true }); } catch {}
  clearAuth();
  updateAuthUI();
  if (typeof initMypagePage === "function") initMypagePage();
}

/* ── 백엔드 응답에서 토큰 추출 (키 이름 자동 인식) ── */
function applyAuthResponse(data, providerName = "백엔드") {
  console.log(`[Lumina] ${providerName} 응답 받음:`, data);
  // 명세: { user, tokens: { accessToken, refreshToken } } + top-level 호환 별칭
  const accessToken = data?.accessToken || data?.tokens?.accessToken || data?.access_token || data?.token;
  const refreshToken = data?.refreshToken || data?.tokens?.refreshToken || data?.refresh_token;
  const user = data?.user || data?.profile || data?.account || data?.member;

  if (!accessToken) {
    console.error(`[Lumina] ${providerName} 응답에 토큰 없음:`, data);
    alert(`${providerName} 로그인 실패\n\n백엔드 응답:\n${JSON.stringify(data, null, 2)}\n\n→ 백엔드 응답 형식 확인 필요`);
    return false;
  }
  setAuth({ accessToken, refreshToken, user });
  closeAuthModal();
  updateAuthUI();
  if (typeof initMypagePage === "function") initMypagePage();
  loadWallet(); // 로그인/회원가입 직후 잔액 로드
  console.info(`[Lumina] ${providerName} 로그인 성공:`, user?.displayName || user?.email);
  return true;
}

/* ── 인증 모달 (로그인/회원가입) ─────────────── */
function createAuthModal() {
  if (document.getElementById("authModal")) return;
  const modal = document.createElement("div");
  modal.id = "authModal";
  modal.className = "auth-modal-overlay";
  modal.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true">
      <button class="auth-modal-close" aria-label="닫기">✕</button>
      <div class="auth-modal-tabs">
        <button class="auth-modal-tab is-active" data-tab="login" type="button">로그인</button>
        <button class="auth-modal-tab" data-tab="register" type="button">회원가입</button>
      </div>
      <form class="auth-modal-form" data-form="login" novalidate>
        <h2>다시 만나서 반가워요</h2>
        <p class="auth-modal-subtitle">Lumina Stage에 입장하세요</p>
        <div class="auth-modal-error" data-error hidden></div>
        <label class="auth-modal-field"><span>이메일</span>
          <input type="email" name="email" required autocomplete="email" placeholder="you@example.com" /></label>
        <label class="auth-modal-field"><span>비밀번호</span>
          <input type="password" name="password" required autocomplete="current-password" /></label>
        <button type="submit" class="auth-modal-submit">로그인</button>
      </form>
      <form class="auth-modal-form" data-form="register" novalidate hidden>
        <h2>Lumina Stage 가입</h2>
        <p class="auth-modal-subtitle">팬으로서 좋아요와 응원을 보내세요</p>
        <div class="auth-modal-error" data-error hidden></div>
        <label class="auth-modal-field"><span>이메일</span>
          <input type="email" name="email" required autocomplete="email" placeholder="you@example.com" /></label>
        <label class="auth-modal-field"><span>닉네임 <small style="color:rgba(255,255,255,0.4);font-weight:400;">(선택)</small></span>
          <input type="text" name="displayName" autocomplete="nickname" placeholder="비워두면 임시 이름이 자동 부여돼요" />
          <small style="color:rgba(255,255,255,0.45);font-size:11.5px;margin-top:4px;display:block;">이메일이나 실명은 공개 닉네임으로 사용하지 않아요. 마이페이지에서 언제든 바꿀 수 있어요.</small></label>
        <label class="auth-modal-field"><span>비밀번호 (8자 이상)</span>
          <input type="password" name="password" required minlength="8" autocomplete="new-password" /></label>
        <label class="auth-modal-field"><span>추천인 코드 <small style="color:rgba(255,255,255,0.4);font-weight:400;">(선택)</small></span>
          <input type="text" name="referralCode" autocomplete="off" placeholder="예: ABC12345" maxlength="20" /></label>
        <label class="auth-modal-consent">
          <input type="checkbox" name="termsConsent" required />
          <span>
            <a href="./terms.html" target="_blank" rel="noopener">이용약관</a>과
            <a href="./privacy.html" target="_blank" rel="noopener">개인정보처리방침</a>에 동의합니다.
          </span>
        </label>
        <button type="submit" class="auth-modal-submit">가입하기</button>
      </form>

      <!-- 공통 소셜 로그인 영역 (활성화된 provider 자동 표시) -->
      <div class="auth-modal-social-section" id="authSocialSection" hidden>
        <div class="auth-modal-divider"><span>또는</span></div>
        <div class="auth-modal-social" id="authSocialButtons"></div>
      </div>

      <!-- 탭별 푸터 -->
      <p class="auth-modal-foot" data-foot="login">처음이신가요?
        <button type="button" class="auth-modal-switch" data-switch="register">회원가입</button></p>
      <p class="auth-modal-foot" data-foot="register" hidden>이미 계정이 있으신가요?
        <button type="button" class="auth-modal-switch" data-switch="login">로그인</button></p>
    </div>`;
  document.body.appendChild(modal);
  bindAuthModalEvents(modal);
}

function bindAuthModalEvents(modal) {
  modal.querySelector(".auth-modal-close").addEventListener("click", closeAuthModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeAuthModal(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) closeAuthModal();
  });
  modal.querySelectorAll(".auth-modal-tab").forEach(t =>
    t.addEventListener("click", () => switchAuthTab(t.dataset.tab)));
  modal.querySelectorAll(".auth-modal-switch").forEach(b =>
    b.addEventListener("click", () => switchAuthTab(b.dataset.switch)));

  // 로그인 폼
  modal.querySelector('[data-form="login"]').addEventListener("submit", async e => {
    e.preventDefault();
    await handleAuthSubmit(e.currentTarget, "login");
  });
  // 회원가입 폼
  modal.querySelector('[data-form="register"]').addEventListener("submit", async e => {
    e.preventDefault();
    await handleAuthSubmit(e.currentTarget, "register");
  });
}

async function handleAuthSubmit(form, mode) {
  const errorEl = form.querySelector("[data-error]");
  const submitBtn = form.querySelector(".auth-modal-submit");
  const originalText = submitBtn.textContent;
  errorEl.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = mode === "login" ? "로그인 중..." : "가입 중...";
  try {
    if (mode === "login") {
      await authLogin(form.email.value.trim(), form.password.value);
    } else {
      if (!form.termsConsent?.checked) {
        throw new Error("이용약관과 개인정보처리방침에 동의해주세요.");
      }
      await authRegister(
        form.email.value.trim(),
        form.password.value,
        form.displayName.value.trim(),
        form.referralCode?.value.trim() || null
      );
      // #074 — 임시 표시명 안내 (회원가입 성공 직후, displayName 비워둔 경우 자동 생성됨)
      setTimeout(() => {
        try {
          const u = getAuth()?.user;
          const name = u?.displayName || u?.publicHandle || "";
          alert(`Lumina Stage에 오신 걸 환영해요.\n\n처음 시작하는 이름은 안전한 임시 표시명으로 준비해두었어요${name ? ` (${name})` : ""}. 마이페이지에서 원하는 닉네임으로 바꿀 수 있습니다.`);
        } catch {}
      }, 200);
    }
    closeAuthModal();
    updateAuthUI();
    if (typeof initMypagePage === "function") initMypagePage();
    form.reset();
  } catch (err) {
    // 백엔드 validation details 친절히 보여주기
    let msg = "";
    const details = err.body?.error?.details;
    if (Array.isArray(details) && details.length > 0) {
      msg = details.map(d => translateValidationError(d.field, d.messages?.[0] || "")).join("\n");
    } else {
      msg = err.message || (mode === "login" ? "로그인에 실패했습니다." : "가입에 실패했습니다.");
    }
    errorEl.textContent = msg;
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

/* 영문 검증 메시지 → 한국어 친절 메시지 변환 */
function translateValidationError(field, message) {
  const fieldKo = { email: "이메일", password: "비밀번호", displayName: "닉네임", name: "닉네임", nickname: "닉네임" }[field] || field;
  if (/must be an email/i.test(message))                  return `${fieldKo}: 올바른 이메일 형식이 아닙니다.`;
  if (/longer than or equal to (\d+)/i.test(message))     return `${fieldKo}: ${RegExp.$1}자 이상이어야 합니다.`;
  if (/shorter than or equal to (\d+)/i.test(message))    return `${fieldKo}: ${RegExp.$1}자 이하여야 합니다.`;
  if (/should not be empty/i.test(message))               return `${fieldKo}을(를) 입력해주세요.`;
  if (/must be a string/i.test(message))                  return `${fieldKo} 형식이 잘못되었습니다.`;
  if (/already.*exist|duplicate/i.test(message))          return `${fieldKo}: 이미 사용 중입니다.`;
  return `${fieldKo}: ${message}`;
}

function openAuthModal(tab = "login") {
  createAuthModal();
  const modal = document.getElementById("authModal");
  switchAuthTab(tab);
  modal.classList.add("is-open");
  document.body.style.overflow = "hidden";
  setTimeout(() => modal.querySelector(`[data-form="${tab}"] input[name="email"]`)?.focus(), 120);
  // 추천인 코드 자동 채움 (URL ?ref= 또는 저장된 값)
  const refInput = modal.querySelector('input[name="referralCode"]');
  if (refInput && !refInput.value) {
    const savedRef = getStoredReferralCode();
    if (savedRef) refInput.value = savedRef;
  }
  // 소셜 로그인 버튼 자동 로드 (활성화된 provider만)
  renderSocialButtons();
  // Google SDK 미리 로드 (클릭 시 더 빠른 반응)
  loadGoogleSDK().catch(() => { /* 클릭 시 다시 시도 */ });
}

/* ── 추천인 코드 — URL ?ref= 감지 + localStorage 보관 ── */
function captureReferralFromURL() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref") || params.get("referral") || params.get("invite");
    if (!ref) return;
    // 30일간 보관 (브라우저 닫아도 유지)
    localStorage.setItem("lumina_ref", JSON.stringify({
      code: ref,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    }));
    console.info("[Lumina] 추천인 코드 저장됨:", ref);
    // URL 깔끔하게 정리 (?ref= 제거)
    params.delete("ref");
    params.delete("referral");
    params.delete("invite");
    const newQuery = params.toString();
    history.replaceState({}, "", window.location.pathname + (newQuery ? "?" + newQuery : ""));
  } catch (e) {
    console.warn("[Lumina] 추천인 코드 저장 실패:", e);
  }
}
function getStoredReferralCode() {
  try {
    const raw = localStorage.getItem("lumina_ref");
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (Date.now() > stored.expiresAt) {
      localStorage.removeItem("lumina_ref");
      return null;
    }
    return stored.code;
  } catch { return null; }
}
function closeAuthModal() {
  const modal = document.getElementById("authModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  document.body.style.overflow = "";
}
function switchAuthTab(tab) {
  const modal = document.getElementById("authModal");
  if (!modal) return;
  modal.querySelectorAll(".auth-modal-tab").forEach(t => t.classList.toggle("is-active", t.dataset.tab === tab));
  modal.querySelectorAll(".auth-modal-form").forEach(f => f.hidden = f.dataset.form !== tab);
  modal.querySelectorAll("[data-foot]").forEach(f => f.hidden = f.dataset.foot !== tab);
  modal.querySelectorAll("[data-error]").forEach(e => e.hidden = true);
}

/* ── 소셜 로그인 (Google/Kakao/Naver/Apple) ── */
let _socialProvidersCache = null;

async function loadSocialProviders() {
  if (_socialProvidersCache !== null) return _socialProvidersCache;
  const data = await apiFetch("/api/v1/auth/social/providers");
  _socialProvidersCache = data?.providers?.filter(p => p.enabled) || [];
  return _socialProvidersCache;
}

function getProviderIcon(provider) {
  // 간단한 SVG 아이콘 (브랜드 로고)
  const icons = {
    google: '<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.56 2.69-3.86 2.69-6.61z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7c-.18-.54-.28-1.12-.28-1.7s.1-1.16.28-1.7V4.96H.96A8.997 8.997 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.34z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A8.997 8.997 0 0 0 .96 4.96l2.99 2.34C4.66 5.17 6.65 3.58 9 3.58z"/></svg>',
    kakao: '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#000" d="M9 1C4.58 1 1 3.85 1 7.36c0 2.27 1.49 4.26 3.74 5.39-.16.62-.6 2.27-.69 2.62-.11.43.16.43.34.31.14-.09 2.21-1.5 3.1-2.11.5.07 1.01.11 1.51.11 4.42 0 8-2.85 8-6.36S13.42 1 9 1z"/></svg>',
    naver: '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#fff" d="M11.46 9.16L6.4 1.5H1.5v15h5.04V8.84l5.06 7.66h4.9V1.5h-5.04v7.66z"/></svg>',
    apple: '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="currentColor" d="M14.41 9.55c-.02-2.13 1.74-3.16 1.82-3.21-1-1.46-2.55-1.66-3.1-1.68-1.32-.13-2.57.78-3.24.78-.67 0-1.7-.76-2.8-.74-1.44.02-2.77.84-3.51 2.13-1.5 2.6-.38 6.45 1.08 8.56.71 1.04 1.56 2.2 2.66 2.16 1.07-.04 1.47-.69 2.76-.69 1.29 0 1.65.69 2.78.66 1.15-.02 1.88-1.05 2.59-2.1.81-1.2 1.15-2.36 1.17-2.42-.03-.01-2.24-.86-2.21-3.45zM12.34 3.4c.59-.71.99-1.71.88-2.7-.85.03-1.88.57-2.49 1.28-.55.63-1.03 1.65-.9 2.61.95.07 1.92-.48 2.51-1.19z"/></svg>'
  };
  return icons[provider] || '';
}

async function renderSocialButtons() {
  const providers = await loadSocialProviders();
  const section = document.getElementById("authSocialSection");
  const container = document.getElementById("authSocialButtons");
  if (!section || !container) return;

  if (!providers || providers.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  container.innerHTML = providers.map(p => `
    <button type="button" class="auth-social-btn auth-social-${p.provider}" data-provider="${p.provider}">
      <span class="auth-social-icon">${getProviderIcon(p.provider)}</span>
      <span>${p.displayName}로 계속하기</span>
    </button>
  `).join("");

  container.querySelectorAll(".auth-social-btn").forEach(btn => {
    btn.addEventListener("click", () => handleSocialLogin(btn.dataset.provider));
  });
}

async function handleSocialLogin(provider) {
  if (provider === "google") {
    try {
      await loadGoogleSDK();
      if (!initGoogleAuth()) throw new Error("Google SDK 초기화 실패");
      _googleTokenClient.requestAccessToken();
    } catch (err) {
      console.error("[Lumina] Google 로그인 오류:", err);
      alert("Google 로그인 준비 실패: " + (err.message || "알 수 없는 오류"));
    }
    return;
  }
  if (provider === "kakao") {
    return handleKakaoLogin();
  }
  if (provider === "naver") {
    return handleNaverLogin();
  }
  if (provider === "apple") {
    return handleAppleLogin();
  }
  alert(`${provider} 로그인은 곧 추가됩니다!`);
}

/* ── 카카오 로그인 (SDK 골격) ─────────────────
   사용자가 Kakao Developers에서 JavaScript 키 받아서
   KAKAO_JS_KEY 변수에 등록하면 동작
   ─────────────────────────────────────────── */
const KAKAO_JS_KEY = "7445cbd55651240559e79f5fbc81983d"; // Kakao Developers JavaScript 키
let _kakaoSdkPromise = null;

function loadKakaoSDK() {
  if (window.Kakao?.isInitialized?.()) return Promise.resolve();
  if (_kakaoSdkPromise) return _kakaoSdkPromise;
  _kakaoSdkPromise = new Promise((resolve, reject) => {
    if (document.getElementById("kakaoSdk")) {
      const wait = setInterval(() => {
        if (window.Kakao) { clearInterval(wait); initKakaoSDK(); resolve(); }
      }, 100);
      return;
    }
    const script = document.createElement("script");
    script.id = "kakaoSdk";
    script.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";
    script.async = true;
    script.onload = () => { initKakaoSDK(); resolve(); };
    script.onerror = () => reject(new Error("Kakao SDK 로드 실패"));
    document.head.appendChild(script);
  });
  return _kakaoSdkPromise;
}
function initKakaoSDK() {
  if (!window.Kakao) return;
  if (!KAKAO_JS_KEY) {
    console.warn("[Lumina] KAKAO_JS_KEY 미설정 — app.js에서 등록 필요");
    return;
  }
  if (!Kakao.isInitialized()) Kakao.init(KAKAO_JS_KEY);
}

async function handleKakaoLogin() {
  if (!KAKAO_JS_KEY) {
    alert("카카오 로그인은 곧 열릴 예정입니다.\n지금은 이메일로 먼저 입장해주세요.");
    return;
  }
  try {
    await loadKakaoSDK();
    console.info("[Lumina] Kakao SDK 로드 완료, isInitialized:", window.Kakao?.isInitialized?.());
    if (!window.Kakao?.Auth) {
      throw new Error("Kakao SDK가 정상 초기화되지 않았습니다.");
    }
    // Redirect URI는 카카오 등록과 정확히 일치해야 함 (trailing slash까지!)
    const redirectUri = window.location.origin;
    sessionStorage.setItem("oauth_provider", "kakao");
    console.info("[Lumina] Kakao authorize 호출:", { redirectUri });
    Kakao.Auth.authorize({
      redirectUri,
      scope: "profile_nickname",  // 비즈 앱 미전환 상태 — 이메일 scope 제외
      throughTalk: false  // 카카오톡 앱 우회 — 데스크톱에서 intent:// 스킴 fail 방지
    });
    // authorize는 페이지를 이동시킴. 1초 후에도 여기 있으면 redirect 실패 의심
    setTimeout(() => {
      console.warn("[Lumina] Kakao authorize 호출 후 1초 — 페이지 이동 안 함. redirect_uri 또는 도메인 등록 확인 필요");
    }, 1000);
  } catch (err) {
    console.error("[Lumina] 카카오 로그인 오류:", err);
    alert("카카오 로그인 준비 실패: " + (err.message || "SDK 로드 실패"));
  }
}

/* ── 카카오 OAuth 콜백 처리 (redirect 후) ──
   URL에 ?code=xxx 가 있으면 백엔드로 전달 → 우리 토큰 받음
   ────────────────────────────────────── */
async function handleKakaoCallback() {
  // 카카오 콜백인지 확인
  if (sessionStorage.getItem("oauth_provider") !== "kakao") return;

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const error = params.get("error");

  if (!code && !error) return;

  sessionStorage.removeItem("oauth_provider");
  history.replaceState({}, "", window.location.pathname);

  if (error) {
    console.warn("[Lumina] Kakao 로그인 취소/실패:", error);
    return;
  }

  try {
    console.log("[Lumina] Kakao code 받음, 백엔드 호출 중...");
    // 백엔드에 code 전달 — 백엔드가 카카오와 토큰 교환 + 우리 토큰 발급
    const data = await apiFetch("/api/v1/auth/social/login", {
      method: "POST",
      body: {
        provider: "kakao",
        code,
        redirectUri: window.location.origin
      },
      throwOnError: true
    });
    applyAuthResponse(data, "Kakao");
  } catch (err) {
    console.error("[Lumina] Kakao 백엔드 로그인 실패:", err, err.body);
    alert("Kakao 로그인 실패\n에러: " + (err.message || "서버 오류") + (err.body ? "\n응답: " + JSON.stringify(err.body) : ""));
  }
}

/* ── 네이버 로그인 (redirect 방식) ─────────────
   카카오와 동일한 패턴 — 페이지가 네이버로 이동 → 인증 → 다시 사이트로 ?code=...
   사용자가 Naver Developers에서 Client ID 받아 등록 필요
   ─────────────────────────────────────────── */
const NAVER_CLIENT_ID = "WEXZ2Cn3Ff8pIEdTkDfR"; // Naver Developers Client ID

async function handleNaverLogin() {
  if (!NAVER_CLIENT_ID) {
    alert("네이버 로그인은 곧 열릴 예정입니다.\n지금은 이메일로 먼저 입장해주세요.");
    return;
  }
  // CSRF 방지용 state 토큰
  const state = Math.random().toString(36).substring(2, 15);
  sessionStorage.setItem("naver_oauth_state", state);
  sessionStorage.setItem("oauth_provider", "naver");

  const redirectUri = encodeURIComponent(window.location.origin);
  // 🔑 Implicit flow (response_type=token) — 백엔드 명세 권장 (token handoff 우선)
  const url = `https://nid.naver.com/oauth2.0/authorize?response_type=token&client_id=${NAVER_CLIENT_ID}&redirect_uri=${redirectUri}&state=${state}`;
  console.info("[Lumina] Naver authorize 호출:", { redirectUri: window.location.origin });
  window.location.href = url;
}

/* ── 네이버 OAuth 콜백 처리 (implicit flow → URL hash) ── */
async function handleNaverCallback() {
  if (sessionStorage.getItem("oauth_provider") !== "naver") return;

  // implicit flow는 hash로 옴 (#access_token=...&state=...&token_type=bearer)
  const hash = window.location.hash.substring(1);
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const state = params.get("state");
  const error = params.get("error");

  // 마커 + URL 정리
  const savedState = sessionStorage.getItem("naver_oauth_state");
  sessionStorage.removeItem("naver_oauth_state");
  sessionStorage.removeItem("oauth_provider");
  history.replaceState({}, "", window.location.pathname);

  if (error) {
    console.warn("[Lumina] Naver 로그인 취소/실패:", error, params.get("error_description"));
    return;
  }
  if (savedState && state !== savedState) {
    console.error("[Lumina] Naver state 불일치 — CSRF 의심");
    alert("네이버 로그인 보안 검증 실패");
    return;
  }
  if (!accessToken) {
    console.warn("[Lumina] Naver hash에서 access_token 못 찾음");
    return;
  }

  try {
    console.log("[Lumina] Naver access_token 받음, 백엔드 호출 중...");
    // 백엔드 명세: token handoff — { provider, token }
    const data = await apiFetch("/api/v1/auth/social/login", {
      method: "POST",
      body: {
        provider: "naver",
        token: accessToken
      },
      throwOnError: true
    });
    applyAuthResponse(data, "Naver");
  } catch (err) {
    console.error("[Lumina] Naver 백엔드 로그인 실패:", err, err.body);
    alert("네이버 로그인 실패\n에러: " + (err.message || "서버 오류") + (err.body ? "\n응답: " + JSON.stringify(err.body) : ""));
  }
}

/* ── 애플 로그인 (placeholder) ──────────────── */
async function handleAppleLogin() {
  alert("애플 로그인은 Apple Developer 설정 후 추가됩니다.\n(현재 한국에서는 카카오/네이버가 더 일반적)");
}

/* ── Google OAuth 통합 ─────────────────────────
   GIS SDK + access_token popup 흐름
   ─────────────────────────────────────────── */
const GOOGLE_CLIENT_ID = "213795475154-votjkhv4cvgg49cvajast3clenhoj5db.apps.googleusercontent.com";
let _googleSdkPromise = null;
let _googleTokenClient = null;

function loadGoogleSDK() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (_googleSdkPromise) return _googleSdkPromise;

  _googleSdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("googleGsiSdk");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google SDK 로드 실패")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "googleGsiSdk";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google SDK 로드 실패 (네트워크 또는 차단)"));
    document.head.appendChild(script);
  });
  return _googleSdkPromise;
}

function initGoogleAuth() {
  if (_googleTokenClient) return true;
  if (!window.google?.accounts?.oauth2) return false;

  _googleTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: "openid email profile",
    callback: handleGoogleTokenResponse,
    error_callback: (err) => {
      console.error("[Lumina] Google OAuth 에러:", err);
      // 사용자가 popup 닫음 등은 조용히 무시
      if (err.type === "popup_closed" || err.type === "popup_failed_to_open") return;
      alert("Google 로그인 취소됨: " + (err.message || err.type));
    }
  });
  return true;
}

async function handleGoogleTokenResponse(tokenResponse) {
  console.log("[Lumina] Google access_token 받음, 백엔드 호출 중...");
  if (!tokenResponse?.access_token) {
    console.error("[Lumina] Google access_token 누락");
    return;
  }
  try {
    const data = await apiFetch("/api/v1/auth/social/login", {
      method: "POST",
      body: {
        provider: "google",
        token: tokenResponse.access_token
      },
      throwOnError: true
    });
    applyAuthResponse(data, "Google");
  } catch (err) {
    console.error("[Lumina] Google 백엔드 로그인 실패:", err, err.body);
    alert("Google 로그인 실패\n에러: " + (err.message || "서버 오류") + (err.body ? "\n응답: " + JSON.stringify(err.body) : ""));
  }
}

/* ── 좋아요/부스트 상태 ─────────────────────────
   현재 캠페인 + 캐릭터별 좋아요 카운트 + 사용자 좋아요 이력
   ─────────────────────────────────────────── */
let _currentCampaign = null;
let _rankings = []; // [{ slug, likes }]
let _userLikedSlugs = new Set(); // 이번 세션에 좋아요 누른 슬러그

async function loadBoostState() {
  const campaign = await apiFetch("/api/v1/boost-campaigns/current");
  if (!campaign?.id) {
    console.info("[Lumina] 진행 중인 부스트 캠페인 없음");
    return;
  }
  _currentCampaign = campaign;
  console.info(`[Lumina] 현재 캠페인: ${campaign.name || campaign.id}`);

  const rankingsData = await apiFetch(`/api/v1/boost-campaigns/${campaign.id}/rankings`);
  if (rankingsData) {
    const list = Array.isArray(rankingsData) ? rankingsData : (rankingsData.rankings || rankingsData.items || []);
    _rankings = list.map(r => ({
      slug: r.artistSlug || r.slug || r.artist?.slug || "",
      likes: r.totalLikes ?? r.likes ?? r.count ?? r.score ?? 0
    })).filter(r => r.slug);
  }
}

/* ── 지갑 / 루미나 잔액 ───────────────────────
   GET /api/v1/wallet — cachedBalance 사용
   백엔드 명세: 가입 직후 300 L, 추천인 코드 유효 시 +500 L
   ─────────────────────────────────────────── */
let _wallet = null; // { balance: number, currencyCode: "LUMINA", loaded: bool }

async function loadWallet() {
  if (!isLoggedIn()) {
    _wallet = null;
    updateWalletUI();
    return;
  }
  try {
    const data = await apiFetch("/api/v1/wallet", { auth: true, throwOnError: true });
    // 응답 필드 fallback 체인 강화 — 백엔드 응답 키가 cachedBalance / balance / lumina.balance 중 어느 것이든 처리
    const rawBalance = data?.cachedBalance ?? data?.balance ?? data?.lumina?.balance ?? data?.wallet?.cachedBalance ?? "0";
    _wallet = {
      balance: parseFloat(rawBalance) || 0,
      currencyCode: data?.currencyCode || "LUMINA",
      loaded: true
    };
  } catch (err) {
    console.warn("[Lumina] 지갑 조회 실패 — 잔액 0으로 표시:", err);
    // 사용자 의도: "곧 공개" 보다 "0 L" 표시가 더 명확. loaded: true로 두고 0 표시.
    _wallet = { balance: 0, currencyCode: "LUMINA", loaded: true };
  }
  updateWalletUI();
}

function formatLuminaAmount(n) {
  // 정수면 정수로, 소수점 있으면 소수점 둘째 자리 (백엔드는 "300.00" 같은 문자열로 옴)
  if (!isFinite(n)) return "0";
  if (Number.isInteger(n)) return n.toLocaleString("ko-KR");
  return n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function updateWalletUI() {
  // 1. 헤더 잔액 뱃지 (헤더 닉네임 좌측)
  const headerBadge = document.getElementById("walletBadge");
  if (headerBadge) {
    if (_wallet?.loaded) {
      headerBadge.innerHTML = `
        <svg class="wallet-coin" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <!-- 5각 별 (Lumina Stage 스텔라 시스템 로고) -->
          <path d="M12 2 L14.5 9 L22 9 L16 14 L18 21 L12 17 L6 21 L8 14 L2 9 L9.5 9 Z"
                fill="currentColor" opacity="0.18"/>
          <path d="M12 2 L14.5 9 L22 9 L16 14 L18 21 L12 17 L6 21 L8 14 L2 9 L9.5 9 Z"
                fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <!-- S (Stella) -->
          <text x="12" y="15.5" text-anchor="middle" font-size="9" font-weight="900"
                fill="currentColor" font-family="Georgia, serif">S</text>
        </svg>
        <span class="wallet-sep">/</span>
        <span>${formatLuminaAmount(_wallet.balance)} L</span>`;
      headerBadge.style.display = "";
    } else {
      headerBadge.style.display = "none";
    }
  }
  // 헤더 뱃지에만 잔액 표시 (드롭다운에서는 중복 제거 — 사용자 결정 2026-05-03)
}

function getLikesCount(slug) {
  const rank = _rankings.find(r => r.slug === slug);
  return rank?.likes || 0;
}

function formatLikeCount(n) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(".0", "") + "만";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(".0", "") + "천";
  return String(n);
}

function likeButtonHTML(slug, extraClass = "") {
  const count = getLikesCount(slug);
  const liked = _userLikedSlugs.has(slug) ? " is-liked" : "";
  const cls = extraClass ? ` ${extraClass}` : "";
  // 카탈로그에서는 클릭 시 루미나 픽으로 이동 — 호버 시 안내 (루미나 픽 페이지에서는 무관)
  const tooltip = "루미나 픽에서 응원하기";
  return `
    <button class="like-btn${cls}${liked}" data-like-slug="${slug}" type="button" aria-label="좋아요" title="${tooltip}">
      <svg class="like-heart" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 21s-7.5-4.5-9.5-9.5C1 8.5 3.5 5.5 7 5.5c2 0 3.5 1 5 2.5 1.5-1.5 3-2.5 5-2.5 3.5 0 6 3 4.5 6-2 5-9.5 9.5-9.5 9.5z"/>
      </svg>
      <span class="like-count">${formatLikeCount(count)}</span>
    </button>`;
}

async function handleLike(slug, btnEl) {
  if (!_currentCampaign?.id) {
    alert("현재 진행 중인 좋아요 캠페인이 없습니다.");
    return;
  }
  if (!isLoggedIn()) {
    openAuthModal("login");
    return;
  }
  if (_userLikedSlugs.has(slug)) return; // 이미 누름

  if (btnEl) btnEl.disabled = true;

  try {
    // 백엔드는 artistId를 요구함 (명세 페이지에 정확한 형식 명시 안 됨).
    // _artists에서 slug로 찾아 id가 있으면 그걸 사용, 없으면 slug fallback.
    // artistSlug도 함께 보내서 백엔드가 어느 필드를 받든 동작하도록 안전망 둠.
    const artist = _artists.find(a => a.slug === slug);
    const artistIdValue = artist?.id || slug;

    await apiFetch(`/api/v1/boost-campaigns/${_currentCampaign.id}/free-like`, {
      method: "POST",
      body: { artistId: artistIdValue, artistSlug: slug },
      auth: true,
      throwOnError: true
    });
    // 성공: 클라이언트 상태 즉시 업데이트 (낙관적 갱신)
    _userLikedSlugs.add(slug);
    const rank = _rankings.find(r => r.slug === slug);
    if (rank) rank.likes += 1;
    else _rankings.push({ slug, likes: 1 });
    updateLikeButtons(slug);
    // Q1 답변 권장: 좋아요 성공 후 rankings 재호출로 정확한 순위/점수 갱신
    // (실패해도 낙관적 갱신은 유지 — 사용자 경험 영향 없음)
    apiFetch(`/api/v1/boost-campaigns/${_currentCampaign.id}/rankings`)
      .then(rankingsData => {
        if (rankingsData) {
          const list = Array.isArray(rankingsData) ? rankingsData : (rankingsData?.rankings || rankingsData?.items || []);
          if (Array.isArray(list) && list.length > 0) {
            _rankings = list.map(r => ({
              slug: r.artistSlug || r.slug || r.artist?.slug || "",
              likes: r.totalFreeLikes ?? r.totalWeightedScore ?? r.totalLikes ?? r.likes ?? r.score ?? 0
            })).filter(r => r.slug);
            updateLikeButtons(slug);
          }
        }
      })
      .catch(err => console.warn("[Lumina] 랭킹 재로드 실패 (낙관적 갱신 유지):", err));

    // 좋아요 후 무료 한도 잔여 갱신 (루미나 픽 hero 패널 업데이트)
    loadFreeLikeQuota().then(updateHeroQuotaDisplay);
  } catch (err) {
    console.error("[Lumina] 좋아요 실패:", err);
    // Q1 답변 기준 에러 코드 분기:
    // - 일일 한도: 400 + message="Daily free like limit exceeded"
    // - active artist 없음: 400 + message="Active artist not found"
    // - active campaign 없음: 404 + message="Active boost campaign not found"
    // - 인증 실패: 401
    const msg = err.body?.message || err.message || "";
    const isDailyLimit = err.status === 400 && /daily free like limit/i.test(msg);
    if (isDailyLimit) {
      openPaidLikeModal(slug);
    } else if (err.status === 401) {
      clearAuth();
      updateAuthUI();
      openAuthModal("login");
    } else if (err.status === 404 && /active boost campaign not found/i.test(msg)) {
      alert("진행 중인 좋아요 캠페인이 없어요.\n잠시 후 다시 시도해주세요.");
    } else if (err.status === 400 && /active artist not found/i.test(msg)) {
      alert("아티스트 정보를 찾을 수 없어요.\n페이지를 새로고침 후 다시 시도해주세요.");
    } else {
      alert("좋아요 실패: " + (msg || "잠시 후 다시 시도해주세요"));
    }
    if (btnEl) btnEl.disabled = false;
  }
}

const PAID_LIKE_BUNDLES = [
  { quantity: 1, lumina: 10, krw: 100, label: "1개 · 10L (100원)" },
  { quantity: 5, lumina: 50, krw: 500, label: "5개 · 50L (500원)" },
  { quantity: 10, lumina: 90, krw: 900, label: "10개 · 90L (900원)", recommended: true },
  { quantity: 20, lumina: 200, krw: 2000, label: "20개 · 200L (2,000원)" }
];
// MVP 정책 (#047): 유료 좋아요 하루 최대 20개. 30개 옵션은 MVP 미사용.

function getPaidLikeBalance() {
  return _wallet?.balance ?? _wallet?.lumina?.balance ?? _wallet?.cachedBalance ?? 0;
}

/* 유료 좋아요 잔여 한도 조회 (#047 — 차모 백엔드 35e62ec).
   응답: { dailyLimit: 20, usedToday: 0, remaining: 20, resetsAt, unitPriceLumina: 10 } */
async function loadPaidLikeQuota() {
  if (!isLoggedIn()) return null;
  try {
    const data = await apiFetch("/api/v1/me/paid-like-quota");
    return data || null;
  } catch (err) {
    console.warn("[Lumina] /me/paid-like-quota 실패:", err);
    return null;
  }
}

async function openPaidLikeModal(slug) {
  if (!_currentCampaign?.id) {
    alert("현재 진행 중인 좋아요 캠페인이 없습니다.");
    return;
  }
  if (!isLoggedIn()) {
    openAuthModal("login");
    return;
  }
  const artist = getCharacterBySlug(slug) || _artists.find(a => a.slug === slug);
  const balance = getPaidLikeBalance();

  // #047: 일일 잔여 한도 조회 (실패해도 모달 열 수 있게 fallback)
  const quota = await loadPaidLikeQuota();
  const dailyLimit = quota?.dailyLimit ?? 20;
  const remaining = quota?.remaining ?? dailyLimit;

  // 잔여 0이면 모달 안 띄우고 안내
  if (remaining <= 0) {
    alert(`오늘 보낼 수 있는 추가 응원을 모두 사용했어요. (하루 최대 ${dailyLimit}개)\n내일 다시 응원할 수 있어요.`);
    return;
  }

  // remaining 초과 옵션은 비활성화 표시
  const overlay = document.createElement("div");
  overlay.className = "paid-like-modal-overlay is-open";
  overlay.innerHTML = `
    <div class="paid-like-modal" role="dialog" aria-modal="true" aria-labelledby="paidLikeModalTitle">
      <button class="paid-like-close" type="button" aria-label="닫기">×</button>
      <div class="paid-like-head">
        <span class="eyebrow">Paid Cheer</span>
        <h2 id="paidLikeModalTitle">좋아요 추가 응원</h2>
        <p>${artist?.publicName || "아티스트"}에게 루미나로 좋아요를 더 전달해요.</p>
      </div>
      <div class="paid-like-balance">
        <span>현재 보유 루미나</span>
        <strong>${formatLuminaAmount(balance)}L</strong>
      </div>
      <div class="paid-like-quota-notice">
        오늘 보낼 수 있는 추가 응원 <strong>${remaining}개</strong> · 하루 최대 ${dailyLimit}개
      </div>
      <div class="paid-like-options">
        ${PAID_LIKE_BUNDLES.map((bundle) => {
          const overLimit = bundle.quantity > remaining;
          // 기본 선택은 remaining 이내에서 가장 큰 번들 (또는 1개)
          const isSelected = !overLimit && bundle.quantity === Math.min(remaining, bundle.recommended ? bundle.quantity : 1) && bundle.recommended;
          return `
          <label class="paid-like-option${overLimit ? " is-disabled" : ""}${isSelected ? " is-selected" : ""}">
            <input type="radio" name="paidLikeBundle" value="${bundle.quantity}" ${isSelected ? "checked" : ""} ${overLimit ? "disabled" : ""} />
            <span>
              <strong>${bundle.label}</strong>
              <small>${overLimit ? `오늘 잔여 한도 초과` : (bundle.recommended ? "추천 번들" : "추가 응원 번들")}</small>
            </span>
          </label>
        `;}).join("")}
      </div>
      <p class="paid-like-message" data-paid-like-message hidden></p>
      <div class="paid-like-actions">
        <button class="button-primary" type="button" data-paid-like-confirm>응원하기</button>
        <button class="button-secondary" type="button" data-paid-like-cancel>취소</button>
      </div>
    </div>
  `;

  // 기본 선택 — 위 로직으로 추천 번들이 한도 초과면 가장 큰 가능한 번들로
  const ensureSelection = () => {
    const checked = overlay.querySelector("[name='paidLikeBundle']:checked");
    if (checked) return;
    // 첫 번째 not-disabled 라디오 선택
    const firstOk = overlay.querySelector("[name='paidLikeBundle']:not([disabled])");
    if (firstOk) {
      firstOk.checked = true;
      firstOk.closest(".paid-like-option")?.classList.add("is-selected");
    }
  };

  const close = () => {
    overlay.remove();
    document.body.style.overflow = "";
  };
  const setMessage = text => {
    const el = overlay.querySelector("[data-paid-like-message]");
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
  };

  overlay.addEventListener("click", event => {
    if (event.target === overlay || event.target.closest(".paid-like-close") || event.target.closest("[data-paid-like-cancel]")) close();
    const option = event.target.closest(".paid-like-option");
    if (option && !option.classList.contains("is-disabled")) {
      overlay.querySelectorAll(".paid-like-option").forEach(item => item.classList.toggle("is-selected", item === option));
    }
  });

  overlay.querySelector("[data-paid-like-confirm]")?.addEventListener("click", async () => {
    const selectedQuantity = Number(overlay.querySelector("[name='paidLikeBundle']:checked")?.value || 1);
    const selectedBundle = PAID_LIKE_BUNDLES.find(bundle => bundle.quantity === selectedQuantity) || PAID_LIKE_BUNDLES[0];
    const currentBalance = getPaidLikeBalance();
    if (currentBalance < selectedBundle.lumina) {
      setMessage(`루미나가 부족해요. 좋아요 ${selectedBundle.quantity}개를 전달하려면 ${selectedBundle.lumina}L이 필요해요.`);
      return;
    }
    if (selectedBundle.quantity > remaining) {
      setMessage(`오늘 보낼 수 있는 추가 응원: ${remaining}개. 더 작은 번들을 선택해주세요.`);
      return;
    }

    const button = overlay.querySelector("[data-paid-like-confirm]");
    button.disabled = true;
    button.textContent = "전달 중";
    try {
      await apiFetch(`/api/v1/boost-campaigns/${_currentCampaign.id}/paid-like`, {
        method: "POST",
        auth: true,
        throwOnError: true,
        body: {
          artistId: artist?.id || slug,
          artistSlug: slug,
          quantity: selectedBundle.quantity
        }
      });
      const rank = _rankings.find(r => r.slug === slug);
      if (rank) rank.likes += selectedBundle.quantity;
      else _rankings.push({ slug, likes: selectedBundle.quantity });
      if (_wallet?.loaded) _wallet.balance = Math.max(0, Number(_wallet.balance || 0) - selectedBundle.lumina);
      updateLikeButtons(slug);
      loadWallet?.();
      // #047: 좋아요 후 free quota + paid quota 둘 다 재조회 (랭킹은 그 안에서)
      loadFreeLikeQuota().then(updateHeroQuotaDisplay);
      loadPaidLikeQuota();
      alert(`좋아요 ${selectedBundle.quantity}개가 전달되었어요.`);
      close();
    } catch (err) {
      const msg = err.body?.message || err.message || "";
      // #047: 한도 초과 응답 사용자 문구로 변환
      if (/Daily paid like limit exceeded/i.test(msg)) {
        setMessage(`오늘 보낼 수 있는 추가 응원을 모두 사용했어요. 하루 최대 ${dailyLimit}개까지 응원할 수 있어요.`);
      } else if (/insufficient.*balance/i.test(msg)) {
        setMessage("루미나 잔액이 부족해요. 충전 후 다시 시도해주세요.");
      } else {
        setMessage(msg || "응원을 전달하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
      button.disabled = false;
      button.textContent = "응원하기";
    }
  });

  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  ensureSelection();
}

function updateLikeButtons(slug) {
  document.querySelectorAll(`[data-like-slug="${slug}"]`).forEach(btn => {
    const liked = _userLikedSlugs.has(slug);
    btn.classList.toggle("is-liked", liked);
    btn.disabled = liked;
    const countEl = btn.querySelector(".like-count");
    if (countEl) countEl.textContent = formatLikeCount(getLikesCount(slug));
  });
}

function bindLikeButtons() {
  // 이벤트 위임 (한 번만 등록)
  if (document._likeBound) return;
  document._likeBound = true;
  document.addEventListener("click", e => {
    const btn = e.target.closest(".like-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const slug = btn.dataset.likeSlug;

    // 카탈로그(characters.html)에서는 좋아요 대신 루미나 픽으로 이동
    // → 진짜 투표는 루미나 픽에서. 카드의 좋아요 버튼은 entry point 역할.
    // 루미나 픽(popular-vote.html) 자체에서는 기존 좋아요 동작 유지.
    const path = window.location.pathname;
    const isOnVoteRoom = path.includes("popular-vote.html");
    if (!isOnVoteRoom) {
      window.location.href = `./popular-vote.html?artist=${encodeURIComponent(slug)}&tab=debut-race`;
      return;
    }
    handleLike(slug, btn);
  });
}

/* ── 헤더 UI 동기화 + 사용자 메뉴 드롭다운 ─── */
function updateAuthUI() {
  const auth = getAuth();
  const loginBtn = document.querySelector(".auth-btn-login");
  const signupBtn = document.querySelector(".auth-btn-signup");
  if (!loginBtn || !signupBtn) return;
  if (auth?.user) {
    loginBtn.textContent = auth.user.displayName || auth.user.email?.split("@")[0] || "내 계정";
    loginBtn.dataset.action = "menu";
    signupBtn.textContent = "로그아웃";
    signupBtn.dataset.action = "logout";
    // 잔액 뱃지 영역 추가 (없으면 생성, 있으면 그대로)
    ensureWalletBadgeInHeader(loginBtn);
  } else {
    loginBtn.textContent = "로그인";
    loginBtn.dataset.action = "login";
    signupBtn.textContent = "회원가입";
    signupBtn.dataset.action = "signup";
    // 비로그인 시 뱃지 제거
    document.getElementById("walletBadge")?.remove();
  }
  // 드롭다운 닫기 (UI 갱신 시)
  closeUserMenu();
  // #056: 피드 페이지에서 로그인 상태 변화 시 작성창 동기화
  if (typeof initFeedCompose === "function" && document.getElementById("feedCompose")) {
    initFeedCompose();
  }
  // #057: 충전소 페이지에서 로그인 상태 변화 시 게이트 토글
  if (typeof initChargePage === "function" && (document.getElementById("chargePageContent") || document.getElementById("chargeLoginGate"))) {
    initChargePage();
  }
}

function ensureWalletBadgeInHeader(loginBtn) {
  // 사용자 결정 2026-05-03 (모바일 헤더 재배치):
  //   데스크톱(>768px): 기존 그대로 ".header-auth" 안 닉네임 앞 → "잔액 | 닉네임 | 로그아웃" 한 줄
  //   모바일(≤768px): ".header-inner"의 ".debut-cta-mobile" 형제로 이동 →
  //                    1줄 [로고][닉네임][로그아웃] / 2줄 [데뷔하기][잔액]
  // grid 배치는 styles.css 모바일 미디어쿼리에서 grid-area=wallet으로 처리.
  const headerInner = loginBtn.closest(".header-inner");
  const headerAuth = loginBtn.closest(".header-auth");
  if (!headerInner || !headerAuth) return;

  let badge = document.getElementById("walletBadge");
  if (!badge) {
    badge = document.createElement("button");
    badge.id = "walletBadge";
    badge.className = "wallet-badge";
    badge.type = "button";
    badge.title = "루미나 잔액";
    badge.style.display = "none"; // 데이터 로드되면 보임
    badge.addEventListener("click", e => {
      e.preventDefault();
      toggleUserMenu(loginBtn);
    });
  }

  placeWalletBadgeForViewport(badge, headerInner, headerAuth, loginBtn);
}

function placeWalletBadgeForViewport(badge, headerInner, headerAuth, loginBtn) {
  if (!badge) return;
  const isMobile = (typeof window.matchMedia === "function")
    ? window.matchMedia("(max-width: 768px)").matches
    : window.innerWidth <= 768;

  if (isMobile) {
    // 모바일: .header-inner 직접 자식, 데뷔하기 다음 형제 (없으면 끝에 append)
    const debutCta = headerInner.querySelector(".debut-cta-mobile");
    const target = debutCta || null;
    if (target) {
      if (badge.previousElementSibling !== target || badge.parentElement !== headerInner) {
        target.insertAdjacentElement("afterend", badge);
      }
    } else if (badge.parentElement !== headerInner) {
      headerInner.appendChild(badge);
    }
  } else {
    // 데스크톱: 기존 동작 그대로 — .header-auth 안 닉네임 앞
    if (badge.parentElement !== headerAuth || badge.nextElementSibling !== loginBtn) {
      headerAuth.insertBefore(badge, loginBtn);
    }
  }
}

// 화면 크기 변경(회전/리사이즈) 시 walletBadge 위치 재정렬
(function setupWalletBadgeViewportSync() {
  if (typeof window === "undefined" || window.__walletBadgeResizeBound) return;
  window.__walletBadgeResizeBound = true;
  let rafId = null;
  window.addEventListener("resize", () => {
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      const badge = document.getElementById("walletBadge");
      if (!badge) return;
      const loginBtn = document.querySelector(".auth-btn-login");
      if (!loginBtn) return;
      const headerInner = loginBtn.closest(".header-inner");
      const headerAuth = loginBtn.closest(".header-auth");
      if (!headerInner || !headerAuth) return;
      placeWalletBadgeForViewport(badge, headerInner, headerAuth, loginBtn);
    });
  });
})();

function bindAuthHeaderEvents() {
  const loginBtn = document.querySelector(".auth-btn-login");
  const signupBtn = document.querySelector(".auth-btn-signup");
  if (!loginBtn || !signupBtn) return;
  loginBtn.addEventListener("click", e => {
    e.preventDefault();
    if (isLoggedIn()) {
      toggleUserMenu(loginBtn);
    } else {
      openAuthModal("login");
    }
  });
  signupBtn.addEventListener("click", e => {
    e.preventDefault();
    if (signupBtn.dataset.action === "logout") {
      authLogout();
    } else {
      openAuthModal("register");
    }
  });
  // 외부 클릭 시 드롭다운 닫기
  document.addEventListener("click", e => {
    if (!e.target.closest(".user-menu") && !e.target.closest(".auth-btn-login")) {
      closeUserMenu();
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeUserMenu();
  });
}

/* ── 현재 페이지에 해당하는 메뉴 항목에 is-active 자동 부여 ──
   각 HTML 파일에 일일이 class="is-active"를 박지 않고 JS가 자동 감지.
   2026-05-02: 모바일 가로 스크롤(메뉴 6개)에서 활성 항목 자동 scrollIntoView 추가.
   2026-05-02 후속(#017): 하단 탭바도 동기 처리. */
function activateCurrentNavItem() {
  const path = window.location.pathname;
  // 마지막 /를 기준으로 파일명 추출. "/" 또는 "" 인 경우 index.html로 간주.
  const filename = (path.split("/").pop() || "index.html").toLowerCase();
  let activeLink = null;

  // 상단 nav (데스크톱 + 769px 이상)
  document.querySelectorAll(".main-nav a").forEach(link => {
    const href = (link.getAttribute("href") || "").toLowerCase();
    const linkFile = href.split("/").pop();
    if (linkFile === filename) {
      link.classList.add("is-active");
      activeLink = link;
    } else {
      link.classList.remove("is-active");
    }
  });
  // 모바일 가로 스크롤(640px↓)에서 활성 항목 자동 가운데 — main-nav가 보일 때만 의미.
  // 768px↓에서는 main-nav가 display:none이라 동작 자체가 무해함 (skip된 효과).
  if (activeLink && window.innerWidth <= 640) {
    requestAnimationFrame(() => {
      activeLink.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
  }

  // 하단 탭바 (모바일 768px↓) — 5개 탭 (홈/아티스트/루미나 픽/피드/숏폼) 동기 처리
  // data-tab-key는 파일명. 데뷔하기는 헤더 우측 CTA로 분리되어 탭바에 없음.
  document.querySelectorAll(".mobile-tab").forEach(tab => {
    const tabKey = (tab.dataset.tabKey || "").toLowerCase();
    tab.classList.toggle("is-active", tabKey === filename);
  });
}

function toggleUserMenu(anchorBtn) {
  let menu = document.getElementById("userMenu");
  if (menu?.classList.contains("is-open")) {
    closeUserMenu();
    return;
  }
  if (!menu) menu = createUserMenu();
  const user = getAuth()?.user;
  if (!user) return;
  // 사용자 정보 채우기
  menu.querySelector(".user-menu-name").textContent = user.displayName || user.email?.split("@")[0] || "내 계정";
  menu.querySelector(".user-menu-email").textContent = user.email || "";
  // #058 — 헤더 드롭다운 아바타 동기화 (avatarUrl 있으면 이미지, 없으면 SVG placeholder)
  if (typeof syncUserMenuAvatar === "function") syncUserMenuAvatar();
  // 잔액 새로고침 (열 때마다 — 다른 탭 활동/시간 차이 반영)
  loadWallet();
  // 본인 user-profile.html 진입 항목 — user.id 또는 publicHandle 있으면 노출
  const publicProfileBtn = menu.querySelector(".user-menu-item-public-profile");
  if (publicProfileBtn) {
    const hasTarget = !!(user.id || user.publicHandle);
    publicProfileBtn.hidden = !hasTarget;
  }
  // #144 — 스튜디오 스테이지 메뉴 토글 (차모 spec: GET /api/v1/me/creator-studio access.enabled)
  refreshStudioMenuVisibility(menu);
  // 위치 (헤더 버튼 아래)
  const rect = anchorBtn.getBoundingClientRect();
  menu.style.top = (rect.bottom + 8) + "px";
  menu.style.right = (window.innerWidth - rect.right) + "px";
  menu.classList.add("is-open");
}

function closeUserMenu() {
  const menu = document.getElementById("userMenu");
  if (menu) menu.classList.remove("is-open");
}

/* #144 — 크리에이터 스튜디오 access 캐시 (차모 spec)
   - GET /api/v1/me/creator-studio
   - access.enabled === true 면 드롭다운에 노출, summary로 보조 텍스트 갱신
   - 응답 캐시 5분 (드롭다운 열 때마다 호출 안 함)
   - 401/403/404는 일반 유저 가정 — 메뉴 hidden 유지 */
let _creatorStudioAccess = null;
let _creatorStudioFetchedAt = 0;
const CREATOR_STUDIO_HANDOFF_KEY = "lumina_creator_studio_handoff";

function storeCreatorStudioHandoff(data) {
  if (!data?.access?.enabled) return;
  try {
    sessionStorage.setItem(CREATOR_STUDIO_HANDOFF_KEY, JSON.stringify({
      savedAt: Date.now(),
      viewerEmail: data?.viewer?.email || getAuth()?.user?.email || "",
      data
    }));
  } catch (_) {}
}

function studioEntryUrl(url = "./creator-studio.html") {
  const base = url || "./creator-studio.html";
  const glue = base.includes("?") ? "&" : "?";
  return `${base}${glue}studio_v=${Date.now()}`;
}

async function refreshStudioMenuVisibility(menu) {
  const studioBtn = menu.querySelector(".user-menu-item-studio");
  if (!studioBtn) return;

  // 캐시 5분
  const now = Date.now();
  if (_creatorStudioAccess && (now - _creatorStudioFetchedAt) < 5 * 60 * 1000) {
    applyStudioVisibility(studioBtn, _creatorStudioAccess);
    return;
  }

  try {
    const res = await apiFetch("/api/v1/me/creator-studio", { auth: true });
    storeCreatorStudioHandoff(res);
    _creatorStudioAccess = {
      enabled: !!res?.access?.enabled,
      type: res?.access?.type || "",
      status: res?.access?.status || "",
      entryUrl: res?.access?.entryUrl || "./creator-studio.html",
      needsAttention: Number(res?.summary?.needsAttentionCount) || 0,
      ownedArtists: Number(res?.summary?.ownedArtistCount) || 0
    };
    _creatorStudioFetchedAt = now;
    applyStudioVisibility(studioBtn, _creatorStudioAccess);
  } catch (err) {
    // 권한 없음/미준비 — hidden 유지
    studioBtn.hidden = true;
  }
}
function applyStudioVisibility(btn, access) {
  btn.hidden = !access?.enabled;
  if (!access?.enabled) return;
  const summary = btn.querySelector("[data-studio-summary]");
  if (summary) {
    if (access.needsAttention > 0) {
      summary.textContent = `확인할 항목 ${access.needsAttention}건`;
    } else if (access.ownedArtists > 0) {
      summary.textContent = `운영 캐릭터 ${access.ownedArtists}명`;
    } else {
      summary.textContent = "크리에이터 운영";
    }
  }
}

function createUserMenu() {
  const menu = document.createElement("div");
  menu.id = "userMenu";
  menu.className = "user-menu";
  menu.innerHTML = `
    <div class="user-menu-header">
      <div class="user-menu-avatar">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/></svg>
      </div>
      <div class="user-menu-info">
        <strong class="user-menu-name"></strong>
        <small class="user-menu-email"></small>
      </div>
    </div>
    <div class="user-menu-divider"></div>
    <button class="user-menu-item user-menu-item-public-profile" type="button" data-action="public-profile" hidden>
      <span>내 프로필</span>
      <small>다른 사람에게 보이는 화면</small>
    </button>
    <button class="user-menu-item" type="button" data-action="profile">
      <span>마이페이지</span>
      <small>프로필</small>
    </button>
    <button class="user-menu-item user-menu-item-charge" type="button" data-action="charge">
      <span>충전하기</span>
      <small>루미나 충전소</small>
    </button>
    <!-- #144 스튜디오 스테이지 — access.enabled 시에만 노출, JS에서 동적 토글 -->
    <button class="user-menu-item user-menu-item-studio" type="button" data-action="studio" hidden>
      <span>스튜디오 스테이지</span>
      <small data-studio-summary>크리에이터 운영</small>
    </button>
    <div class="user-menu-divider"></div>
    <button class="user-menu-item user-menu-logout" type="button" data-action="logout">
      <span>로그아웃</span>
    </button>`;
  document.body.appendChild(menu);
  // 메뉴 항목 클릭
  menu.querySelectorAll(".user-menu-item").forEach(item => {
    item.addEventListener("click", () => {
      const action = item.dataset.action;
      if (action === "logout") {
        authLogout();
      } else if (action === "studio") {
        // #144 차모 spec: access.entryUrl 우선
        try {
          if (_creatorStudioAccess?.enabled && !sessionStorage.getItem(CREATOR_STUDIO_HANDOFF_KEY)) {
            sessionStorage.setItem(CREATOR_STUDIO_HANDOFF_KEY, JSON.stringify({
              savedAt: Date.now(),
              viewerEmail: getAuth()?.user?.email || "",
              data: { access: _creatorStudioAccess, viewer: getAuth()?.user || null }
            }));
          }
        } catch (_) {}
        window.location.href = studioEntryUrl(_creatorStudioAccess?.entryUrl || "./creator-studio.html");
      } else if (action === "public-profile") {
        // 본인 user-profile.html — publicHandle 우선, 없으면 user.id
        const me = (typeof getAuth === "function") ? getAuth()?.user : null;
        if (!me?.id && !me?.publicHandle) return;
        const target = me.publicHandle
          ? `./user-profile.html?handle=${encodeURIComponent(me.publicHandle)}`
          : `./user-profile.html?id=${encodeURIComponent(String(me.id))}`;
        window.location.href = target;
      } else {
        const target = {
          profile: "./mypage.html#profile",
          charge: "./charge.html"
        }[action] || "./mypage.html";
        window.location.href = target;
      }
      closeUserMenu();
    });
  });
  return menu;
}

/* Character master data is loaded from data/characters.js before app.js. */
const characters = window.LuminaStaticData?.characters || [];
const shouldKeepLocalGallery = window.LuminaStaticData?.shouldKeepLocalGallery || (() => false);

/* ══════════════════════════════════════════════
   캐릭터별 1인칭 멘트
   - tributeMessage: 이달의 픽이 됐을 때 축하 소감 (응원 받은 후)
   - tributeMessageZero: 아직 1위 응원 0일 때 (대기 중 메시지)
   - voteAppeal: Debut Race 카드의 투표 독려 멘트 (각자 컨셉/말투)
   각 캐릭터의 fandom / concept / 톤에 맞춰 작성
   ══════════════════════════════════════════════ */

function getCharacterMessages(slug) {
  const characterMessages = window.LuminaStaticData.characterMessages;
  return characterMessages[slug] || {
    tributeMessage: "응원해주신 모든 분께 감사합니다. 더 좋은 무대로 보답할게요.",
    tributeMessageZero: "첫 응원을 기다리고 있어요. 함께 시작해주세요.",
    voteAppeal: "응원 한 번 부탁드려요!"
  };
}

/* ── 초기 공개 라인업 (사용자/운영자 결정 기반) ──
   초기 공개 6명: 윤세린, 한서율, 박도아, 최서진, 차도현, 서유안
   - 운영팩 갤러리 seed에 연결되어 있는 6명 (운영 API에서 확인됨)
   - tier 필드와 별개로 운영진이 결정한 공식 라인업
   - 백엔드 main-pick API 응답이 우선, 비어있으면 이 리스트로 fallback */

function isPublicLineup(artist) {
  return window.LuminaStaticData.publicLineupSlugs.includes(artist.slug);
}

let _luminaFeedItems = [];          // 정규화된 통일 구조

/* authorType / postType 정규화 (운영 enum, 에밀리 한국어 모두 흡수) */
function feedEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[ch]);
}

function normalizeFeedAuthorType(rawAuthorType) {
  // 한국어 라벨 → 영어 enum 통일
  const koreanToEnum = {
    "AI 아티스트": "ai_artist",
    "팬": "fan",
    "데뷔 준비": "debut_artist",
    "일반 아티스트": "debut_artist"
  };
  if (koreanToEnum[rawAuthorType]) return koreanToEnum[rawAuthorType];
  return rawAuthorType || "fan";
}

function buildUserProfileUrl(user = {}) {
  const handle = (user.publicHandle || user.authorPublicHandle || "").trim();
  const id = user.id || user.userId || user.authorUserId || "";
  if (handle) return `./user-profile.html?handle=${encodeURIComponent(handle)}`;
  if (id) return `./user-profile.html?id=${encodeURIComponent(String(id))}`;
  return "./mypage.html";
}

function buildMiniProfileAuthorAttrs({ target, handle, userId } = {}) {
  if (!target) return "";
  const parts = [
    `data-user-profile-link="${feedEscapeHtml(target)}"`,
    `style="cursor:pointer;"`
  ];
  if (handle) parts.push(`data-user-profile-handle="${feedEscapeHtml(handle)}"`);
  if (userId) parts.push(`data-user-profile-id="${feedEscapeHtml(String(userId))}"`);
  return ` ${parts.join(" ")}`;
}

function normalizeFeedPost(raw) {
  const authUserId = getAuth()?.user?.id || getAuth()?.user?.userId || null;
  const authorUserId = raw.authorUserId || raw.userId || raw.createdByUserId || raw.author?.id || raw.user?.id || null;
  const isMine = Boolean(raw.isMine || (authUserId && authorUserId && String(authUserId) === String(authorUserId)));
  // #137 — 차모 spec: viewer / permissions / likeCount / replyCount / assets / linkPreview
  const viewer = raw.viewer || {};
  const permissions = raw.permissions || {};
  return {
    id: String(raw.id ?? ""),
    postType: raw.postType || "fan_post",
    artistSlug: (raw.artistSlug && raw.artistSlug !== "없음") ? raw.artistSlug : null,
    artistId: raw.artistId || raw.artist?.id || null, // #145 follow endpoint용
    authorUserId, // #145 작성자 follow endpoint용
    authorPublicHandle: raw.authorPublicHandle || raw.author?.publicHandle || raw.author?.profile?.publicHandle || null, // #152 작성자 프로필 라우팅용
    authorType: normalizeFeedAuthorType(raw.authorType),
    authorName: raw.authorName || raw.author?.displayName || raw.author?.nickname || raw.user?.displayName || raw.user?.nickname || raw.profile?.displayName || "",
    avatarUrl: raw.avatarUrl || raw.author?.avatarUrl || raw.author?.profile?.avatarUrl || raw.user?.avatarUrl || raw.profile?.avatarUrl || "",
    body: raw.body || raw.content || "",
    assets: Array.isArray(raw.assets) ? raw.assets : [],
    linkPreview: raw.linkPreview || null,
    likeCount: Number(raw.likeCount) || 0,
    replyCount: Number(raw.replyCount) || 0,
    viewer: {
      hasLiked: Boolean(viewer.hasLiked),
      isAuthor: Boolean(viewer.isAuthor || isMine),
      canEdit: Boolean(viewer.canEdit ?? permissions.canEdit ?? isMine),
      canDelete: Boolean(viewer.canDelete ?? permissions.canDelete ?? raw.canDelete ?? isMine),
      // #145 — 차모 spec: 팔로우 버튼 판단용 viewer 힌트
      isFollowingArtist: Boolean(viewer.isFollowingArtist),
      isFollowingAuthor: Boolean(viewer.isFollowingAuthor),
      canFollowArtist: Boolean(viewer.canFollowArtist),
      canUnfollowArtist: Boolean(viewer.canUnfollowArtist),
      canFollowAuthor: Boolean(viewer.canFollowAuthor),
      canUnfollowAuthor: Boolean(viewer.canUnfollowAuthor)
    },
    permissions: {
      canEdit: Boolean(permissions.canEdit ?? viewer.canEdit ?? isMine),
      canDelete: Boolean(permissions.canDelete ?? viewer.canDelete ?? raw.canDelete ?? isMine),
      editScope: permissions.editScope || "body_only_mvp"
    },
    canDelete: Boolean(viewer.canDelete ?? permissions.canDelete ?? raw.canDelete ?? isMine)
  };
}

/* #137 Phase B — 피드 글 수정 (텍스트 본문만, 차모 spec)
   - PATCH /api/v1/lumina-feed/posts/:postId  body { body }
   - 응답 { post, policy } — post로 카드 즉시 갱신
   - 이미지 교체는 1차 미지원 (assetEditing: not_supported_yet)
   - 모달 동적 생성 — 한 번에 하나만 열림 보장 */
let _feedEditModalEl = null;
function openFeedEditModal(post) {
  closeFeedEditModal();
  const modal = document.createElement("div");
  modal.className = "feed-edit-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "피드 글 수정");
  modal.innerHTML = `
    <div class="feed-edit-modal-backdrop" data-feed-edit-cancel></div>
    <div class="feed-edit-modal-panel">
      <header class="feed-edit-modal-head">
        <h3>피드 글 수정</h3>
        <button class="feed-edit-modal-close" type="button" data-feed-edit-cancel aria-label="닫기">×</button>
      </header>
      <p class="feed-edit-modal-notice">지금은 글 내용만 수정할 수 있어요. 이미지 교체는 다음 업데이트에서 지원할 예정입니다.</p>
      <textarea class="feed-edit-modal-textarea" rows="6" maxlength="2000" placeholder="내용을 입력해주세요."></textarea>
      <p class="feed-edit-modal-error" hidden></p>
      <footer class="feed-edit-modal-actions">
        <button class="feed-edit-modal-cancel" type="button" data-feed-edit-cancel>취소</button>
        <button class="feed-edit-modal-save" type="button" data-feed-edit-save>저장</button>
      </footer>
    </div>
  `;
  const textarea = modal.querySelector("textarea");
  textarea.value = post.body || "";
  modal.querySelector("[data-feed-edit-save]").dataset.postId = post.id;
  document.body.appendChild(modal);
  _feedEditModalEl = modal;
  // ESC로 닫기
  const escHandler = e => { if (e.key === "Escape") closeFeedEditModal(); };
  modal._escHandler = escHandler;
  document.addEventListener("keydown", escHandler);
  // 자동 포커스 + 커서 끝으로
  setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, 0);
}
function closeFeedEditModal() {
  if (_feedEditModalEl) {
    if (_feedEditModalEl._escHandler) {
      document.removeEventListener("keydown", _feedEditModalEl._escHandler);
    }
    _feedEditModalEl.remove();
    _feedEditModalEl = null;
  }
}
function bindLuminaFeedEdit() {
  if (document._feedEditBound) return;
  document._feedEditBound = true;

  // 1. 카드 footer "수정" 버튼 → 모달 오픈
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-feed-edit]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const postId = btn.dataset.feedEdit;
    if (!postId) return;
    const post = _luminaFeedItems.find(p => p.id === postId);
    if (!post) {
      alert("수정할 글을 찾지 못했어요.");
      return;
    }
    openFeedEditModal(post);
  });

  // 2. 모달 내부 이벤트 위임 — 취소/저장
  document.addEventListener("click", async e => {
    if (e.target.closest("[data-feed-edit-cancel]")) {
      closeFeedEditModal();
      return;
    }
    const saveBtn = e.target.closest("[data-feed-edit-save]");
    if (!saveBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const postId = saveBtn.dataset.postId;
    if (!postId || !_feedEditModalEl) return;
    const textarea = _feedEditModalEl.querySelector("textarea");
    const errorEl = _feedEditModalEl.querySelector(".feed-edit-modal-error");
    const newBody = (textarea.value || "").trim();
    if (!newBody) {
      errorEl.textContent = "내용을 입력해주세요.";
      errorEl.hidden = false;
      textarea.focus();
      return;
    }
    errorEl.hidden = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중…";
    try {
      const res = await apiFetch(`/api/v1/lumina-feed/posts/${encodeURIComponent(postId)}`, {
        method: "PATCH",
        auth: true,
        throwOnError: true,
        body: { body: newBody }
      });
      const updatedPost = res?.post || res?.data?.post || null;
      if (updatedPost) {
        const idx = _luminaFeedItems.findIndex(p => p.id === postId);
        if (idx >= 0) {
          _luminaFeedItems[idx] = normalizeFeedPost({ ..._luminaFeedItems[idx], ...updatedPost });
        }
      } else {
        // 응답에 post 없으면 로컬 body만 갱신 (보수적)
        const idx = _luminaFeedItems.findIndex(p => p.id === postId);
        if (idx >= 0) _luminaFeedItems[idx].body = newBody;
      }
      closeFeedEditModal();
      if (typeof renderLuminaFeed === "function") renderLuminaFeed();
      // 가벼운 토스트 (별도 토스트 시스템이 없으면 alert로 fallback)
      if (typeof showLuminaToast === "function") {
        showLuminaToast("피드 글이 수정됐어요.", { kind: "success" });
      }
    } catch (err) {
      console.warn("[#137 edit] 실패", { status: err?.status, body: err?.body });
      errorEl.textContent = err?.message || "글 수정에 실패했어요. 잠시 후 다시 시도해주세요.";
      errorEl.hidden = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "저장";
    }
  });
}

async function fetchUserProfileForMiniModal({ handle, userId } = {}) {
  const isAuth = typeof isLoggedIn === "function" && isLoggedIn();
  if (handle) {
    return await apiFetch(`/api/v1/users/handle/${encodeURIComponent(handle)}/profile`, { auth: isAuth });
  }
  if (userId) {
    return await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}/profile`, { auth: isAuth });
  }
  return null;
}

async function openFeedAuthorMiniProfile(link) {
  const handle = (link?.dataset?.userProfileHandle || "").trim();
  const userId = (link?.dataset?.userProfileId || "").trim();
  const fallbackUrl = link?.dataset?.userProfileLink || "";
  if (!handle && !userId) {
    if (fallbackUrl) window.location.href = fallbackUrl;
    return;
  }
  link.dataset.profileBusy = "1";
  try {
    const data = await fetchUserProfileForMiniModal({ handle, userId });
    if (data?.user && typeof openMiniProfileModal === "function") {
      openMiniProfileModal(data);
    } else if (fallbackUrl) {
      window.location.href = fallbackUrl;
    }
  } catch (err) {
    console.warn("[#179 mini profile] 조회 실패:", err?.status, err?.message);
    if (fallbackUrl) window.location.href = fallbackUrl;
  } finally {
    link.dataset.profileBusy = "0";
  }
}

function bindLuminaFeedDelete() {
  if (document._feedDeleteBound) return;
  document._feedDeleteBound = true;
  // #179 — 같은 위치에서 작성자 미니 프로필 모달도 같이 등록
  document.addEventListener("click", e => {
    const link = e.target.closest("[data-user-profile-link]");
    if (!link) return;
    // 안에 있는 버튼들(좋아요·수정·삭제·팔로우 등) 클릭은 무시
    if (e.target.closest("button, a")) return;
    e.preventDefault();
    e.stopPropagation();
    if (link.dataset.profileBusy === "1") return;
    openFeedAuthorMiniProfile(link);
  });
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-feed-delete]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const postId = btn.dataset.feedDelete;
    if (!postId || !confirm("이 피드 글을 삭제할까요?")) return;
    btn.disabled = true;
    btn.textContent = "삭제 중";
    try {
      await apiFetch(`/api/v1/lumina-feed/posts/${encodeURIComponent(postId)}`, {
        method: "DELETE",
        auth: true,
        throwOnError: true
      });
      _luminaFeedItems = _luminaFeedItems.filter(post => post.id !== postId);
      if (typeof renderLuminaFeed === "function") renderLuminaFeed();
    } catch (err) {
      alert(err.message || "게시글을 삭제하지 못했어요. 잠시 후 다시 시도해주세요.");
      btn.disabled = false;
      btn.textContent = "삭제";
    }
  });
}

/* #137 Phase A — 피드 좋아요 토글 (무료, 1인 1좋아요)
   - 차모 spec: POST/DELETE /api/v1/lumina-feed/posts/:postId/like
   - 응답에서 post.likeCount, post.viewer.hasLiked를 받아 UI 갱신
   - 비로그인 시 로그인 유도, 다중 클릭은 in-flight 가드로 차단 */
function bindLuminaFeedLike() {
  if (document._feedLikeBound) return;
  document._feedLikeBound = true;
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-feed-like]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const postId = btn.dataset.feedLike;
    if (!postId) return;
    if (btn.dataset.busy === "1") return; // 다중 클릭 가드
    // 비로그인 — 로그인 유도
    if (typeof getAccessToken === "function" && !getAccessToken()) {
      alert("로그인하면 좋아요를 보낼 수 있어요.");
      return;
    }
    const wasLiked = btn.classList.contains("is-liked");
    btn.dataset.busy = "1";
    // 낙관적 UI: 즉시 토글 (실패 시 롤백)
    btn.classList.toggle("is-liked", !wasLiked);
    btn.setAttribute("aria-pressed", String(!wasLiked));
    try {
      const res = await apiFetch(`/api/v1/lumina-feed/posts/${encodeURIComponent(postId)}/like`, {
        method: wasLiked ? "DELETE" : "POST",
        auth: true,
        throwOnError: true
      });
      // 서버 응답 우선 — post.likeCount, post.viewer.hasLiked
      const post = res?.post || res?.data?.post || null;
      if (post) {
        // 로컬 캐시 갱신
        const idx = _luminaFeedItems.findIndex(p => p.id === postId);
        if (idx >= 0) {
          _luminaFeedItems[idx] = { ..._luminaFeedItems[idx], ...post };
        }
        // 카드 내 카운트만 업데이트 (전체 재렌더 안 함 — 사용자 스크롤 위치 보존)
        const liked = !!post.viewer?.hasLiked;
        btn.classList.toggle("is-liked", liked);
        btn.setAttribute("aria-pressed", String(liked));
        btn.setAttribute("aria-label", liked ? "좋아요 취소하기" : "좋아요 누르기"); // #147 B-1 에밀리 카피
        const countEl = btn.querySelector("[data-feed-like-count]");
        if (countEl) {
          const n = Number(post.likeCount) || 0;
          countEl.textContent = String(n); // #147 B-3 — 0도 보여줌
        }
      }
    } catch (err) {
      // 실패 시 낙관적 토글 롤백
      btn.classList.toggle("is-liked", wasLiked);
      btn.setAttribute("aria-pressed", String(wasLiked));
      console.warn("[#137 like] 실패", { status: err?.status, body: err?.body });
      alert(err?.message || "좋아요 처리에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      btn.dataset.busy = "0";
    }
  });
}

let _feedCommentModalEl = null;
function openFeedCommentModal(post) {
  closeFeedCommentModal();
  const modal = document.createElement("div");
  modal.className = "feed-comment-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "댓글");
  modal.innerHTML = `
    <div class="feed-comment-modal-backdrop" data-feed-comment-close></div>
    <div class="feed-comment-modal-panel">
      <header class="feed-comment-modal-head">
        <h3>댓글</h3>
        <button class="feed-comment-modal-close" type="button" data-feed-comment-close aria-label="닫기">×</button>
      </header>
      <div class="feed-comment-post">
        <strong>${feedEscapeHtml(post.authorName || "Lumina User")}</strong>
        <p>${feedEscapeHtml(post.body || "")}</p>
      </div>
      <div class="feed-comment-list" data-feed-comment-list>
        <p class="feed-comment-state">댓글을 불러오고 있어요…</p>
      </div>
      <form class="feed-comment-form" data-feed-comment-form>
        <textarea rows="3" maxlength="600" placeholder="댓글을 남겨보세요." aria-label="댓글 입력"></textarea>
        <div class="feed-comment-form-actions">
          <p class="feed-comment-message" data-feed-comment-message hidden></p>
          <button type="submit">등록</button>
        </div>
      </form>
    </div>
  `;
  modal.querySelector("[data-feed-comment-form]").dataset.postId = post.id || "";
  document.body.appendChild(modal);
  document.body.style.overflow = "hidden";
  _feedCommentModalEl = modal;
  loadFeedComments(post.id);
  setTimeout(() => modal.querySelector("textarea")?.focus(), 80);
}

function closeFeedCommentModal() {
  if (!_feedCommentModalEl) return;
  _feedCommentModalEl.remove();
  _feedCommentModalEl = null;
  document.body.style.overflow = "";
}

function renderFeedCommentItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<p class="feed-comment-state">아직 댓글이 없어요. 첫 댓글을 남겨볼까요?</p>`;
  }
  return items.map(item => {
    const author = item.author || item.user || {};
    const name = item.authorName || author.displayName || author.nickname || "Lumina User";
    const body = item.body || item.content || "";
    return `<article class="feed-comment-item"><strong>${feedEscapeHtml(name)}</strong><p>${feedEscapeHtml(body)}</p></article>`;
  }).join("");
}

async function loadFeedComments(postId) {
  const list = _feedCommentModalEl?.querySelector("[data-feed-comment-list]");
  if (!list || !postId) return;
  try {
    const res = await apiFetch(`/api/v1/lumina-feed/posts/${encodeURIComponent(postId)}/replies?take=20`, {
      auth: typeof isLoggedIn === "function" && isLoggedIn()
    });
    const items = Array.isArray(res) ? res : (res?.items || res?.replies || res?.comments || []);
    list.innerHTML = renderFeedCommentItems(items);
  } catch (err) {
    console.warn("[Lumina feed comments] 조회 실패:", err?.status, err?.message);
    list.innerHTML = `<p class="feed-comment-state">댓글 목록은 잠시 후 다시 불러와 주세요.</p>`;
  }
}

function bindLuminaFeedComment() {
  if (document._feedCommentBound) return;
  document._feedCommentBound = true;
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-feed-comment]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const postId = btn.dataset.feedComment;
    const post = _luminaFeedItems.find(p => p.id === postId);
    if (post) openFeedCommentModal(post);
  });
  document.addEventListener("click", e => {
    if (e.target.closest("[data-feed-comment-close]")) {
      e.preventDefault();
      closeFeedCommentModal();
    }
  });
  document.addEventListener("submit", async e => {
    const form = e.target.closest("[data-feed-comment-form]");
    if (!form) return;
    e.preventDefault();
    if (typeof getAccessToken === "function" && !getAccessToken()) {
      if (typeof openAuthModal === "function") openAuthModal("login");
      return;
    }
    const postId = form.dataset.postId;
    const textarea = form.querySelector("textarea");
    const message = form.querySelector("[data-feed-comment-message]");
    const body = (textarea?.value || "").trim();
    if (!postId || !body) {
      if (message) {
        message.textContent = "댓글 내용을 입력해 주세요.";
        message.hidden = false;
      }
      return;
    }
    const submitBtn = form.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await apiFetch(`/api/v1/lumina-feed/posts/${encodeURIComponent(postId)}/replies`, {
        method: "POST",
        auth: true,
        throwOnError: true,
        body: { body }
      });
      if (textarea) textarea.value = "";
      const idx = _luminaFeedItems.findIndex(p => p.id === postId);
      if (idx >= 0) {
        const serverPost = res?.post || res?.data?.post || null;
        _luminaFeedItems[idx].replyCount = Number(serverPost?.replyCount ?? _luminaFeedItems[idx].replyCount + 1) || 0;
      }
      await loadFeedComments(postId);
      if (typeof renderLuminaFeed === "function") renderLuminaFeed();
    } catch (err) {
      console.warn("[Lumina feed comments] 등록 실패:", err?.status, err?.message);
      if (message) {
        message.textContent = err?.message || "댓글 등록에 실패했어요. 잠시 후 다시 시도해 주세요.";
        message.hidden = false;
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

/* 라이트박스 — 피드 이미지 클릭 시 큰 이미지 오버레이 + 우클릭 차단 + 확대 토글
   - 이미지 클릭 → 검은 배경 + 가운데 큰 이미지 (화면에 맞춤)
   - 이미지 한 번 더 클릭 → 원본 크기로 확대 (드래그 가능)
   - 다시 클릭 → fit-screen으로 복귀
   - ESC / 빈 영역 클릭 / × 버튼 → 닫기
   - 우클릭 모두 차단 (썸네일 + 라이트박스)
   - 모바일 핀치 줌은 브라우저 기본 동작 (touch-action: pinch-zoom)
   - 같은 게시글에 여러 장이면 ←/→ 키 + 좌우 버튼으로 슬라이드 */
let _lightboxEl = null;
let _lightboxKeyHandler = null;
let _lightboxState = { sources: [], index: 0, zoomed: false };
function openLightbox(sources, startIndex) {
  if (!Array.isArray(sources) || sources.length === 0) return;
  _lightboxState = { sources, index: Math.max(0, Math.min(startIndex || 0, sources.length - 1)), zoomed: false };

  if (!_lightboxEl) {
    _lightboxEl = document.createElement("div");
    _lightboxEl.className = "lightbox-overlay";
    _lightboxEl.setAttribute("role", "dialog");
    _lightboxEl.setAttribute("aria-modal", "true");
    _lightboxEl.innerHTML = `
      <button class="lightbox-close" type="button" aria-label="닫기">×</button>
      <button class="lightbox-prev" type="button" aria-label="이전 이미지">‹</button>
      <button class="lightbox-next" type="button" aria-label="다음 이미지">›</button>
      <div class="lightbox-stage" data-lightbox-stage>
        <img class="lightbox-img" alt="" draggable="false" oncontextmenu="return false;" />
        <div class="lightbox-error" data-lightbox-error hidden>이미지를 불러올 수 없어요</div>
      </div>
      <div class="lightbox-counter" data-lightbox-counter></div>
    `;
    document.body.appendChild(_lightboxEl);

    // 닫기
    _lightboxEl.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
    _lightboxEl.addEventListener("click", e => {
      // 빈 영역(stage 외부)을 클릭하면 닫기
      if (e.target === _lightboxEl) closeLightbox();
    });
    // 이전/다음
    _lightboxEl.querySelector(".lightbox-prev").addEventListener("click", e => { e.stopPropagation(); navigateLightbox(-1); });
    _lightboxEl.querySelector(".lightbox-next").addEventListener("click", e => { e.stopPropagation(); navigateLightbox(1); });
    // 이미지 클릭으로 확대 토글
    _lightboxEl.querySelector(".lightbox-img").addEventListener("click", e => {
      e.stopPropagation();
      _lightboxState.zoomed = !_lightboxState.zoomed;
      _lightboxEl.classList.toggle("is-zoomed", _lightboxState.zoomed);
    });
    _lightboxEl.querySelector(".lightbox-img").addEventListener("error", () => {
      _lightboxEl.classList.add("is-broken");
      _lightboxEl.querySelector("[data-lightbox-error]")?.removeAttribute("hidden");
    });
    // 우클릭 차단 (오버레이 전체)
    _lightboxEl.addEventListener("contextmenu", e => e.preventDefault());
  }

  applyLightbox();
  _lightboxEl.classList.add("is-open");
  document.body.style.overflow = "hidden";

  // ESC + 좌우 키
  _lightboxKeyHandler = e => {
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") navigateLightbox(-1);
    else if (e.key === "ArrowRight") navigateLightbox(1);
  };
  document.addEventListener("keydown", _lightboxKeyHandler);
}
function navigateLightbox(delta) {
  if (!_lightboxState.sources.length) return;
  const next = (_lightboxState.index + delta + _lightboxState.sources.length) % _lightboxState.sources.length;
  _lightboxState.index = next;
  _lightboxState.zoomed = false;
  applyLightbox();
}
function applyLightbox() {
  if (!_lightboxEl) return;
  const img = _lightboxEl.querySelector(".lightbox-img");
  const counter = _lightboxEl.querySelector("[data-lightbox-counter]");
  const prev = _lightboxEl.querySelector(".lightbox-prev");
  const next = _lightboxEl.querySelector(".lightbox-next");
  const error = _lightboxEl.querySelector("[data-lightbox-error]");
  _lightboxEl.classList.remove("is-broken");
  if (error) error.hidden = true;
  if (img) img.src = _lightboxState.sources[_lightboxState.index] || "";
  _lightboxEl.classList.toggle("is-zoomed", _lightboxState.zoomed);
  // 카운터 (1/3 형식)
  if (counter) {
    if (_lightboxState.sources.length > 1) {
      counter.textContent = `${_lightboxState.index + 1} / ${_lightboxState.sources.length}`;
      counter.style.display = "";
    } else {
      counter.style.display = "none";
    }
  }
  // 단일 이미지면 좌우 버튼 숨김
  const showNav = _lightboxState.sources.length > 1;
  if (prev) prev.style.display = showNav ? "" : "none";
  if (next) next.style.display = showNav ? "" : "none";
}
function closeLightbox() {
  if (!_lightboxEl) return;
  _lightboxEl.classList.remove("is-open");
  _lightboxEl.classList.remove("is-zoomed");
  document.body.style.overflow = "";
  if (_lightboxKeyHandler) {
    document.removeEventListener("keydown", _lightboxKeyHandler);
    _lightboxKeyHandler = null;
  }
}

/* 피드 이미지 썸네일 클릭 → 라이트박스 열기 + 우클릭 차단 (이벤트 위임) */
function bindFeedAssetLightbox() {
  if (document._feedLightboxBound) return;
  document._feedLightboxBound = true;
  // 클릭 → 라이트박스
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-feed-asset]");
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const group = a.closest("[data-feed-asset-group]");
    const sources = group?.dataset?.feedAssetGroup
      ? group.dataset.feedAssetGroup.split("|").filter(Boolean)
      : [a.dataset.assetUrl].filter(Boolean);
    const index = Number(a.dataset.assetIndex) || 0;
    openLightbox(sources, index);
  });
  // 우클릭 차단 — 피드 이미지 영역 + 썸네일·아바타·미리보기까지
  document.addEventListener("contextmenu", e => {
    if (e.target.closest("[data-feed-asset], [data-feed-asset-group], .feed-post-assets, .feed-post-asset-item, .feed-link-preview-thumb img, .feed-post-avatar img, .lightbox-stage, .lightbox-img, .lightbox-overlay")) {
      e.preventDefault();
    }
  }, { capture: true, passive: false });
  // 드래그 차단 (이미지 끌어서 저장 방지)
  document.addEventListener("dragstart", e => {
    if (e.target.closest("[data-feed-asset], .feed-post-asset-item img, .lightbox-img")) {
      e.preventDefault();
    }
  }, { capture: true, passive: false });
}

/* 카드 더보기/접기 토글 — 이벤트 위임 (한 번만 등록).
   카드 클릭 네비게이션과 충돌 방지: stopPropagation. */
function bindLuminaFeedExpand() {
  if (document._feedExpandBound) return;
  document._feedExpandBound = true;
  document.addEventListener("click", e => {
    const btn = e.target.closest(".feed-post-expand-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const post = btn.closest(".feed-post");
    if (!post) return;
    const isExpanded = post.classList.toggle("is-expanded");
    btn.textContent = isExpanded ? "접기" : "더 보기";
    btn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  });
}

/* ══════════════════════════════════════════════
   #056 — 루미나 피드 이미지 첨부 / 작성창
   - 차모 #054 (community_post_assets) + #055 (사용자 upload-intent) 연동
   - 흐름: upload-intents → 파일 PUT → confirm-upload → assetIds로 작성
   - MVP 정책: 이미지 최대 4장
   ══════════════════════════════════════════════ */


// 작성창 상태 — 첨부 이미지 (assetId 확정된 것만 추적)

function feedResolveAssetUrl(entry, type = "full") {
  if (typeof entry === "string") return normalizeAssetUrl(entry);
  const asset = entry?.asset && typeof entry.asset === "object" ? entry.asset : {};
  const primary = type === "thumb"
    ? asset.displayUrl || asset.thumbnailUrl || asset.thumbUrl || asset.imageUrl || entry?.displayUrl || entry?.thumbnailUrl || entry?.thumbUrl || entry?.imageUrl || asset.url || asset.publicUrl || entry?.url || entry?.publicUrl
    : asset.displayUrl || asset.url || asset.publicUrl || asset.imageUrl || entry?.displayUrl || entry?.url || entry?.publicUrl || entry?.imageUrl || asset.thumbnailUrl || entry?.thumbnailUrl || asset.storageKey || entry?.storageKey;
  return primary ? normalizeAssetUrl(primary) : "";
}

function renderFeedPostAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) return "";
  const items = assets
    .map(a => ({
      fullUrl: feedResolveAssetUrl(a, "full"),
      thumbUrl: feedResolveAssetUrl(a, "thumb"),
    }))
    .filter(item => item.fullUrl)
    .slice(0, 4);
  if (items.length === 0) return "";
  const gridClass = `feed-post-assets feed-post-assets-${items.length}`;
  const isMulti = items.length > 1;
  // 라이트박스용 src 묶음을 부모에 데이터로 (다음/이전 슬라이드 가능)
  const sources = items.map(item => item.fullUrl).join("|");
  return `
    <div class="${gridClass}${isMulti ? ' has-multi' : ''}" data-feed-asset-group="${feedEscapeHtml(sources)}">
      ${items.map((a, idx) => {
        const src = feedEscapeHtml(a.thumbUrl || a.fullUrl);
        const full = feedEscapeHtml(a.fullUrl);
        const badge = (idx === 0 && isMulti)
          ? `<span class="feed-asset-multi-badge" aria-label="${items.length}장의 이미지"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 5h12v10H4zM18 7h2v10H8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>${items.length}</span>`
          : "";
        return `<a class="feed-post-asset-item" href="${full}" rel="noopener noreferrer" data-feed-asset data-asset-index="${idx}" data-asset-url="${full}" oncontextmenu="return false;" draggable="false">
          ${badge}
          <img src="${src}" data-full-src="${full}" alt="" loading="lazy" oncontextmenu="return false;" draggable="false" onerror="if(!this.dataset.fullTried&&this.dataset.fullSrc&&this.src!==this.dataset.fullSrc){this.dataset.fullTried='1';this.src=this.dataset.fullSrc;}else{this.parentElement.classList.add('is-broken');this.style.display='none';}" />
        </a>`;
      }).join("")}
    </div>
  `;
}

/* #089 — 외부 링크 미리보기 카드 (백엔드 #084 contract: post.linkPreview)
   metadata_only 정책상 title/description/imageUrl은 null일 수 있음 → hostname/siteName 중심 fallback */
function renderFeedLinkPreview(linkPreview) {
  if (!linkPreview || typeof linkPreview !== "object") return "";
  const url = linkPreview.canonicalUrl || linkPreview.url || "";
  if (!url) return "";
  const host = linkPreview.hostname || (() => {
    try { return new URL(url).hostname; } catch { return ""; }
  })();
  const siteName = linkPreview.siteName || host || "외부 링크";
  const title = linkPreview.title || siteName;
  const desc = linkPreview.description || "";
  const img = linkPreview.imageUrl || "";
  return `
    <a class="feed-link-preview" href="${feedEscapeHtml(url)}" target="_blank" rel="noopener noreferrer">
      ${img ? `<div class="feed-link-preview-thumb"><img src="${feedEscapeHtml(img)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'" /></div>` : ""}
      <div class="feed-link-preview-body">
        <strong class="feed-link-preview-title">${feedEscapeHtml(title)}</strong>
        ${desc ? `<p class="feed-link-preview-desc">${feedEscapeHtml(desc)}</p>` : ""}
        <span class="feed-link-preview-host">🔗 ${feedEscapeHtml(host || siteName)}</span>
      </div>
    </a>
  `;
}

const statusMeta = {
  public:    { label: "공식 활동 중",  summaryLabel: "활동 중",   className: "is-public"    },
  debut:     { label: "데뷔 예정",     summaryLabel: "곧 공개",   className: "is-debut"     },
  secret:    { label: "비공개 라인",   summaryLabel: "비공개", className: "is-secret"    },
  candidate: { label: "비공개 라인",   summaryLabel: "비공개", className: "is-secret"    }
};

/* ── 숏폼 데이터 (로컬 fallback) ────────────── */
/* 숏폼 — 8명 각 1개씩, 모든 이미지는 cover.png 사용 (#사용자 결정 2026-05-03)
   - 아티스트 카드 영역(메인페이지 hero, characters.html)은 thumb.png 사용
   - 숏폼 영역은 cover.png 사용으로 시각 분리
   - mainTone/hubTone/tone은 #066 에밀리 카피 답변 후 정식 교체 예정 (현재는 임시)
*/
const shortformsLocal = window.LuminaStaticData?.shortformsLocal || [];

/* ── 비즈니스 패키지 ─────────────────────────── */

/* ── 런타임 상태 ─────────────────────────────── */
let _artists = characters;
let _shortforms = shortformsLocal;

/* ── 유틸 ───────────────────────────────────── */
function getCharacterByName(name) {
  return _artists.find(a => a.publicName === name || a.name === name);
}
function getCharacterBySlug(slug) {
  return _artists.find(a => a.slug === slug);
}
function mediaStyle(path) {
  if (!path) return "";
  return `style="background-image: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(22,18,32,0.16)), url('${path}')"`;
}

function isHiddenLineupArtist(artist) {
  return ["secret", "candidate", "private", "hidden", "unlisted"].includes(artist?.status);
}

function artistToneCopy(artist) {
  return artist?.concept || artist?.artistDescription || artist?.summary || "";
}

/* ── API 어댑터 ─────────────────────────────────
   백엔드 응답 → 프론트 구조로 변환
   #030 차모 답변 반영: coverImage/thumbnailImage는 object (url 안에 있음),
   asset url은 상대 경로 → leading slash 보장 (프론트 도메인 기준)
   ─────────────────────────────────────────── */
function normalizeAssetUrl(url) {
  if (!url) return "";

  // 운영 도메인이 아닌 곳 (localhost, Vercel preview, 다른 호스팅)에서는
  // 운영 절대 URL을 상대 경로로 변환 → 깃 레포 내 동일 경로 파일 사용
  // 운영 lumina-stage.com 배포 시에는 그대로 절대 URL 사용
  const isOnLuminaDomain = typeof window !== "undefined" && window.location &&
    /(?:^|\.)lumina-stage\.com$/i.test(window.location.hostname);
  if (!isOnLuminaDomain && /^https?:\/\/[^/]*lumina-stage\.com\//i.test(url)) {
    const m = String(url).match(/^https?:\/\/[^/]+(\/.+)$/);
    if (m) return m[1]; // path만 추출 → "/assets/..." 등
  }

  if (/^https?:\/\//i.test(url)) return url;
  // "./assets/..." / "/assets/..." / "assets/..." 모두 → "/assets/..." 통일
  // (#030 5번 케이스 — 페이지 경로에 따라 ./ 상대경로 꼬임 방지)
  return `/${String(url).replace(/^(\.\/+|\/+)/, "")}`;
}

function pickArtistProfile(apiProfile, localProfile) {
  const apiKeys = apiProfile && typeof apiProfile === "object" ? Object.keys(apiProfile) : [];
  const localKeys = localProfile && typeof localProfile === "object" ? Object.keys(localProfile) : [];
  if (apiKeys.length >= localKeys.length) return apiProfile || localProfile || {};
  return localProfile || apiProfile || {};
}

function adaptArtist(api) {
  const local = characters.find(c => c.slug === api.slug) || {};
  // 운영 API의 assets[]에서 usageType별로 우선 사용, 없으면 로컬 fallback.
  const assets = api.assets || [];
  const apiCover  = assets.find(a => a.usageType === "cover");
  const apiThumb  = assets.find(a => a.usageType === "thumb");
  const apiGallery = assets
    .filter(a => a.usageType === "gallery")
    .map(a => ({ caption: a.caption || "Gallery", src: normalizeAssetUrl(a.url) }));
  return {
    ...local,
    id:          api.id            || api._id           || local.id,
    name:        api.name          || local.name,
    publicName:  api.publicName    || api.public_name    || local.publicName,
    slug:        api.slug,
    type:        api.type          || local.type,
    tier:        api.tier          || local.tier,
    status:      api.status        || local.status,
    summary:     api.summary       || local.summary,
    intro:       api.intro         || local.intro,
    concept:     api.concept       || local.concept,
    tags:        api.tags          || local.tags || [],
    fandom:      api.fandom        || local.fandom,
    business:    api.business      || local.business,
    images: {
      // #030: coverImage/thumbnailImage는 asset object → .url 추출. 정답 필드명은 thumbnailImage.
      // local fallback도 normalize 안에 포함 → "./assets/..." 도 절대 경로로 통일
      cover: normalizeAssetUrl(apiCover?.url || api.coverImage?.url || api.coverImageUrl || api.cover_image || local.images?.cover),
      thumb: normalizeAssetUrl(apiThumb?.url || api.thumbnailImage?.url || api.thumbImage?.url || api.thumbImage || api.thumb_image || local.images?.thumb)
    },
    gallery:           shouldKeepLocalGallery(api.slug) ? (local.gallery || []) : (apiGallery.length > 0 ? apiGallery : (local.gallery || [])),
    assets:            api.assets || [],   // #031: 원본 assets[] 보존 (상세 페이지에서 필터링용)
    profile:           pickArtistProfile(api.profile, local.profile),
    shorts:            api.shorts  || local.shorts  || [],
    // 프론트 전용 필드: 항상 로컬 유지
    role:              local.role,
    artistDescription: local.artistDescription,
    colorAccent:       local.colorAccent
  };
}

function adaptShortform(api) {
  const local = shortformsLocal.find(s => s.title === api.title) || {};
  return {
    title:  api.title                           || local.title,
    artist: api.artistName || api.artist_name  || local.artist,
    metric: api.metric                          || local.metric,
    tone:   api.tone       || api.description  || local.tone,
    mainTone: api.mainTone || api.main_tone || local.mainTone,
    hubTone:  api.hubTone  || api.hub_tone  || local.hubTone,
    image:  api.thumbnailUrl || api.thumbnail_url || local.image
  };
}

/* ── 렌더링: 메인 아티스트 (mainArtists 배열 제거됨) */
/* ── 렌더링: 메인 hero "이달의 아티스트" ─────── */
/* 좋아요 1위 메인/프리미엄 캐릭터를 자동으로 hero에 표시.
   - 좋아요 데이터가 비어있으면 첫 번째 메인 캐릭터로 fallback (HTML 하드코딩과 일관)
   - 루미나 픽 데이터(_rankings)가 도착하면 자동 갱신 */
/* ══════════════════════════════════════════════
   루미나 픽 (popular-vote.html)
   3탭: Monthly Pick / Cheer Race / Hall of Fame
   백엔드 API:
   - GET /api/v1/popular-vote/main-pick
   - GET /api/v1/popular-vote/hall-of-fame/monthly-picks?year={year}
   - GET /api/v1/popular-vote/hall-of-fame/year-champion?year={year}
   - Debut Race는 기존 boost-campaigns 흐름 (free-like)
   ══════════════════════════════════════════════ */

/* ── 무료 좋아요 잔여 한도 ──
   2026-05-02 차모 신규 추가 API: GET /api/v1/me/free-like-quota
   응답: { campaign, dailyLimit, usedToday, remaining, resetsAt } */
let _freeLikeQuota = null;

async function loadFreeLikeQuota() {
  if (!isLoggedIn()) {
    _freeLikeQuota = null;
    return;
  }
  try {
    _freeLikeQuota = await apiFetch("/api/v1/me/free-like-quota", { auth: true, throwOnError: true });
  } catch (err) {
    console.warn("[Lumina] 무료 좋아요 한도 조회 실패:", err);
    _freeLikeQuota = null;
  }
}

function updateHeroQuotaDisplay() {
  const heroQuotaEl = document.getElementById("heroQuotaLabel");
  if (!heroQuotaEl) return;
  if (_freeLikeQuota && typeof _freeLikeQuota.dailyLimit === "number") {
    const remaining = _freeLikeQuota.remaining ?? 0;
    const limit = _freeLikeQuota.dailyLimit;
    heroQuotaEl.textContent = `오늘 ${remaining}/${limit} 남음`;
  } else {
    heroQuotaEl.textContent = "오늘의 한 표";
  }
}


/* ── 렌더링: 비공개 아티스트 라인 ─────────────── */
/* ── 렌더링: 숏폼 그리드 ─────────────────────── */

/* ── 렌더링: 숏폼 허브 ───────────────────────── */

/* ── 렌더링: 로스터 ──────────────────────────── */
/* #150 — 아티스트 상세 viewer/stats 조회 + 팔로우 버튼 갱신 (차모 #149 spec)
   - GET /api/v1/artists/:slug (Authorization 있으면 viewer 힌트 같이 옴)
   - 비로그인이면 followerCount만 갱신, 팔로우 버튼은 hidden 유지
   - 로그인이면 viewer.canFollow/canUnfollow에 따라 토글 */
let _detailArtistData = null;
async function fetchArtistDetailViewer(slug) {
  if (!slug) return;
  try {
    const isAuth = typeof isLoggedIn === "function" && isLoggedIn();
    const res = await apiFetch(`/api/v1/artists/${encodeURIComponent(slug)}`, {
      auth: isAuth // 로그인 상태면 토큰 첨부 → viewer 힌트 받음
    });
    if (!res?.id) return;
    _detailArtistData = res;
    applyArtistDetailViewer(res);
  } catch (err) {
    console.warn("[#150 artist detail viewer] 조회 실패:", err?.status, err?.message);
  }
}
function applyArtistDetailViewer(data) {
  const followerEl = document.querySelector("[data-detail-follower-count]");
  if (followerEl && typeof data?.stats?.followerCount === "number") {
    followerEl.textContent = `팔로워 ${data.stats.followerCount.toLocaleString("ko-KR")}`;
  }
  const btn = document.querySelector("[data-detail-follow]");
  if (!btn) return;
  const v = data?.viewer || {};
  if (v.isAuthenticated && (v.canFollow || v.canUnfollow)) {
    btn.hidden = false;
    btn.dataset.artistId = data.id || "";
    if (v.isFollowing || v.canUnfollow) {
      btn.classList.add("is-following");
      const label = btn.querySelector("[data-detail-follow-label]");
      if (label) label.textContent = "팔로잉 해제";
      btn.setAttribute("aria-label", "팔로잉 해제");
      btn.title = "팔로잉 해제";
      btn.dataset.following = "1";
    } else {
      btn.classList.remove("is-following");
      const label = btn.querySelector("[data-detail-follow-label]");
      if (label) label.textContent = "팔로우";
      btn.setAttribute("aria-label", "팔로우");
      btn.title = "팔로우";
      btn.dataset.following = "0";
    }
  } else {
    // 비로그인 — 버튼은 hidden 유지 (팔로워 수만 보여줌)
    btn.hidden = true;
  }
}

/* ── 렌더링: 비즈니스 패키지 ─────────────────── */

/* ── 카드 클릭 네비게이션 ────────────────────── */
function bindCardNavigation() {
  // 이벤트 위임 (한 번만 등록) — 동적으로 추가된 카드(루미나 픽 등)도 자동 작동
  if (document._cardNavBound) return;
  document._cardNavBound = true;

  // 클릭 이동
  document.addEventListener("click", e => {
    // 좋아요 버튼이나 일반 a/button 클릭은 카드 이동에서 제외
    if (e.target.closest("a, button")) return;
    const card = e.target.closest(".clickable-card");
    if (!card) return;
    const href = card.dataset.href;
    if (!href) return;

    if (card.dataset.secret === "true") {
      const ov = document.createElement("div");
      ov.className = "secret-transition";
      ov.innerHTML = `<div class="secret-transition-panel"><span>시크릿 접근</span><strong>비공개 프로필에 접근 중입니다</strong></div>`;
      document.body.appendChild(ov);
      setTimeout(() => window.location.href = href, 540);
      return;
    }
    window.location.href = href;
  });

  // 키보드 접근성 — Enter/Space
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = document.activeElement?.closest(".clickable-card");
    if (!card) return;
    const href = card.dataset.href;
    if (!href) return;
    e.preventDefault();
    window.location.href = href;
  });

  // 초기 로드된 카드들에 tabIndex/role 부여 (포커스 가능하게)
  // MutationObserver로 새 카드 추가될 때도 자동 처리
  const setA11y = (root) => {
    root.querySelectorAll(".clickable-card").forEach(card => {
      if (!card.hasAttribute("tabindex")) card.tabIndex = 0;
      if (!card.hasAttribute("role")) card.setAttribute("role", "link");
    });
  };
  setA11y(document);
  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) setA11y(node);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ── 초기화: API 우선, fallback 로컬 ─────────── */
/* ── 갤러리 슬라이더 (scroll-snap 방식, JS 계산 없음) ── */
function initGallerySlider(items, artistName) {
  const sliderEl = document.getElementById("gallerySlider");
  const track    = document.getElementById("galleryTrack");
  const counter  = document.getElementById("galleryCounter");
  const btnPrev  = document.getElementById("galleryPrev");
  const btnNext  = document.getElementById("galleryNext");
  if (!track || !sliderEl) return;

  track.innerHTML = "";
  sliderEl.scrollLeft = 0;

  const perPage    = 4;
  const totalPages = Math.ceil(items.length / perPage);

  // 슬라이더: scroll-snap 방식 + flex item으로 패널 안에서 남은 공간 채움
  sliderEl.style.cssText = [
    "overflow-x:scroll",
    "scroll-snap-type:x mandatory",
    "scroll-behavior:smooth",
    "-webkit-overflow-scrolling:touch",
    "border-radius:14px",
    "background:#16122a",
    "width:100%",
    "flex:1",
    "min-height:0",
    // 스크롤바 숨기기
    "scrollbar-width:none",
    "-ms-overflow-style:none"
  ].join(";");

  // 페이지 생성 (track도 height 100%로 채움)
  track.style.cssText = "display:flex;width:100%;height:100%;";

  const pages = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));

  pages.forEach((pageItems, pageIdx) => {
    const page = document.createElement("div");
    page.style.cssText = "min-width:100%;width:100%;height:100%;flex-shrink:0;scroll-snap-align:start;";

    // 2x2 그리드 — height:100%로 패널 높이를 채움 (프로필과 자동 동기화)
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:8px;width:100%;height:100%;";

    pageItems.forEach((item, localIdx) => {
      const globalIdx = pageIdx * perPage + localIdx;
      const cell = document.createElement("div");
      cell.className = "gallery-slide";
      cell.setAttribute("data-lightbox", String(globalIdx));
      cell.style.cssText = "overflow:hidden;border-radius:10px;background:#1a1728;position:relative;cursor:pointer;";

      const img = document.createElement("img");
      img.src     = item.src;
      img.alt     = item.caption || "";
      img.loading = "eager";
      img.style.cssText = "width:100%;height:100%;object-fit:cover;object-position:center top;display:block;transition:transform 260ms ease;";
      img.onerror = () => {
        if (!img.dataset.retried) {
          img.dataset.retried = "1";
          img.src = item.src + (item.src.includes("?") ? "&" : "?") + "retry=1";
        }
      };
      img.addEventListener("mouseover",  () => { img.style.transform = "scale(1.05)"; });
      img.addEventListener("mouseout",   () => { img.style.transform = "scale(1)";    });

      const zoom = document.createElement("span");
      zoom.textContent = "⊕";
      zoom.style.cssText = "position:absolute;top:8px;right:8px;background:rgba(0,0,0,.55);color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;pointer-events:none;opacity:0;transition:opacity 180ms;";
      cell.addEventListener("mouseenter", () => { zoom.style.opacity = "1"; });
      cell.addEventListener("mouseleave", () => { zoom.style.opacity = "0"; });

      cell.appendChild(img);
      cell.appendChild(zoom);
      grid.appendChild(cell);
    });

    page.appendChild(grid);
    track.appendChild(page);
  });

  // 카운터/버튼 업데이트
  function updateUI() {
    const idx  = Math.round(sliderEl.scrollLeft / sliderEl.offsetWidth);
    const page = Math.max(0, Math.min(idx, totalPages - 1));
    const s    = page * perPage + 1;
    const e    = Math.min((page + 1) * perPage, items.length);
    if (counter) counter.textContent = s + "\u2013" + e + " / " + items.length;
    if (btnPrev) btnPrev.disabled = page === 0;
    if (btnNext) btnNext.disabled = page >= totalPages - 1;
  }

  sliderEl.addEventListener("scroll", updateUI, { passive: true });
  updateUI();

  if (btnPrev) btnPrev.addEventListener("click", () => {
    sliderEl.scrollBy({ left: -sliderEl.offsetWidth, behavior: "smooth" });
  });
  if (btnNext) btnNext.addEventListener("click", () => {
    sliderEl.scrollBy({ left: sliderEl.offsetWidth, behavior: "smooth" });
  });

  // 터치 스와이프 (scroll-snap이 이미 처리하지만 보험용)
  let sx = 0;
  sliderEl.addEventListener("touchstart", e => { sx = e.touches[0].clientX; }, { passive: true });
}

/* ── Encar식 라이트박스 ───────────────────────── */
function initLightbox(items, artistName) {
  // 기존 라이트박스 제거
  document.querySelectorAll(".encar-lightbox").forEach(el => el.remove());

  let currentIdx = 0;

  const lb = document.createElement("div");
  lb.className = "encar-lightbox";
  lb.innerHTML = `
    <button class="encar-close" aria-label="닫기">✕</button>
    <div class="encar-main">
      <button class="encar-prev" aria-label="이전">‹</button>
      <img class="encar-main-img" src="" alt="" />
      <div class="encar-caption"></div>
      <div class="encar-counter"></div>
      <button class="encar-next" aria-label="다음">›</button>
    </div>
    <div class="encar-thumbs">
      ${items.map((item, idx) => `
        <img class="encar-thumb" src="${item.src}" alt="${item.caption}" data-idx="${idx}" />
      `).join("")}
    </div>`;
  document.body.appendChild(lb);

  const mainImg  = lb.querySelector(".encar-main-img");
  const caption  = lb.querySelector(".encar-caption");
  const counter  = lb.querySelector(".encar-counter");
  const thumbs   = [...lb.querySelectorAll(".encar-thumb")];
  const thumbsEl = lb.querySelector(".encar-thumbs");
  const btnPrev  = lb.querySelector(".encar-prev");
  const btnNext  = lb.querySelector(".encar-next");

  // ══════════════════════════════════════════════
  // 라이트박스 줌/pan (마우스 휠 + 더블클릭 + 핀치 줌 + 드래그)
  // 1x ~ 4x, 더블클릭 1↔2.5 토글, 마우스 휠 / 핀치, 줌 상태에서 드래그 pan
  // ══════════════════════════════════════════════
  let zoomScale = 1;
  let panX = 0, panY = 0;
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;

  function applyTransform(animate = false) {
    mainImg.style.transition = animate ? "transform 220ms cubic-bezier(.2,.7,.3,1)" : "none";
    mainImg.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    mainImg.style.cursor = zoomScale > 1 ? (isPanning ? "grabbing" : "grab") : "zoom-in";
  }
  function resetZoom(animate = false) {
    zoomScale = 1;
    panX = 0;
    panY = 0;
    isPanning = false;
    applyTransform(animate);
  }

  // 더블클릭 토글 (포인터 위치 기준 줌)
  mainImg.addEventListener("dblclick", e => {
    e.preventDefault();
    if (zoomScale > 1) {
      resetZoom(true);
    } else {
      const rect = mainImg.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      zoomScale = 2.5;
      panX = -cx * (zoomScale - 1);
      panY = -cy * (zoomScale - 1);
      applyTransform(true);
    }
  });

  // 마우스 휠 줌 (포인터 위치 기준)
  mainImg.addEventListener("wheel", e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomScale + delta));
    if (newScale === zoomScale) return;
    const rect = mainImg.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const ratio = newScale / zoomScale;
    panX = cx + (panX - cx) * ratio;
    panY = cy + (panY - cy) * ratio;
    zoomScale = newScale;
    if (zoomScale === 1) { panX = 0; panY = 0; }
    applyTransform(true);
  }, { passive: false });

  // 마우스 pan (줌 상태에서)
  mainImg.addEventListener("mousedown", e => {
    if (zoomScale <= 1) return;
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    applyTransform(false);
  });
  window.addEventListener("mousemove", e => {
    if (!isPanning) return;
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    applyTransform(false);
  });
  window.addEventListener("mouseup", () => {
    if (isPanning) { isPanning = false; applyTransform(true); }
  });

  // 모바일 — 핀치 줌(2터치) + pan(1터치, 줌 상태)
  mainImg.addEventListener("touchstart", e => {
    if (e.touches.length === 2) {
      pinchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartScale = zoomScale;
    } else if (e.touches.length === 1 && zoomScale > 1) {
      isPanning = true;
      panStartX = e.touches[0].clientX - panX;
      panStartY = e.touches[0].clientY - panY;
    }
  }, { passive: true });
  mainImg.addEventListener("touchmove", e => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      zoomScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinchStartScale * (dist / pinchStartDist)));
      if (zoomScale === 1) { panX = 0; panY = 0; }
      applyTransform(false);
    } else if (isPanning && e.touches.length === 1) {
      e.preventDefault();
      panX = e.touches[0].clientX - panStartX;
      panY = e.touches[0].clientY - panStartY;
      applyTransform(false);
    }
  }, { passive: false });
  mainImg.addEventListener("touchend", e => {
    if (e.touches.length === 0) {
      isPanning = false;
      pinchStartDist = 0;
      applyTransform(true);
    }
  });

  function show(idx) {
    currentIdx = Math.max(0, Math.min(idx, items.length - 1));
    const item = items[currentIdx];
    mainImg.src = item.src;
    mainImg.alt = `${artistName} ${item.caption}`;
    caption.textContent = item.caption;
    counter.textContent = `${currentIdx + 1} / ${items.length}`;
    btnPrev.disabled = currentIdx === 0;
    btnNext.disabled = currentIdx === items.length - 1;
    // 썸네일 활성화 + 스크롤
    thumbs.forEach((t, i) => t.classList.toggle("is-active", i === currentIdx));
    const activThumb = thumbs[currentIdx];
    if (activThumb) {
      activThumb.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    // 이미지 바뀔 때마다 줌 리셋
    resetZoom(false);
    lb.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function close() {
    lb.classList.remove("is-open");
    document.body.style.overflow = "";
    resetZoom(false);
  }

  // 갤러리 슬라이드 클릭
  document.addEventListener("click", e => {
    const slide = e.target.closest(".gallery-slide[data-lightbox]");
    if (slide) show(+slide.dataset.lightbox);
  });

  // 썸네일 클릭
  thumbs.forEach(t => t.addEventListener("click", () => show(+t.dataset.idx)));

  lb.querySelector(".encar-close").addEventListener("click", close);
  btnPrev.addEventListener("click", () => show(currentIdx - 1));
  btnNext.addEventListener("click", () => show(currentIdx + 1));

  // 배경 클릭으로 닫기
  lb.querySelector(".encar-main").addEventListener("click", e => {
    if (e.target === lb.querySelector(".encar-main")) close();
  });

  // 키보드
  document.addEventListener("keydown", e => {
    if (!lb.classList.contains("is-open")) return;
    if (e.key === "Escape")      close();
    if (e.key === "ArrowLeft")   show(currentIdx - 1);
    if (e.key === "ArrowRight")  show(currentIdx + 1);
  });
}

/* 헤더 드롭다운(.user-menu-avatar) 안에 프로필 이미지 또는 기본 SVG placeholder 토글 */
function syncUserMenuAvatar() {
  const slot = document.querySelector("#userMenu .user-menu-avatar");
  if (!slot) return; // 메뉴가 아직 안 만들어졌으면 다음 toggleUserMenu에서 채워짐
  const user = getAuth()?.user || {};
  const avatarUrl = user.avatarUrl || user.avatarAsset?.url || "";
  if (avatarUrl) {
    const safe = String(avatarUrl).replace(/"/g, "&quot;");
    slot.innerHTML = `<img src="${safe}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;" onerror="this.outerHTML='<svg viewBox=&quot;0 0 24 24&quot; width=&quot;24&quot; height=&quot;24&quot; fill=&quot;currentColor&quot;><path d=&quot;M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z&quot;/></svg>'">`;
  } else {
    slot.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/></svg>`;
  }
}


/* ══════════════════════════════════════════════
   #083 — 콘텐츠 보호 UX (이미지 우클릭/드래그 방지) + 공유 버튼
   - 보안 보장 X. 백엔드 권한(#082)이 진짜 방어선.
   - 콘텐츠 영역 이미지에만 적용 (UI 아이콘/SVG 제외)
   ══════════════════════════════════════════════ */
function bindContentProtection() {
  if (typeof window === "undefined" || window.__contentProtectionBound) return;
  window.__contentProtectionBound = true;

  // 이미지 우클릭 방지 — 콘텐츠 영역 이미지에만 (selector로 한정)
  // selector는 실제 마크업 기준 (id selector + class selector 모두 포함)
  const protectedSelector = [
    ".catalog-media img", ".artist-media img", ".short-media img",
    ".detail-hero-card img", ".detail-short-media img",
    "[data-feed-asset]", "[data-feed-asset-group]", ".feed-post-assets", ".feed-post-asset-item", ".feed-post-asset-item img", ".feed-link-preview-thumb img",
    ".gallery-slide img",        // 포토 갤러리 슬라이드 (cell 안 img)
    "#galleryTrack img",         // 갤러리 트랙(id) 안 모든 img
    "#gallerySlider img",        // 갤러리 슬라이더(id) 안 모든 img
    ".encar-main-img",           // 라이트박스 메인 이미지
    ".encar-thumb",              // 라이트박스 하단 썸네일
    ".lightbox-overlay", ".lightbox-stage", ".lightbox-img",
    ".mypage-profile-image img"
  ].join(", ");
  document.addEventListener("contextmenu", e => {
    if (e.target.closest?.(protectedSelector)) e.preventDefault();
  }, { passive: false });
  // 드래그 시작 방지 (CSS user-drag와 함께 이중 보강)
  document.addEventListener("dragstart", e => {
    if (e.target.closest?.(protectedSelector)) e.preventDefault();
  }, { passive: false });
}

function bindShareButtons() {
  if (typeof window === "undefined" || window.__shareButtonsBound) return;
  window.__shareButtonsBound = true;

  // 공유 버튼 클릭 위임 (캐릭터 상세 + 추후 다른 페이지 확장)
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-share-character]");
    if (!btn) return;
    e.preventDefault();
    const slug = btn.dataset.shareCharacter;
    const url = `${window.location.origin}/character-detail.html?slug=${encodeURIComponent(slug)}`;
    const artist = getCharacterBySlug?.(slug);
    const title = artist ? `${artist.publicName} — Lumina Stage` : "Lumina Stage 아티스트";
    const text = artist?.summary || "Lumina Stage에서 확인해 보세요.";
    // Web Share API 우선 (모바일), 실패 시 클립보드 복사 fallback
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
    } catch {} // 사용자가 공유창 닫은 경우 등은 무시
    try {
      await navigator.clipboard.writeText(url);
      const original = btn.innerHTML;
      btn.classList.add("is-copied");
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>링크 복사됨`;
      setTimeout(() => {
        btn.classList.remove("is-copied");
        btn.innerHTML = original;
      }, 2000);
    } catch {
      alert(`링크를 복사하지 못했어요. 직접 복사해 주세요:\n${url}`);
    }
  });
}

function initCreatorStudioPage() {
  const root = document.querySelector(".page-creator-studio .studio-shell");
  if (!root || window.__creatorStudioBound) return;
  window.__creatorStudioBound = true;

  const navButtons = Array.from(root.querySelectorAll("[data-section]"));
  const sections = Array.from(root.querySelectorAll(".studio-section"));
  const toast = document.getElementById("studioToast");
  const modal = document.getElementById("studioModal");
  const modalTitle = document.getElementById("studioModalTitle");
  const modalType = document.getElementById("studioModalType");
  const modalMessage = document.getElementById("studioModalMessage");
  const modalSummary = document.getElementById("studioModalSummary");
  const modalClose = document.getElementById("studioModalClose");
  const modalCancel = document.getElementById("studioModalCancel");
  const modalConfirm = document.getElementById("studioModalConfirm");
  let toastTimer = null;

  const showStudioToast = message => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  };

  const activateSection = id => {
    if (!id || !sections.some(section => section.id === id)) return;
    navButtons.forEach(button => button.classList.toggle("is-active", button.dataset.section === id));
    sections.forEach(section => section.classList.toggle("is-active", section.id === id));
    history.replaceState(null, "", `#${id}`);
    root.querySelector(".studio-main")?.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  const setModalRows = rows => {
    if (!modalSummary) return;
    modalSummary.replaceChildren();
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      const key = document.createElement("strong");
      const val = document.createElement("span");
      key.textContent = label;
      val.textContent = value;
      row.append(key, val);
      modalSummary.append(row);
    });
  };

  const openStudioModal = ({ title, type = "Studio Stage", message, rows = [], confirmText = "확인" }) => {
    if (!modal) return;
    if (modalTitle) modalTitle.textContent = title;
    if (modalType) modalType.textContent = type;
    if (modalMessage) modalMessage.textContent = message;
    if (modalConfirm) modalConfirm.textContent = confirmText;
    setModalRows(rows);
    modal.classList.remove("is-hidden");
  };

  const closeStudioModal = () => modal?.classList.add("is-hidden");

  const openSettlementModal = () => {
    openStudioModal({
      title: "정산 신청 전 확인",
      message: "본인인증, 정산계좌, 세무 주소가 준비된 뒤 정산 신청을 진행할 수 있습니다.",
      rows: [
        ["예정 정산금", "128,400원"],
        ["본인인증", "확인 필요"],
        ["정산계좌", "등록 대기"],
        ["세무 주소", "첫 정산 시 1회 입력"]
      ],
      confirmText: "확인했습니다"
    });
  };

  const openImageRequestModal = () => {
    openStudioModal({
      title: "이미지 생성 요청",
      message: "요청 시 100L가 차감되고, 결과는 검토 후 커버, 썸네일, 갤러리, 숏폼 슬롯 중 하나로 연결합니다.",
      rows: [
        ["차감 루미나", "100L"],
        ["재조정", "최대 3회"],
        ["공개 방식", "결과 확인 후 운영자가 슬롯 지정"]
      ],
      confirmText: "요청하기"
    });
  };

  navButtons.forEach(button => {
    button.addEventListener("click", () => activateSection(button.dataset.section));
  });

  root.querySelectorAll("[data-section-jump]").forEach(button => {
    button.addEventListener("click", () => activateSection(button.dataset.sectionJump));
  });

  root.querySelectorAll("[data-action='toast']").forEach(button => {
    button.addEventListener("click", () => {
      const label = button.textContent.trim();
      if (label.includes("정산 신청")) {
        openSettlementModal();
        return;
      }
      if (label.includes("100L")) {
        openImageRequestModal();
        return;
      }
      if (label.includes("새 피드")) {
        activateSection("feed");
        showStudioToast("피드 작성 화면으로 이동했습니다.");
        return;
      }
      showStudioToast("입력 내용은 화면에 임시 저장됩니다. 실제 저장은 연결된 기능부터 순차 적용됩니다.");
    });
  });

  root.querySelectorAll("[data-action='tone']").forEach(button => {
    button.addEventListener("click", () => {
      const body = document.getElementById("feedBody");
      if (body) {
        body.value = "오늘은 조용히 준비한 만큼 정확하게 보여드릴게요. 무대 위의 한 장면이 오래 남도록, 작은 디테일까지 놓치지 않겠습니다.";
      }
      showStudioToast("선택한 아티스트 톤앤매너 예시로 변환했습니다.");
    });
  });

  [modalClose, modalCancel].forEach(button => button?.addEventListener("click", closeStudioModal));
  modal?.addEventListener("click", event => {
    if (event.target === modal) closeStudioModal();
  });
  modalConfirm?.addEventListener("click", () => {
    closeStudioModal();
    showStudioToast("확인되었습니다. 화면 상태에 반영했습니다.");
  });

  const initial = location.hash.replace("#", "");
  if (initial) activateSection(initial);
}

function markAppReady() {
  document.documentElement.classList.remove("is-booting");
  document.documentElement.classList.add("is-ready");
  document.body.classList.remove("is-booting");
  document.body.classList.add("is-ready");
}

async function init() {
  // #064 i18n — UI 깜빡임 최소화 위해 가장 먼저 실행 (비로그인 시 즉시, 로그인 시 서버 동기화 포함)
  await initI18n();

  // 🔥 인증 UI는 API 호출 전에 먼저 초기화 (await에 막히지 않게)
  createAuthModal();
  bindAuthHeaderEvents();
  updateAuthUI();
  activateCurrentNavItem(); // 현재 페이지 메뉴 자동 강조 (밑줄 표시)

  // #083 — 글로벌 이미지 보호 + 공유 버튼 핸들러 (1회만 바인드)
  bindContentProtection();
  bindShareButtons();

  // 이미 로그인 상태이면 잔액 미리 로드 (await 안 함 — 백그라운드)
  if (isLoggedIn()) loadWallet();
  if (typeof initMypagePage === "function") initMypagePage();
  initCreatorStudioPage();

  if (document.body.classList.contains("page-creator-studio")) {
    return;
  }

  // URL ?ref= 추천인 코드 자동 캡처 (있으면 localStorage 30일 보관)
  captureReferralFromURL();

  // 카카오 OAuth redirect 콜백 처리 (URL에 ?code=... 있으면)
  await handleKakaoCallback();
  // 네이버 OAuth redirect 콜백 처리 (URL에 ?code=... 있으면)
  await handleNaverCallback();

  // API 아티스트 — 안전망 추가: 응답이 형식 안 맞으면 로컬 데이터 유지
  const apiArtists = await apiFetch("/api/v1/artists");
  if (apiArtists && Array.isArray(apiArtists) && apiArtists.length > 0) {
    try {
      const adapted = apiArtists.map(adaptArtist);
      // 핵심 필드 검증 — 메인 캐릭터가 4명 이상 있어야 사용
      const valid = adapted.filter(a => a?.slug && a?.tier && a?.status && a?.images?.thumb);
      const mainCount = valid.filter(a => (a.tier === "main" || a.tier === "premium") && a.status === "public").length;
      if (mainCount >= 4) {
        const bySlug = new Map(adapted.map(a => [a.slug, a]));
        _artists = characters.map(local => bySlug.get(local.slug) || local);
        adapted.forEach(apiArtist => {
          if (!characters.some(local => local.slug === apiArtist.slug)) _artists.push(apiArtist);
        });
        console.info(`[Lumina] API 아티스트 ${_artists.length}명 로드됨 (메인 ${mainCount}명)`);
      } else {
        console.warn(`[Lumina] API 응답 불완전 (메인 캐릭터 ${mainCount}명) — 로컬 데이터 유지`);
      }
    } catch (err) {
      console.error("[Lumina] adaptArtist 에러 — 로컬 데이터 유지:", err);
    }
  } else {
    console.info("[Lumina] 로컬 데이터 사용 중 (API 응답 없음)");
  }

  // API 숏폼 — 같은 안전망
  const apiShortforms = await apiFetch("/api/v1/shortforms");
  if (apiShortforms && Array.isArray(apiShortforms) && apiShortforms.length > 0) {
    try {
      const adapted = apiShortforms.map(adaptShortform);
      // 핵심 필드 검증 — title과 artist가 있어야
      const valid = adapted.filter(s => s?.title && s?.artist);
      if (valid.length === adapted.length && valid.length > 0) {
        _shortforms = adapted;
        console.info(`[Lumina] API 숏폼 ${_shortforms.length}건 로드됨`);
      } else {
        console.warn(`[Lumina] API 숏폼 응답 불완전 (${valid.length}/${adapted.length} 유효) — 로컬 데이터 유지`);
      }
    } catch (err) {
      console.error("[Lumina] adaptShortform 에러 — 로컬 데이터 유지:", err);
    }
  }

  // 부스트 캠페인 + 랭킹 데이터 먼저 로드 (메인 카드를 좋아요 순으로 정렬하기 위해)
  // 실패해도 fallback으로 진행 — 메인 카드는 기본 순서로, 디테일은 좋아요 카운트 0으로 표시
  try {
    await loadBoostState();
  } catch (err) {
    console.warn("[Lumina] 부스트 상태 로드 실패 (정상 진행):", err);
  }

  if (typeof renderMainArtists === "function") renderMainArtists();
  if (typeof renderHeroFeature === "function") renderHeroFeature();
  if (typeof renderDebutLine === "function") renderDebutLine();
  if (typeof renderShortforms === "function") renderShortforms();
  if (typeof renderShortformHub === "function") renderShortformHub();
  if (typeof renderBusinessPackages === "function") renderBusinessPackages();
  if (typeof renderRoster === "function") renderRoster();
  if (typeof renderCharacterCatalog === "function") renderCharacterCatalog();
  if (typeof bindCharacterFilters === "function") bindCharacterFilters();
  if (typeof renderCharacterDetail === "function") renderCharacterDetail();
  if (typeof bindArtistDetailFollow === "function") bindArtistDetailFollow(); // #150 — 아티스트 상세 팔로우 버튼
  bindCardNavigation();
  bindLikeButtons();
  initScrollReveal();

  // 루미나 픽 페이지면 추가 초기화 (탭 전환 + Monthly Pick / Cheer Race / Hall of Fame 렌더)
  if (document.getElementById("voteTabs")) {
    initPopularVotePage();
  }

  // 루미나 피드 페이지면 임시 샘플 포스트 렌더 + 필터 탭 바인딩
  // 운영 API → samples API → inline 3단 fallback (#022, 차모 fallback API 활용)
  if (document.getElementById("luminaFeedList")) {
    await loadLuminaFeedData();
    initLuminaFeedSidebar();
    bindLuminaFeedSearch();
    initLuminaFeedDiscovery();
    renderLuminaFeed();
    bindLuminaFeedTabs();
    bindLuminaFeedExpand();
    bindLuminaFeedDelete();
    bindLuminaFeedEdit(); // #137 Phase B — 피드 글 수정 모달
    bindLuminaFeedLike(); // #137 Phase A — 피드 좋아요 토글
    bindLuminaFeedComment();
    bindLuminaFeedFollow(); // #145 — 피드 카드 팔로우/언팔로우
    bindFeedAssetLightbox(); // 피드 이미지 라이트박스 + 우클릭 차단
    // #056: 피드 작성창 (로그인 시 노출, 이미지 4장 첨부 + 업로드 흐름)
    initFeedCompose();
  }

  // #057: 충전소 페이지 (charge.html)
  if (document.getElementById("chargePageContent") || document.getElementById("chargeLoginGate")) {
    if (typeof initChargePage === "function") await initChargePage();
  }

  // #152 — 일반 유저 공개 프로필 페이지 (user-profile.html)
  if (document.getElementById("userProfileCard")) {
    await initUserProfilePage();
  }
}

/* ── Scroll Reveal — 섹션이 시야에 들어올 때 부드럽게 등장 ─────── */
function initScrollReveal() {
  // 섹션 헤딩은 통째로 fade-up
  const headings = document.querySelectorAll(".section-heading, .page-hero-copy, .page-hero-panel, .premium-copy, .premium-panel, .business-copy-row, .coming-grid > *, .hero-copy, .hero-visual");
  headings.forEach(el => el.classList.add("reveal-on-scroll"));

  // 카드 그리드는 자식들이 stagger로 순차 등장
  const grids = document.querySelectorAll(".artist-grid, .debut-line-grid, .shortform-grid, .feed-grid, .roster-grid, .package-grid");
  grids.forEach(el => el.classList.add("reveal-on-scroll", "reveal-stagger"));

  // IntersectionObserver 미지원 브라우저는 즉시 표시
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".reveal-on-scroll").forEach(el => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });

  document.querySelectorAll(".reveal-on-scroll").forEach(el => observer.observe(el));
}

/* ════════════════════════════════════════════════════════════
   미니 프로필 모달 (#152, 클라우드 시안 2026-05-06)
   - 피드 작성자 클릭 시 에밀리가 fetchUserProfile() 후 openMiniProfileModal(data) 호출
   - data 형식: { user: {...}, viewer: {...} } (차모 spec 3fa2600)
   - 본인이면 팔로우 버튼 숨김 + "내 프로필 보기" 텍스트
   - 상세 보기 → user-profile.html?handle=...
   ════════════════════════════════════════════════════════════ */
(function injectMiniProfileModal() {
  if (document.getElementById("miniProfileModal")) return;
  const tpl = `
    <div class="mini-profile-modal" id="miniProfileModal" hidden aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="miniProfileName">
      <div class="mini-profile-backdrop" data-mini-profile-close></div>
      <div class="mini-profile-card">
        <div class="mini-profile-cover" id="miniProfileCover"></div>
        <button class="mini-profile-close-btn" type="button" data-mini-profile-close aria-label="닫기">×</button>
        <div class="mini-profile-avatar" id="miniProfileAvatar">
          <span class="mini-profile-avatar-fallback" id="miniProfileAvatarFallback">?</span>
        </div>
        <div class="mini-profile-meta">
          <h3 class="mini-profile-name" id="miniProfileName" data-i18n="miniProfile.loading">로딩 중…</h3>
          <p class="mini-profile-handle" id="miniProfileHandle"></p>
        </div>
        <div class="mini-profile-actions">
          <button class="mini-profile-follow-btn" id="miniProfileFollowBtn" type="button" data-mini-follow hidden>
            <span data-mini-follow-label data-i18n="miniProfile.follow">팔로우</span>
          </button>
          <a class="mini-profile-detail-btn" id="miniProfileDetailBtn" href="#" data-i18n="miniProfile.detail">상세 프로필 보기 →</a>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", tpl);
})();

document.addEventListener("click", e => {
  if (e.target.closest("[data-mini-profile-close]")) {
    closeMiniProfileModal();
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    const modal = document.getElementById("miniProfileModal");
    if (modal && !modal.hidden) closeMiniProfileModal();
  }
});

function openMiniProfileModal(profileData) {
  const modal = document.getElementById("miniProfileModal");
  if (!modal) return;
  const user = profileData?.user || {};
  const viewer = profileData?.viewer || {};

  // 이름·핸들
  const nameEl = document.getElementById("miniProfileName");
  const handleEl = document.getElementById("miniProfileHandle");
  if (nameEl) nameEl.textContent = user.displayName || "이름 없음";
  if (handleEl) handleEl.textContent = user.publicHandle ? `@${user.publicHandle}` : "";

  // 아바타
  const avatar = document.getElementById("miniProfileAvatar");
  const fallback = document.getElementById("miniProfileAvatarFallback");
  if (avatar) {
    avatar.querySelectorAll("img").forEach(n => n.remove());
    if (user.avatarUrl) {
      const img = document.createElement("img");
      img.src = user.avatarUrl;
      img.alt = user.displayName || "";
      img.onerror = () => { img.remove(); if (fallback) fallback.style.display = "flex"; };
      avatar.insertBefore(img, fallback);
      if (fallback) fallback.style.display = "none";
    } else if (fallback) {
      fallback.style.display = "flex";
      fallback.textContent = (user.displayName || "?").charAt(0).toUpperCase();
    }
  }

  // 커버
  const cover = document.getElementById("miniProfileCover");
  if (cover) {
    if (user.coverImageUrl) {
      cover.style.backgroundImage = `url('${String(user.coverImageUrl).replace(/'/g, "%27")}')`;
    } else {
      cover.style.backgroundImage = "";
    }
  }

  // 팔로우 버튼 (본인이면 숨김)
  const followBtn = document.getElementById("miniProfileFollowBtn");
  if (followBtn) {
    if (viewer.isSelf) {
      followBtn.hidden = true;
    } else if (viewer.canFollow || viewer.canUnfollow || viewer.isFollowing) {
      followBtn.hidden = false;
      followBtn.dataset.userId = user.id || "";
      applyMiniProfileFollowState(viewer);
    } else {
      followBtn.hidden = true;
    }
  }

  // 상세 보기 → user-profile.html
  const detailBtn = document.getElementById("miniProfileDetailBtn");
  if (detailBtn) {
    if (user.publicHandle) {
      detailBtn.href = `./user-profile.html?handle=${encodeURIComponent(user.publicHandle)}`;
    } else if (user.id) {
      detailBtn.href = `./user-profile.html?id=${encodeURIComponent(user.id)}`;
    } else {
      detailBtn.href = "#";
    }
    detailBtn.textContent = viewer.isSelf ? "내 프로필 보기 →" : "상세 프로필 보기 →";
  }

  // 모달 열기
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeMiniProfileModal() {
  const modal = document.getElementById("miniProfileModal");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function applyMiniProfileFollowState(viewer) {
  const followBtn = document.getElementById("miniProfileFollowBtn");
  if (!followBtn) return;
  const followLabel = followBtn.querySelector("[data-mini-follow-label]");
  const isFollowing = !!(viewer?.isFollowing || viewer?.canUnfollow);
  followBtn.classList.toggle("is-following", isFollowing);
  followBtn.dataset.following = isFollowing ? "1" : "0";
  followBtn.setAttribute("aria-pressed", isFollowing ? "true" : "false");
  followBtn.setAttribute("aria-label", isFollowing ? "팔로잉 해제" : "팔로우");
  followBtn.title = isFollowing ? "팔로잉 해제" : "팔로우";
  if (followLabel) followLabel.textContent = isFollowing ? "팔로잉 해제" : "팔로우";
}

function bindMiniProfileFollow() {
  if (document._miniProfileFollowBound) return;
  document._miniProfileFollowBound = true;
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-mini-follow]");
    if (!btn || btn.hidden) return;
    e.preventDefault();
    if (btn.dataset.busy === "1") return;
    if (typeof getAccessToken === "function" && !getAccessToken()) {
      alert("로그인 후 팔로우할 수 있어요.");
      return;
    }
    const userId = btn.dataset.userId;
    if (!userId) return;
    const wasFollowing = btn.dataset.following === "1";
    btn.dataset.busy = "1";
    applyMiniProfileFollowState({ isFollowing: !wasFollowing });
    try {
      const res = await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        auth: true,
        throwOnError: true
      });
      if (res?.viewer) {
        applyMiniProfileFollowState(res.viewer);
      }
    } catch (err) {
      applyMiniProfileFollowState({ isFollowing: wasFollowing });
      console.warn("[#179 mini profile follow] 실패", { status: err?.status, body: err?.body });
      alert(err?.message || "팔로우 처리에 실패했어요.");
    } finally {
      btn.dataset.busy = "0";
    }
  });
}

window.openMiniProfileModal = openMiniProfileModal;
window.closeMiniProfileModal = closeMiniProfileModal;
bindMiniProfileFollow();

init().catch(err => {
  console.error("[Lumina] init failed:", err);
}).finally(markAppReady);
