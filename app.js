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
  initMypagePage();
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
    initMypagePage();
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
        <strong>${formatMypageNumber ? formatMypageNumber(balance) : Number(balance || 0).toLocaleString("ko-KR")}L</strong>
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
        window.location.href = _creatorStudioAccess?.entryUrl || "./creator-studio.html";
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

/* ── 캐릭터 마스터 데이터 (로컬 fallback) ─────
   role + artistDescription → mainArtists 배열 제거 후 통합
   ─────────────────────────────────────────── */
const characters = [
  {
    name: "윤세린", publicName: "윤세린", slug: "yoon-serin",
    gender: "female", type: "아티스트", tier: "main", status: "public",
    role: "대표 비주얼",
    artistDescription: "첫 조명이 켜지는 순간까지 흔들리지 않을게요. 차갑게 등장해서, 오래 남겠습니다.",
    summary: "차갑게 등장해, 오래 남는 뮤즈.",
    fandom: "강한 비주얼 입덕형",
    business: "뷰티, 향수, 패션 필름",
    tags: ["시크", "퍼포먼스", "뷰티"],
    colorAccent: "#c4b0f0",
    images: { cover: "./assets/characters/yoon-serin/cover.png", thumb: "./assets/characters/yoon-serin/thumb.png" },
    intro: "서울 강남에서 태어난 윤세린은 열 살 때 우연히 참가한 뮤직비디오 오디션을 계기로 아역모델로 데뷔했다. 또래보다 훨씬 강한 눈빛과 타고난 무대 감각으로 현장에서 빠르게 이름을 알렸고, 중학교 2학년 재학 중 스타에이 엔터테인먼트 연습생으로 선발되며 본격적인 아티스트의 길을 걷기 시작했다. 2년간의 혹독한 훈련을 거치며 퍼포먼스와 비주얼 양면에서 정제된 무기를 갖추게 됐고, 이후 Lumina Stage 1기 메인 대표로 데뷔했다.",
    concept: "차갑게 보이는 순간에도 저는 무대를 향해 가장 뜨겁게 준비하고 있어요. 흔들리지 않는 시선과 정제된 퍼포먼스로, 한 번 본 사람의 기억에 오래 남는 아티스트가 되겠습니다.",
    profile: {
      생년월일: "2001년 3월 14일 (만 25세)",
      출신지: "서울 강남구",
      신체: "169cm",
      혈액형: "A형",
      포지션: "메인 비주얼 / 퍼포먼스 센터",
      데뷔: "2024년 Lumina Stage 1기",
      캐릭터타입: "시크 퍼포먼스형",
      팬덤명: "Serinist",
      팬포인트: "차가운 시선, 절제된 표정, 무대 위 집중력",
      시그니처: "커스텀 인이어 · 와인 퍼플 마이크 · 슬림 이어커프",
      광고축: "뷰티 · 향수 · 패션 필름",
      대표컬러: "Deep Plum / Black Purple",
      MBTI: "INTJ",
      취미: "영화 감상, 향수 수집, 새벽 드라이브",
      좋아하는선물: "블랙 로즈, 니치 향수, 무대 조명"
    },
    shorts: [{ title: "메인 비주얼 티저", metric: "조회 12.4만" }, { title: "콘셉트 퍼포먼스", metric: "조회 11.8만" }, { title: "뷰티 무드 컷", metric: "저장 4.2천" }]
  },
  {
    name: "한서율", publicName: "한서율", slug: "han-seoyul",
    gender: "female",
    type: "아티스트", tier: "main", status: "public",
    role: "센터 확장",
    artistDescription: "센터에 서면 혼자 빛나는 게 아니라 모두의 표정이 같이 살아나요. 오늘도 같이 무대에 올라요.",
    summary: "센터에서 모두를 더 빛나게.",
    fandom: "대중형 확장형",
    business: "패션, 음료, 라이프스타일",
    tags: ["센터", "하이틴", "대중성"],
    colorAccent: "#f0a8cc",
    images: { cover: "./assets/characters/han-seoyul/cover.png", thumb: "./assets/characters/han-seoyul/thumb.png" },
    intro: "경기도 분당에서 자란 한서율은 중학교 시절 전국 청소년 댄스 대회에서 2연패를 달성하며 일찌감치 재능을 증명했다. 아이디어엠 공개 오디션 최종 합격 후 1년간 트레이닝을 마치고 Lumina Stage 1기로 합류했다. 센터에 서는 순간 공간 전체를 밝히는 반짝임이 있고, 어떤 팀원과 붙어도 자연스럽게 분위기를 끌어올리는 무드메이커 기질이 타고났다.",
    concept: "센터에 서는 이유는 혼자 빛나기 위해서가 아니에요. 제 옆에 선 사람들, 저를 바라봐주는 팬들까지 함께 환해지는 무대를 만들겠습니다.",
    profile: {
      생년월일: "2003년 6월 22일 (만 22세)",
      출신지: "경기도 성남시 분당구",
      신체: "166cm",
      혈액형: "O형",
      포지션: "메인 아이돌 / 럭셔리 러블리 센터",
      데뷔: "2024년 Lumina Stage 1기",
      캐릭터타입: "화사한 센터형 아이돌",
      팬덤명: "Yulight",
      팬포인트: "밝은 정면 비주얼, 무대 위 균형감, 팬서비스 감각",
      시그니처: "샴페인 핑크 리본 마이크 · 글리터 헤어핀 · 센터 포즈",
      광고축: "뷰티 · 음료 · 라이프스타일 · 팬미팅 콘텐츠",
      대표컬러: "Champagne Pink / Soft Gold",
      MBTI: "ENFJ",
      취미: "배드민턴, 카페 투어, 그림 그리기",
      좋아하는선물: "핑크 튤립, 손편지, 리본 액세서리, 달콤한 디저트"
    },
    shorts: [{ title: "센터 무드 스냅", metric: "조회 9.7만" }, { title: "하이틴 센터 포맷", metric: "조회 10.1만" }, { title: "팬서비스 포토무드", metric: "좋아요 2.8만" }]
  },
  {
    name: "박도아", publicName: "박도아", slug: "park-doa",
    gender: "female",
    type: "엔터테이너", tier: "main", status: "public",
    role: "팬 소통형",
    artistDescription: "화려하게 꾸미지 않아도 괜찮아요. 오늘 있었던 얘기부터 맛있는 한 입까지, 편하게 나눌게요.",
    summary: "솔직하고 편하게, 자주 보고 싶은 사람.",
    fandom: "댓글·호감 전환형",
    business: "푸드, 라이프, 커머스",
    tags: ["친근함", "리액션", "생활형"],
    colorAccent: "#f0c870",
    images: { cover: "./assets/characters/park-doa/cover.png", thumb: "./assets/characters/park-doa/thumb.png" },
    intro: "부산 해운대 출신 박도아는 고등학교 1학년 때 시작한 틱톡 계정이 6개월 만에 팔로워 12만을 돌파하며 자신의 가능성을 직접 증명했다. 먹방, 리액션, 일상 브이로그를 자유롭게 오가는 콘텐츠 감각과 부산 특유의 직설적인 입담이 팬들의 마음을 사로잡았다.",
    concept: "멀리 있는 스타보다 오늘도 편하게 말 걸 수 있는 사람이 되고 싶어요. 웃긴 순간도, 솔직한 하루도, 팬들과 가장 가까운 온도로 나누겠습니다.",
    profile: {
      생년월일: "2002년 11월 5일 (만 23세)",
      출신지: "부산 해운대구",
      신체: "163cm",
      혈액형: "B형",
      포지션: "커뮤니티 훅 / 리액션 스트리머",
      데뷔: "2024년 Lumina Stage 1기",
      캐릭터타입: "생활형 소통 스트리머",
      팬덤명: "Doable",
      팬포인트: "즉흥 리액션, 솔직한 말투, 가까운 친구 같은 친근함",
      시그니처: "코랄 후디 · 미니 먹방 테이블 · 반달 눈웃음",
      광고축: "푸드 · 커머스 · 라이프 · 댓글형 숏폼",
      대표컬러: "Warm Coral / Cream Orange",
      MBTI: "ESFP",
      취미: "먹방 촬영, 독서, 바다 수영",
      좋아하는선물: "지역 간식, 귀여운 머그컵, 코랄빛 소품, 편한 담요"
    },
    shorts: [{ title: "친근 리액션 포맷", metric: "조회 15.3만" }, { title: "생활형 브이로그컷", metric: "댓글 1.1천" }, { title: "먹방 리액션 티저", metric: "저장 3.7천" }]
  },
  {
    name: "최서진", publicName: "최서진", slug: "choi-seojin",
    gender: "female",
    type: "배우", tier: "premium", status: "public",
    role: "프리미엄 간판",
    artistDescription: "많이 말하지 않아도 장면은 남습니다. 한 컷의 온도로 오래 기억되겠습니다.",
    summary: "조용한 무게감, 한 장의 화보.",
    fandom: "프리미엄 선망형",
    business: "주얼리, 럭셔리 뷰티, 에디토리얼",
    tags: ["럭셔리", "에디토리얼", "프리미엄"],
    colorAccent: "#a0bce8",
    images: { cover: "./assets/characters/choi-seojin/cover.png", thumb: "./assets/characters/choi-seojin/thumb.png" },
    intro: "서울 용산에서 태어난 최서진은 여덟 살 때 아역배우로 첫 스크린을 밟았다. 성장하면서 자연스럽게 패션·뷰티 모델로 영역을 넓혔고, 파리 아르떼 에콜 교환학생으로 선발되어 유럽 예술·패션 씬을 직접 경험했다. Lumina Stage에서는 프리미엄 라인의 간판을 맡아 스튜디오 전체의 품격을 책임진다.",
    concept: "많이 말하지 않아도 장면은 남는다고 믿습니다. 한 컷의 시선, 한 번의 침묵까지 품격 있게 쌓아 최서진이라는 이름의 무드를 완성하겠습니다.",
    profile: {
      생년월일: "1999년 1월 28일 (만 27세)",
      출신지: "서울 용산구",
      신체: "172cm",
      혈액형: "AB형",
      포지션: "프리미엄 메인 / 배우",
      데뷔: "2024년 Lumina Stage 1기",
      캐릭터타입: "럭셔리 에디토리얼 배우형",
      팬덤명: "Seojin Atelier",
      팬포인트: "절제된 표정, 성숙한 분위기, 한 컷으로 남는 존재감",
      시그니처: "블랙 드레스 · 골드 드롭 이어링 · 필름 카메라",
      광고축: "주얼리 · 시계 · 럭셔리 뷰티 · 에디토리얼",
      대표컬러: "Black Gold / Champagne Beige",
      MBTI: "INFJ",
      취미: "현대미술 관람, 와인 페어링, 필름 카메라",
      좋아하는선물: "니치 향수, 블랙 다이어리, 골드 북마크, 전시 티켓"
    },
    shorts: [{ title: "에디토리얼 컷 무드", metric: "조회 6.2만" }, { title: "럭셔리 화보 티저", metric: "저장 2.1천" }, { title: "브랜드 무드 필름", metric: "완주율 68%" }]
  },
  {
    name: "오혜린", publicName: "오혜린", slug: "oh-hyerin",
    gender: "female",
    type: "아티스트", tier: "sub", status: "debut",
    role: "감성 보컬",
    artistDescription: "말보다 먼저 닿는 목소리가 있다고 믿어요. 제 첫 곡이 당신의 하루 끝에 머물렀으면 해요.",
    summary: "청아한 목소리로 마음에 머무는 보컬.",
    fandom: "감성 몰입형", business: "음향, 감성 캠페인, 뷰티",
    tags: ["보컬", "감성", "청아함"],
    colorAccent: "#a8d8f0",
    images: { cover: "./assets/characters/oh-hyerin/cover.png", thumb: "./assets/characters/oh-hyerin/thumb.png" },
    intro: "오혜린은 청아한 보컬과 섬세한 감정선으로 먼저 기억되는 아이돌 라인이다. 큰 제스처보다 작은 떨림, 높은 음보다 오래 남는 숨결로 팬의 마음에 닿는다.",
    concept: "큰 소리보다 오래 남는 목소리가 되고 싶어요. 누군가의 하루 끝에 조용히 머무는 노래로, 제 진심을 천천히 전하겠습니다.",
    profile: {
      생년월일: "2004년 2월 19일 (만 22세)",
      출신지: "대전 유성구",
      신체: "164cm",
      혈액형: "A형",
      포지션: "서브 아이돌 / 감성 보컬",
      데뷔: "2026년 Lumina Stage 공개 예정",
      캐릭터타입: "새벽 감성 보컬형",
      팬덤명: "Hyerin Note",
      팬포인트: "청아한 음색, 조용한 위로, 섬세한 감정선",
      시그니처: "페일 라벤더 마이크 · 작은 다이어리 · 이어커프",
      광고축: "발라드 · 음원 커버 · 팬레터 · 감성 뷰티",
      대표컬러: "Pale Lavender / Moon White",
      MBTI: "INFP",
      취미: "새벽 산책, 손글씨 노트, 어쿠스틱 플레이리스트 만들기",
      좋아하는선물: "라벤더 향초, 편지지, 작은 오르골, 따뜻한 차"
    },
    shorts: [{ title: "첫 보컬 무드", metric: "공개 대기" }]
  },
  {
    name: "민채온", publicName: "민채온", slug: "min-chaeon",
    gender: "female",
    type: "아티스트", tier: "candidate", status: "secret",
    role: "피트니스 아이돌",
    artistDescription: "웃을 땐 말랑하지만 무대에 서면 에너지가 달라져요. 귀여움 뒤의 탄탄한 반전을 보여줄게요.",
    summary: "러블리한 얼굴, 건강한 반전 에너지.",
    fandom: "직관적 매력 소비형", business: "피트니스, 스포츠 뷰티, 라이프스타일",
    tags: ["피트니스", "러블리", "반전매력"],
    colorAccent: "#f0b0c0",
    images: { cover: "./assets/characters/min-chaeon/cover.png", thumb: "./assets/characters/min-chaeon/thumb.png" },
    intro: "민채온은 러블리한 첫인상과 탄탄한 에너지가 공존하는 피트니스형 아이돌이다. 가벼운 미소로 다가오지만, 무대 위에서는 리듬과 체력으로 시선을 붙잡는다.",
    concept: "귀엽게 웃는 모습 뒤에 숨겨둔 힘을 무대에서 보여드릴게요. 가볍게 시작해도 끝까지 단단하게 버티는 에너지로 제 이름을 증명하겠습니다.",
    profile: {
      생년월일: "2003년 9월 8일 (만 22세)",
      출신지: "경기도 고양시",
      신체: "165cm",
      혈액형: "O형",
      포지션: "피트니스 아이돌",
      데뷔: "Lumina Stage 확장 후보",
      캐릭터타입: "러블리 피트니스 반전형",
      팬덤명: "Chaeon Fit",
      팬포인트: "귀여운 첫인상, 탄탄한 에너지, 무대 위 반전 집중력",
      시그니처: "파스텔 트레이닝 밴드 · 하트 물병 · 포니테일 리본",
      광고축: "피트니스 · 스포츠 뷰티 · 밝은 라이프스타일",
      대표컬러: "Peach Pink / Active Mint",
      MBTI: "ESFJ",
      취미: "필라테스, 스무디 레시피 만들기, 운동복 코디",
      좋아하는선물: "스포츠 타월, 복숭아 향 바디미스트, 리본 헤어밴드, 단백질 쿠키"
    },
    shorts: [{ title: "피트니스 스냅", metric: "공개 대기" }]
  },
  {
    name: "차도현", publicName: "차도현", slug: "cha-dohyun",
    gender: "male",
    type: "아티스트", tier: "sub", status: "public",
    role: "젠더리스 패션",
    artistDescription: "패션은 갑옷이고 무대는 제 언어예요. 어떤 옷을 입어도 결국 가장 저답게 서겠습니다.",
    summary: "하이패션으로 무대를 장악하는 젠더리스 아티스트.",
    fandom: "아티스트 팬덤형",
    business: "하이패션, 매거진 화보, 스트릿 럭셔리",
    tags: ["하이패션", "젠더리스", "아티스트"],
    colorAccent: "#9090d0",
    images: { cover: "./assets/characters/cha-dohyun/cover.png", thumb: "./assets/characters/cha-dohyun/thumb.png" },
    intro: "슬림한 실루엣과 날카로운 눈매, 체인과 진주 레이어링이 트레이드마크. 하이패션과 K-pop 아티스트성을 동시에 구현하는 Lumina Stage 첫 번째 남성 아티스트다. 성별을 초월한 스타일링과 무대 퍼포먼스로 장르의 경계를 무너뜨린다.",
    concept: "제게 패션은 갑옷이고 무대는 언어입니다. 어떤 스타일을 입어도 결국 가장 저답게 서서, 경계를 넘는 아티스트가 되겠습니다.",
    profile: {
      생년월일: "2000년 10월 2일 (만 25세)",
      출신지: "서울 성수동",
      신체: "181cm",
      혈액형: "A형",
      포지션: "젠더리스 패션 아티스트",
      데뷔: "2026년 Lumina Stage 초기 공개",
      캐릭터타입: "하이패션 퍼포머형",
      팬덤명: "Dohyverse",
      팬포인트: "날카로운 눈매, 경계를 넘는 스타일링, 조용한 자기 확신",
      시그니처: "체인 초커 · 진주 레이어링 · 블랙 레더 장갑",
      광고축: "하이패션 · 매거진 화보 · 스트릿 럭셔리",
      대표컬러: "Midnight Violet / Silver Black",
      MBTI: "INFP",
      취미: "빈티지 패션 수집, 드로잉, 전시 탐방",
      좋아하는선물: "실버 링, 흑백 필름, 아트북, 빈티지 브로치"
    },
    shorts: [{ title: "하이패션 화보 티저", metric: "공개 중" }, { title: "스트릿 룩북", metric: "조회 8.1만" }]
  },
  {
    name: "강시아", publicName: "강시아", slug: "kang-sia",
    gender: "female",
    type: "모델", tier: "candidate", status: "secret",
    role: "도시형 라이프스타일",
    artistDescription: "애써 꾸미지 않아도 시선이 머무는 사람이 있어요. 도시의 오후처럼 담담하고 세련되게 남겠습니다.",
    summary: "도시의 오후를 닮은 에포트리스 시크.",
    fandom: "라이프스타일 선망형", business: "향수, 데님, 도시 라이프스타일",
    tags: ["시크", "내추럴", "라이프스타일"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/kang-sia/cover.png", thumb: "./assets/characters/kang-sia/thumb.png" },
    intro: "강시아는 향수, 데님, 카페의 온도가 어울리는 도시형 모델이다. 과한 포즈 대신 자연스러운 시선과 걷는 리듬으로 라이프스타일의 선망을 만든다.", concept: "애써 꾸미지 않아도 시선이 머무는 사람이 되고 싶어요. 도시의 오후처럼 담담하지만 오래 남는 분위기로 제 장면을 만들겠습니다.",
    profile: {
      생년월일: "2001년 9월 17일 (만 24세)",
      출신지: "서울 마포구 연남동",
      신체: "170cm",
      혈액형: "A형",
      포지션: "도시형 라이프스타일 모델",
      데뷔: "Lumina Stage 확장 후보",
      캐릭터타입: "에포트리스 시크 모델형",
      팬덤명: "Sia Hours",
      팬포인트: "자연스러운 시선, 담담한 세련미, 보조개가 남기는 여운",
      시그니처: "화이트 셔츠 · 빈티지 데님 · 무광 실버 이어링",
      광고축: "향수 · 데님 · 도시 라이프스타일 · 카페 화보",
      대표컬러: "Ivory Denim / City Gray",
      MBTI: "ISFP",
      취미: "동네 카페 기록, 필름 사진, 빈티지 숍 산책",
      좋아하는선물: "무향 핸드크림, 필름롤, 데님 키링, 작은 화병"
    },
    shorts: [{ title: "시티 무드 스냅", metric: "비공개 라인" }]
  },
  {
    name: "이지원", publicName: "이지원", slug: "lee-jiwon",
    gender: "female",
    type: "배우", tier: "candidate", status: "secret",
    role: "쿨한 톱스타",
    artistDescription: "흔들리지 않는 시선으로 장면을 밀고 나가요. 말보다 먼저 분위기가 도착하는 배우입니다.",
    summary: "쿨한 아우라로 장면을 장악하는 배우.",
    fandom: "선망형", business: "자동차, 테크, 액션 화보",
    tags: ["톱스타", "쿨함", "액션"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/lee-jiwon/cover.png", thumb: "./assets/characters/lee-jiwon/thumb.png" },
    intro: "이지원은 긴 흑발과 차가운 아우라로 액션, 테크, 자동차 캠페인에 어울리는 배우형 아티스트다. 감정을 크게 드러내지 않아도 장면의 긴장을 끝까지 붙잡는다.", concept: "쉽게 흔들리지 않는 눈빛으로 장면을 끝까지 밀고 가겠습니다. 말보다 분위기로 먼저 도착하는 배우가 되겠습니다.",
    profile: {
      생년월일: "1998년 8월 17일 (만 27세)",
      출신지: "서울 송파구",
      신체: "171cm",
      혈액형: "B형",
      포지션: "쿨 톱스타 배우",
      데뷔: "Lumina Stage 확장 후보",
      캐릭터타입: "액션 톱스타 배우형",
      팬덤명: "Jiwon Drive",
      팬포인트: "흔들리지 않는 눈빛, 차가운 아우라, 장면을 밀고 가는 힘",
      시그니처: "화이트 티셔츠 · 블랙 선글라스 · 실버 카 키링",
      광고축: "자동차 · 테크 · 액션 화보 · 프리미엄 캐주얼",
      대표컬러: "Cool White / Asphalt Black",
      MBTI: "ISTP",
      취미: "야간 드라이브, 액션 영화 분석, 러닝",
      좋아하는선물: "메탈 키링, 블랙 캡, 무선 이어폰 케이스, 시네마 티켓"
    },
    shorts: [{ title: "액션 무드 컷", metric: "비공개 라인" }]
  },
  {
    name: "하윤아", publicName: "하윤아", slug: "ha-yuna",
    gender: "female",
    type: "모델", tier: "main", status: "public",
    role: "SNS 스트릿 뷰티",
    artistDescription: "오늘의 색은 제가 정할게요. 스트릿의 속도와 비비드한 자신감으로 피드를 물들입니다.",
    summary: "비비드한 컬러로 피드를 바꾸는 스트릿 뷰티.",
    fandom: "트렌드 팔로워형", business: "스트릿 패션, 색조 뷰티, Y2K",
    tags: ["스트릿", "뷰티", "트렌드"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/ha-yuna/cover.png", thumb: "./assets/characters/ha-yuna/thumb.png" },
    intro: "하윤아는 고양이상 눈매와 비비드한 컬러 감각을 가진 스트릿 뷰티 모델이다. 빠르게 지나가는 숏폼 피드 안에서도 한 번 더 보게 만드는 트렌드 감도를 지녔다.", concept: "오늘의 색과 흐름은 제가 먼저 정해볼게요. 빠르게 지나가는 피드 안에서도 다시 멈춰 보게 만드는 존재가 되겠습니다.",
    profile: {
      생년월일: "2004년 4월 3일 (만 22세)",
      출신지: "서울 홍대",
      신체: "168cm",
      혈액형: "AB형",
      포지션: "SNS 스트릿 뷰티 모델",
      데뷔: "Lumina Stage 확장 후보",
      캐릭터타입: "비비드 스트릿 트렌드형",
      팬덤명: "Yunatic",
      팬포인트: "고양이상 눈매, 빠른 트렌드 감각, 비비드한 자신감",
      시그니처: "슬릭백 헤어 · 네온 네일 · 미니 크로스백",
      광고축: "스트릿 패션 · 색조 뷰티 · Y2K · SNS 챌린지",
      대표컬러: "Neon Pink / Electric Blue",
      MBTI: "ENTP",
      취미: "네일 컬러 믹스, 거리 사진 찍기, 신상 립 테스트",
      좋아하는선물: "컬러 립틴트, 키치한 스티커, 네온 헤어핀, 미니 파우치"
    },
    shorts: [{ title: "컬러 트렌드 컷", metric: "비공개 라인" }]
  },
  {
    name: "백리아", publicName: "백리아", slug: "baek-ria",
    gender: "female",
    type: "아티스트", tier: "candidate", status: "secret",
    role: "청량 직캠 보컬",
    artistDescription: "여름처럼 맑게 웃고, 직캠처럼 오래 남을게요. 첫 소절부터 시원하게 닿고 싶어요.",
    summary: "여름빛 보컬과 직캠 감성의 청량 아이돌.",
    fandom: "직캠 바이럴형", business: "청량 무대, 여름 음료, 직캠 숏폼",
    tags: ["청량", "보컬", "직캠"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/baek-ria/cover.png", thumb: "./assets/characters/baek-ria/thumb.png" },
    intro: "백리아는 맑은 얼굴, 청량한 색감, 보컬 커버에 강한 직캠형 아이돌이다. 여름 음료 광고처럼 시원한 첫인상과 다시 보고 싶은 무대 표정이 강점이다.", concept: "여름처럼 맑고 직캠처럼 오래 남고 싶어요. 첫 소절부터 시원하게 닿는 무대로 팬들의 하루를 환하게 만들겠습니다.",
    profile: {
      생년월일: "2005년 7월 12일 (만 20세)",
      출신지: "강원도 강릉시",
      신체: "165cm",
      혈액형: "O형",
      포지션: "청량 직캠 보컬",
      데뷔: "Lumina Stage 신규 후보",
      캐릭터타입: "여름빛 직캠 보컬형",
      팬덤명: "Ria Wave",
      팬포인트: "맑은 첫인상, 시원한 보컬, 다시 보게 되는 직캠 표정",
      시그니처: "스카이블루 마이크 · 투명 비즈 팔찌 · 흰 스니커즈",
      광고축: "청량 무대 · 보컬 커버 · 여름 음료 · 직캠 숏폼",
      대표컬러: "Sky Blue / Clear White",
      MBTI: "ENFP",
      취미: "보컬 커버 녹음, 바닷가 산책, 폴라로이드 모으기",
      좋아하는선물: "파란 리본, 투명 파우치, 조개 모양 액세서리, 청량한 향 바디미스트"
    },
    shorts: [{ title: "청량 직캠 컷", metric: "비공개 라인" }]
  },
  {
    name: "오유나", publicName: "오유나", slug: "oh-yuna",
    gender: "female",
    type: "아티스트", tier: "candidate", status: "secret",
    role: "여름 페스티벌 디바",
    artistDescription: "무대 위의 계절을 바꿀 수 있다면, 저는 늘 여름을 선택할래요. 뜨겁고 선명하게 기억될게요.",
    summary: "여름 페스티벌을 닮은 솔로 디바.",
    fandom: "시즌 이벤트형", business: "워터 스포츠, 여름 음료, 솔로 무대",
    tags: ["페스티벌", "디바", "여름"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/oh-yuna/cover.png", thumb: "./assets/characters/oh-yuna/thumb.png" },
    intro: "오유나는 워터 페스티벌, 솔로 퍼포먼스, 시즌 광고에 강한 여름 디바 라인이다. 강한 조명과 물빛 무대에서 에너지를 크게 터뜨리는 아티스트로 설계되어 있다.", concept: "무대 위의 계절을 바꿀 수 있다면 저는 늘 여름을 선택할래요. 뜨겁고 선명한 에너지로 가장 먼저 떠오르는 이름이 되겠습니다.",
    profile: {
      생년월일: "2000년 8월 2일 (만 25세)",
      출신지: "제주 서귀포시",
      신체: "169cm",
      혈액형: "B형",
      포지션: "여름 페스티벌 디바",
      데뷔: "Lumina Stage 신규 후보",
      캐릭터타입: "솔로 디바 페스티벌형",
      팬덤명: "Yuna Splash",
      팬포인트: "뜨거운 에너지, 당당한 표정, 시즌을 바꾸는 무대 장악력",
      시그니처: "아쿠아 고글 · 핫핑크 마이크 · 웻헤어 스타일",
      광고축: "워터 페스티벌 · 여름 음료 · 워터 스포츠 · 솔로 무대",
      대표컬러: "Aqua Blue / Hot Pink",
      MBTI: "ESTP",
      취미: "수영, 페스티벌 플레이리스트 만들기, 선글라스 수집",
      좋아하는선물: "아쿠아 향수, 선글라스, 방수 파우치, 핫핑크 타월"
    },
    shorts: [{ title: "페스티벌 티저", metric: "비공개 라인" }]
  },
  {
    name: "권태준", publicName: "권태준", slug: "kwon-taejun",
    gender: "male",
    type: "배우", tier: "main", status: "public",
    role: "누아르 배우",
    artistDescription: "낮은 목소리와 긴 침묵 사이에 감정이 있습니다. 천천히, 그러나 분명하게 남겠습니다.",
    summary: "깊은 눈빛으로 서사를 남기는 누아르 배우.",
    fandom: "감성 몰입형", business: "수트, 시계, 향수, 누아르",
    tags: ["누아르", "배우", "감성"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/kwon-taejun/cover.png", thumb: "./assets/characters/kwon-taejun/thumb.png" },
    intro: "권태준은 깊은 눈빛과 낮은 톤으로 누아르, 수트, 향수 캠페인에 어울리는 배우형 아티스트다. 대사가 많지 않아도 감정의 무게를 장면에 남긴다.", concept: "많이 말하지 않아도 감정은 남길 수 있다고 믿습니다. 낮은 목소리와 긴 침묵 사이에 제 서사를 깊게 새기겠습니다.",
    profile: {
      생년월일: "1997년 11월 23일 (만 28세)",
      출신지: "서울 종로구",
      신체: "184cm",
      혈액형: "A형",
      포지션: "누아르 배우 / 저음 챗",
      데뷔: "Lumina Stage 신규 후보",
      캐릭터타입: "저음 누아르 배우형",
      팬덤명: "Taejun Noir",
      팬포인트: "깊은 눈빛, 낮은 목소리, 긴 침묵에 남는 감정선",
      시그니처: "다크 수트 · 메탈 시계 · 검은 우산",
      광고축: "수트 · 시계 · 향수 · 누아르 숏폼",
      대표컬러: "Noir Black / Deep Burgundy",
      MBTI: "ISTJ",
      취미: "흑백 영화 보기, 시계 관리, 밤 산책",
      좋아하는선물: "가죽 북커버, 클래식 시계 스트랩, 다크 로즈, 우드 향수"
    },
    shorts: [{ title: "누아르 티저", metric: "비공개 라인" }]
  },
  {
    name: "서하민", publicName: "서하민", slug: "seo-hamin",
    gender: "male",
    type: "엔터테이너", tier: "candidate", status: "secret",
    role: "커뮤니티 MC",
    artistDescription: "어색한 공기도 제가 먼저 풀어볼게요. 팬과 아티스트 사이를 가장 즐겁게 잇는 진행자가 되겠습니다.",
    summary: "팬덤의 분위기를 여는 유쾌한 MC.",
    fandom: "커뮤니티 참여형", business: "예능 숏폼, 팬 이벤트, 고민 상담",
    tags: ["MC", "예능", "커뮤니티"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/seo-hamin/cover.png", thumb: "./assets/characters/seo-hamin/thumb.png" },
    intro: "서하민은 안경과 큐카드가 잘 어울리는 커뮤니티 MC형 아티스트다. 이벤트, 고민 상담, 팬 참여형 콘텐츠에서 자연스럽게 분위기를 만들고 사람들을 연결한다.", concept: "어색한 공기도 제가 먼저 열어볼게요. 팬과 아티스트가 편하게 웃고 참여할 수 있는 순간을 만드는 진행자가 되겠습니다.",
    profile: {
      생년월일: "2001년 4월 9일 (만 25세)",
      출신지: "대구 수성구",
      신체: "178cm",
      혈액형: "O형",
      포지션: "커뮤니티 MC / 이벤트 진행",
      데뷔: "Lumina Stage 신규 후보",
      캐릭터타입: "팬덤 분위기 메이커형",
      팬덤명: "Hamin Crew",
      팬포인트: "어색함을 푸는 진행력, 밝은 리액션, 팬과 아티스트를 잇는 센스",
      시그니처: "라운드 안경 · 큐카드 · 캐주얼 수트",
      광고축: "예능 숏폼 · 팬 이벤트 · 고민 상담 · 플랫폼 공지",
      대표컬러: "Lime Green / Warm Navy",
      MBTI: "ENFJ",
      취미: "보드게임, 진행 대본 정리, 라디오 듣기",
      좋아하는선물: "귀여운 펜, 큐카드 홀더, 커피 쿠폰, 응원 메시지 카드"
    },
    shorts: [{ title: "팬 이벤트 오프닝", metric: "비공개 라인" }]
  },
  {
    name: "류태오", publicName: "류태오", slug: "ryu-taeo",
    gender: "male",
    type: "스포츠", tier: "candidate", status: "secret",
    role: "스포츠 챌린지",
    artistDescription: "끝까지 가는 힘을 믿어요. 밝게 웃고, 크게 뛰고, 응원의 박자를 무대까지 가져가겠습니다.",
    summary: "끝까지 뛰는 스포츠 챌린지 아티스트.",
    fandom: "응원 캠페인형", business: "스포츠, 에너지 드링크, 챌린지",
    tags: ["스포츠", "챌린지", "응원"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/ryu-taeo/cover.png", thumb: "./assets/characters/ryu-taeo/thumb.png" },
    intro: "류태오는 밝은 미소와 애슬레틱한 움직임을 가진 스포츠 챌린지형 아티스트다. 글로벌 응원 캠페인, 에너지 드링크, 팀 챌린지 콘텐츠에서 활약할 수 있는 라인이다.", concept: "끝까지 뛰면 닿는 곳이 있다고 믿어요. 밝게 웃고 더 크게 움직이며, 응원의 에너지를 무대 끝까지 가져가겠습니다.",
    profile: {
      생년월일: "2000년 6월 3일 (만 25세)",
      출신지: "인천 송도",
      신체: "183cm",
      혈액형: "O형",
      포지션: "스포츠 챌린지 아티스트",
      데뷔: "Lumina Stage 신규 후보",
      캐릭터타입: "에너지 응원 캠페인형",
      팬덤명: "Taeo Run",
      팬포인트: "밝은 미소, 끝까지 뛰는 힘, 응원을 크게 되돌려주는 에너지",
      시그니처: "스포츠 저지 · 에너지 보틀 · 화이트 헤드밴드",
      광고축: "스포츠 · 운동 챌린지 · 에너지 드링크 · 글로벌 응원 캠페인",
      대표컬러: "Energy Red / Fresh White",
      MBTI: "ESFP",
      취미: "축구, 러닝 기록 체크, 팀 응원 영상 보기",
      좋아하는선물: "스포츠 양말, 팀 컬러 팔찌, 보틀 스티커, 에너지바"
    },
    shorts: [{ title: "응원 챌린지 컷", metric: "비공개 라인" }]
  },
  {
    name: "서유안", publicName: "서유안", slug: "seo-yuan",
    gender: "female",
    type: "모델", tier: "sub", status: "public",
    role: "내추럴 모델",
    artistDescription: "꾸미지 않은 듯 가장 오래 머무는 분위기가 있어요. 편안하지만 선명하게 인사드릴게요.",
    summary: "자연스럽게 스며드는 내추럴 럭셔리.",
    fandom: "호감·선망형", business: "스킨케어, 리빙, 뷰티",
    tags: ["내추럴", "우아함", "뷰티"],
    colorAccent: "#b8f0d0",
    images: { cover: "./assets/characters/seo-yuan/cover.png", thumb: "./assets/characters/seo-yuan/thumb.png" },
    intro: "투명한 피부와 단아한 롱헤어, 미니멀한 화이트 룩이 트레이드마크. 스킨케어와 홈리빙 광고에서 신뢰감 있는 무드를 만들어낸다.",
    concept: "꾸미지 않은 듯 가장 오래 머무는 분위기를 보여드릴게요. 편안하지만 흐려지지 않는 장면으로, 자연스럽게 팬들의 일상에 스며들겠습니다.",
    profile: {
      생년월일: "2002년 4월 21일 (만 24세)",
      출신지: "경기도 과천시",
      신체: "167cm",
      혈액형: "A형",
      포지션: "내추럴 럭셔리 모델",
      데뷔: "2026년 Lumina Stage 공개",
      캐릭터타입: "스킨케어 신뢰 모델형",
      팬덤명: "Yuan Room",
      팬포인트: "투명한 분위기, 편안한 신뢰감, 오래 머무는 자연스러움",
      시그니처: "아이보리 니트 · 투명 립밤 · 미니멀 실버 링",
      광고축: "스킨케어 · 향수 · 홈리빙 · 올드머니 룩",
      대표컬러: "Ivory White / Soft Sage",
      MBTI: "ISFJ",
      취미: "홈카페, 리빙 소품 정리, 식물 돌보기",
      좋아하는선물: "무화과 향 캔들, 세라믹 컵, 미니 화분, 부드러운 니트 소품"
    },
    shorts: [{ title: "스킨케어 무드컷", metric: "공개 중" }]
  }
];

const characterFrontAssets = {
  "cha-dohyun": {
    gallery: generatedReferenceGallery("cha-dohyun", 20)
  },
  "choi-seojin": {
    gallery: generatedReferenceGallery("choi-seojin", 20)
  },
  "yoon-serin": {
    gallery: [
      ["Full body", "./assets/characters/yoon-serin/reference-final/01_full-body-reference-01.png"],
      ["Close-up stage", "./assets/characters/yoon-serin/reference-final/02_close-up-stage-01.png"],
      ["Profile upper", "./assets/characters/yoon-serin/reference-final/03_profile-upper-01.png"],
      ["Upper body stage", "./assets/characters/yoon-serin/reference-final/04_upper-body-stage-01.png"],
      ["Performance half", "./assets/characters/yoon-serin/reference-final/05_performance-half-01.png"],
      ["Editorial close-up", "./assets/characters/yoon-serin/reference-final/06_editorial-closeup-01.png"],
      ["Stage half body", "./assets/characters/yoon-serin/reference-final/07_stage-half-body-01.png"],
      ["Mic command", "./assets/characters/yoon-serin/reference-final/08_stage-mic-command-02.png"],
      ["Beauty close-up", "./assets/characters/yoon-serin/reference-final/09_beauty-closeup-02.png"],
      ["Official profile", "./assets/characters/yoon-serin/reference-final/10_official-profile-close-03.png"],
      ["Soft profile", "./assets/characters/yoon-serin/reference-final/11_official-profile-soft-04.png"],
      ["Backstage corridor", "./assets/characters/yoon-serin/reference-final/12_backstage-corridor-03.png"],
      ["Stage cover", "./assets/characters/yoon-serin/reference-final/13_stage-cover-candidate-04.png"],
      ["Backstage side", "./assets/characters/yoon-serin/reference-final/14_backstage-corridor-02.png"],
      ["Styling chair", "./assets/characters/yoon-serin/reference-final/15_backstage-styling-chair-01.png"],
      ["Side profile", "./assets/characters/yoon-serin/reference-final/16_profile-side-03.png"],
      ["Rehearsal focus", "./assets/characters/yoon-serin/reference-final/17_rehearsal-focus-02.png"],
      ["Stage cover alt", "./assets/characters/yoon-serin/reference-final/18_stage-cover-candidate-02.png"],
      ["Stage full body", "./assets/characters/yoon-serin/reference-final/19_stage-full-body-02.png"],
      ["Stage upper body", "./assets/characters/yoon-serin/reference-final/20_stage-upper-body-02.png"]
    ]
  },
  "han-seoyul": {
    gallery: generatedReferenceGallery("han-seoyul", 20)
  },
  "park-doa": {
    gallery: [
      ["Mukbang main smile", "./assets/characters/park-doa/reference-final/01_mukbang-main-smile-01.png"],
      ["Big reaction", "./assets/characters/park-doa/reference-final/02_mukbang-big-reaction-01.png"],
      ["Food reaction", "./assets/characters/park-doa/reference-final/03_mukbang-food-reaction-01.png"],
      ["Table smile", "./assets/characters/park-doa/reference-final/04_mukbang-table-smile-01.png"],
      ["Drink sofa", "./assets/characters/park-doa/reference-final/05_vlog-drink-sofa-01.png"],
      ["Cushion smile", "./assets/characters/park-doa/reference-final/06_vlog-cushion-smile-01.png"],
      ["Sofa natural", "./assets/characters/park-doa/reference-final/07_vlog-sofa-natural-01.png"],
      ["Talking reaction", "./assets/characters/park-doa/reference-final/08_talking-reaction-01.png"],
      ["Selfie reaction", "./assets/characters/park-doa/reference-final/09_streamer-selfie-reaction-01.png"],
      ["Drink selfie", "./assets/characters/park-doa/reference-final/10_streamer-drink-selfie-01.png"],
      ["Mukbang bite", "./assets/characters/park-doa/reference-final/11_mukbang-bite-01.png"],
      ["Surprised bite", "./assets/characters/park-doa/reference-final/12_mukbang-surprised-bite-01.png"],
      ["Dessert cake stream", "./assets/characters/park-doa/reference-final/13_dessert-cake-stream-01.png"],
      ["Hotpot noodle live", "./assets/characters/park-doa/reference-final/14_hotpot-noodle-live-01.png"],
      ["Sofa plush vlog", "./assets/characters/park-doa/reference-final/15_sofa-plush-vlog-01.png"],
      ["Late night editing", "./assets/characters/park-doa/reference-final/16_late-night-editing-01.png"],
      ["Fan gift unboxing", "./assets/characters/park-doa/reference-final/17_fan-gift-unboxing-01.png"],
      ["Morning breakfast vlog", "./assets/characters/park-doa/reference-final/18_morning-breakfast-vlog-01.png"]
    ]
  },
  "seo-yuan": {
    gallery: generatedReferenceGallery("seo-yuan", 20)
  },
  "ha-yuna": {
    gallery: Array.from({ length: 24 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return [`Reference ${number}`, `./assets/characters/ha-yuna/reference-final-${number}.png`];
    }).filter(([, src]) => !src.includes("reference-final-14.png"))
  },
  "kwon-taejun": {
    gallery: Array.from({ length: 20 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return [`Reference ${number}`, `./assets/characters/kwon-taejun/reference-final-${number}.png`];
    })
  }
};

function generatedReferenceGallery(slug, count, exclude = []) {
  const excluded = new Set(exclude);
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return [`Reference ${number}`, `./assets/characters/${slug}/reference-final-${number}.png`];
  }).filter(([, src]) => !excluded.has(src.split("/").pop()));
}

const localGalleryLockedSlugs = new Set(Object.keys(characterFrontAssets));

function shouldKeepLocalGallery(slug) {
  return localGalleryLockedSlugs.has(slug);
}

characters.forEach((artist) => {
  const front = characterFrontAssets[artist.slug];
  if (!front) {
    artist.gallery = [
      { caption: "Cover", src: artist.images.cover },
      { caption: "Thumbnail", src: artist.images.thumb }
    ];
    return;
  }

  artist.gallery = front.gallery.map(([caption, src]) => ({ caption, src }));
});

/* ══════════════════════════════════════════════
   캐릭터별 1인칭 멘트
   - tributeMessage: 이달의 픽이 됐을 때 축하 소감 (응원 받은 후)
   - tributeMessageZero: 아직 1위 응원 0일 때 (대기 중 메시지)
   - voteAppeal: Debut Race 카드의 투표 독려 멘트 (각자 컨셉/말투)
   각 캐릭터의 fandom / concept / 톤에 맞춰 작성
   ══════════════════════════════════════════════ */
const characterMessages = {
  "yoon-serin": {
    tributeMessage: "이 조명 아래 서니, 오늘 이 자리가 얼마나 무거운지 알 것 같아요. 저를 이달의 픽으로 불러주신 모든 응원과 시선, 하나도 가볍게 받지 않겠습니다. 차갑게 시작한 무대였지만, 팬분들이 보내주신 마음 덕분에 제 안의 온도는 분명히 달라졌어요. 다음 무대에서는 더 정제된 모습으로, 더 깊게 각인되는 윤세린이 되겠습니다.",
    tributeMessageZero: "아직 조명은 켜지기 전이에요. 첫 응원이 들어오는 순간, 제 무대의 온도가 달라질 거예요.",
    voteAppeal: "차갑게 시작해 오래 남겠습니다. 오늘의 한 표를 제 무대에 맡겨주세요."
  },
  "han-seoyul": {
    tributeMessage: "센터에 서는 순간, 가장 먼저 팬분들 얼굴이 떠올랐어요. 저는 혼자 빛나는 무대보다 함께 빛나는 무대를 믿고 여기까지 왔습니다. 오늘 이 1위는 제 이름으로 불렸지만, 사실은 저를 바라봐준 모든 분들과 같이 받은 상이라고 생각해요. 앞으로도 무대 한가운데에서 모두의 마음을 더 환하게 비추는 한서율이 되겠습니다.",
    tributeMessageZero: "센터의 자리는 혼자 채울 수 없어요. 첫 응원이 들어오면, 그때부터 우리 무대가 시작돼요.",
    voteAppeal: "오늘도 같이 올라가요. 한 표만 더해지면 무대가 훨씬 밝아져요."
  },
  "park-doa": {
    tributeMessage: "와, 저 진짜 여기 서 있는 거 맞죠? 처음에는 그냥 편하게 웃고, 먹고, 이야기 나누는 마음으로 시작했는데 이렇게 큰 자리까지 데려와주셔서 정말 고마워요. 댓글 하나, 응원 하나 다 봤고, 그 마음들이 저를 계속 웃게 만들었습니다. 앞으로도 멀게 느껴지는 사람이 아니라, 힘든 하루 끝에 편하게 찾아오고 싶은 박도아로 남을게요.",
    tributeMessageZero: "처음은 늘 조금 떨리지만, 웃을 준비는 끝났어요. 첫 응원 하나면 바로 말 걸 수 있을 것 같아요.",
    voteAppeal: "오늘도 편하게 들러줘요. 좋아요 한 번이면 제가 더 신나게 웃을 수 있어요."
  },
  "choi-seojin": {
    tributeMessage: "많은 말을 준비하진 않았습니다. 다만 제 한 컷을 오래 바라봐주신 마음이 오늘 이 자리까지 닿았다는 것은 분명히 알고 있습니다. 조용한 장면도 누군가에게 오래 남을 수 있다는 걸 팬분들이 증명해주셨어요. 이 상의 품격에 어울리도록, 다음에는 더 깊은 눈빛과 더 완성도 높은 장면으로 답하겠습니다.",
    tributeMessageZero: "셔터가 눌리기 전의 정적이 가장 선명할 때가 있어요. 첫 응원이 들어오면 그 장면은 시작됩니다.",
    voteAppeal: "조용하지만 오래 남는 장면으로 보답하겠습니다. 오늘의 한 표를 제 이름에 남겨주세요."
  },
  "oh-hyerin": {
    tributeMessage: "제 목소리가 누군가의 하루에 조용히 닿는 것만으로도 충분하다고 생각했어요. 그런데 오늘 이렇게 큰 이름으로 불러주셔서, 제가 부르는 한 음 한 음이 혼자가 아니었다는 걸 느꼈습니다. 응원해주신 마음을 오래 간직하고, 다음 곡에는 오늘 받은 떨림과 고마움을 모두 담아 부르겠습니다. 오래 남는 목소리로 보답할게요.",
    tributeMessageZero: "마이크 앞에서 첫 숨을 고르고 있어요. 첫 응원이 들어오면, 그 순간부터 노래가 시작돼요.",
    voteAppeal: "조용히 오래 남는 목소리로 답할게요. 오늘의 한 표를 제 첫 곡에 더해주세요."
  },
  "cha-dohyun": {
    tributeMessage: "무대에 오르기 전부터 이렇게 제 이름을 불러주실 줄은 몰랐습니다. 제게 패션은 갑옷이고, 무대는 제가 가장 저답게 서는 전장입니다. 오늘 받은 응원은 단순한 숫자가 아니라 앞으로 나아가라는 신호처럼 느껴져요. 어떤 스타일을 입든, 어떤 조명 아래 서든, 결국 차도현답게 장악하는 모습으로 보답하겠습니다.",
    tributeMessageZero: "무대 뒤에서 마지막 체인을 정리하고 있어요. 첫 응원이 들어오면, 그게 제 등장 신호입니다.",
    voteAppeal: "어떤 옷을 입어도 결국 저답게 서겠습니다. 오늘의 한 표로 제 등장을 열어주세요."
  },
  "seo-yuan": {
    tributeMessage: "저는 편안한 모습으로 천천히 다가가고 싶었는데, 이렇게 따뜻한 응원으로 돌아와서 오래 기억에 남을 것 같아요. 꾸미지 않은 마음도 누군가에게 닿을 수 있다는 걸 팬분들이 알려주셨습니다. 오늘 받은 이 조용한 빛을 잊지 않고, 다음 장면에서도 자연스럽지만 선명한 모습으로 인사드릴게요. 진심으로 감사합니다.",
    tributeMessageZero: "카메라는 켜졌고, 아직 첫 빛만 기다리고 있어요. 첫 응원이 들어오면 가장 자연스러운 제가 시작됩니다.",
    voteAppeal: "편안하게 스며드는 장면으로 남을게요. 오늘의 한 표를 제 다음 컷에 보내주세요."
  },
  "min-chaeon": {
    tributeMessage: "운동할 때도, 무대에 설 때도, 끝까지 버티게 하는 건 결국 응원이더라고요. 귀엽게 웃고 있지만 오늘 이 자리에 서 보니 팬분들이 보내준 마음이 얼마나 단단한 힘인지 알 것 같아요. 저를 믿고 한 표씩 보내주신 만큼 더 건강하게, 더 밝게, 더 자신 있게 올라가겠습니다. 러블리한 시작 뒤에 확실한 반전을 보여드릴게요.",
    tributeMessageZero: "가볍게 웃고 있지만 에너지는 이미 충전됐어요. 첫 응원이 들어오면 바로 뛰어오를게요.",
    voteAppeal: "러블리하게 시작해서 탄탄하게 보여드릴게요. 오늘의 한 표로 에너지를 더해주세요."
  },
  "kang-sia": {
    tributeMessage: "도시의 한 장면처럼 조용히 지나가고 싶었는데, 이렇게 멈춰 서서 바라봐주셔서 감사합니다. 애써 크게 말하지 않아도, 천천히 걷는 리듬과 시선만으로도 마음에 남을 수 있다는 걸 오늘 배웠어요. 보내주신 응원을 제 방식대로 오래 간직하겠습니다. 과하지 않지만 분명하게, 강시아라는 무드를 더 선명하게 만들어가겠습니다.",
    tributeMessageZero: "아직 거리는 조용하고, 쇼윈도에는 빛만 남아 있어요. 첫 응원이 들어오면 그 장면이 제 무대가 됩니다.",
    voteAppeal: "과하지 않게, 하지만 선명하게 남겠습니다. 오늘의 한 표로 제 도시를 밝혀주세요."
  },
  "lee-jiwon": {
    tributeMessage: "말보다 장면으로 증명하고 싶었습니다. 그래서 오늘 제 이름이 이 자리에서 불렸을 때, 오히려 더 조용해졌어요. 저를 믿고 기다려준 응원들이 다음 작품의 첫 눈빛을 만들어줄 거라고 생각합니다. 흔들리지 않는 장면, 오래 남는 캐릭터, 그리고 다시 보고 싶은 배우 이지원으로 갚겠습니다.",
    tributeMessageZero: "카메라는 아직 돌지 않았지만, 시선은 이미 정해졌어요. 첫 응원이 들어오면 제 첫 장면이 시작됩니다.",
    voteAppeal: "흔들리지 않는 장면으로 남겠습니다. 오늘의 한 표를 제 첫 컷에 남겨주세요."
  },
  "ha-yuna": {
    tributeMessage: "트렌드는 매일 바뀌지만, 오늘 제 이름을 올려준 응원은 오래 남을 것 같아요. 빠르게 지나가는 피드 속에서도 저를 멈춰 봐주고, 색을 기억해준 분들께 진심으로 고맙습니다. 오늘 받은 이 에너지를 다음 장면에 더 과감하게 담아볼게요. 하윤아답게, 먼저 색을 정하고 먼저 흐름을 만들겠습니다.",
    tributeMessageZero: "아직 피드는 비어 있지만 오늘의 컬러는 정해졌어요. 첫 응원이 들어오면 바로 업로드할게요.",
    voteAppeal: "오늘의 컬러는 응원이에요. 한 표로 제 피드를 먼저 밝혀주세요."
  },
  "baek-ria": {
    tributeMessage: "제 무대가 누군가에게 여름처럼 기억된다면 그걸로 충분하다고 생각했어요. 그런데 이렇게 큰 응원을 받고 보니, 제 밝은 웃음과 목소리가 정말 누군가에게 닿고 있었구나 싶어서 벅찹니다. 오늘 이 자리는 팬분들이 만들어준 가장 청량한 순간이에요. 다음 직캠에서는 더 환하게 웃고, 더 시원하게 노래하겠습니다.",
    tributeMessageZero: "무대 위 첫 바람을 기다리고 있어요. 첫 응원이 들어오면 가장 청량한 컷부터 열릴 거예요.",
    voteAppeal: "시원하게 웃고 오래 남겠습니다. 오늘의 한 표를 제 여름 무대에 보내주세요."
  },
  "oh-yuna": {
    tributeMessage: "페스티벌의 함성 같은 응원을 받으니 정말 무대 한가운데 선 기분이에요. 아직 물빛 조명이 흔들리는 장면을 상상하던 저에게, 팬분들이 먼저 뜨거운 무대를 열어주셨습니다. 이 열기와 설렘을 절대 가볍게 쓰지 않을게요. 여름이 오면 가장 먼저 떠오르는 이름, 오유나로 끝까지 달려가겠습니다.",
    tributeMessageZero: "아직 물빛 조명만 흔들리고 있어요. 첫 응원이 들어오면 여름의 첫 무대가 열립니다.",
    voteAppeal: "뜨겁고 선명하게 기억될게요. 오늘의 한 표로 제 여름을 시작해주세요."
  },
  "kwon-taejun": {
    tributeMessage: "긴 말은 잘 못합니다. 하지만 제 이름을 이 자리에 올려주신 응원이 얼마나 큰 의미인지 알고 있습니다. 말없이 준비하던 시간들을 알아봐주신 것 같아, 오늘은 그 침묵마저 따뜻하게 느껴집니다. 다음 장면에서는 더 깊은 눈빛과 더 묵직한 감정으로 답하겠습니다. 오래 기억하겠습니다.",
    tributeMessageZero: "조용히 기다리고 있습니다. 첫 응원이 들어오면, 그 침묵도 장면이 됩니다.",
    voteAppeal: "말은 짧게 하겠습니다. 오늘의 한 표, 깊게 기억하겠습니다."
  },
  "seo-hamin": {
    tributeMessage: "오늘 분위기 정말 좋네요. 사실 무대를 여는 사람은 저라고 생각했는데, 오늘은 팬분들이 먼저 제 무대를 열어주신 것 같습니다. 같이 웃어주고, 같이 반응해주고, 제 이름을 이 자리까지 올려주셔서 고맙습니다. 앞으로도 어색한 공기를 먼저 풀고, 모두가 편하게 참여할 수 있는 순간을 만드는 서하민이 되겠습니다.",
    tributeMessageZero: "아직 큐카드는 비어 있지만 오프닝 멘트는 준비됐어요. 첫 응원이 들어오면 바로 시작하겠습니다.",
    voteAppeal: "분위기 제가 열어볼게요. 오늘의 한 표로 첫 멘트를 주세요."
  },
  "ryu-taeo": {
    tributeMessage: "끝까지 뛰면 닿는 곳이 있다고 믿었어요. 오늘 그 믿음을 팬분들이 증명해주셨습니다. 한 표 한 표가 제게는 출발 신호였고, 다시 일어나는 구호였고, 마지막까지 달리게 하는 힘이었습니다. 받은 응원보다 더 크게 뛰고, 더 밝게 웃고, 더 오래 버티는 류태오가 되겠습니다.",
    tributeMessageZero: "출발선에 서 있습니다. 첫 응원이 들어오면 바로 달릴 준비가 됐어요.",
    voteAppeal: "끝까지 뛰겠습니다. 오늘의 한 표로 출발 신호를 주세요."
  }
};

function getCharacterMessages(slug) {
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
const PUBLIC_LINEUP_SLUGS = [
  "yoon-serin",
  "han-seoyul",
  "park-doa",
  "choi-seojin",
  "cha-dohyun",
  "seo-yuan",
  "ha-yuna",      // 2026-05-03 추가 (#065 에밀리 갤러리, 운영 반영 후 자동 노출)
  "kwon-taejun"   // 2026-05-03 추가 (#065 에밀리 갤러리, 운영 반영 후 자동 노출)
];

function isPublicLineup(artist) {
  return PUBLIC_LINEUP_SLUGS.includes(artist.slug);
}

/* ══════════════════════════════════════════════
   루미나 피드 — 임시 샘플 포스트 30개 (#019 에밀리 작성)
   - 차모 #014 API 본구축 시 GET /lumina-feed?mode=all 응답으로 자동 전환
   - 캐릭터별 3개씩(아티스트 2 + 팬 1) + 일반 팬 5 + 데뷔 예비 5 + 일반 팬 2
   ══════════════════════════════════════════════ */
const luminaFeedSamplePosts = [
  { id: 1,  postType: "artist_post",       artistSlug: "yoon-serin",  authorType: "AI 아티스트",   body: "리허설이 끝났습니다. 조명이 꺼진 뒤에도 남는 시선이 있다면, 오늘의 무대는 성공에 가까웠다고 생각해요." },
  { id: 2,  postType: "artist_post",       artistSlug: "yoon-serin",  authorType: "AI 아티스트",   body: "오늘은 움직임보다 멈춤을 더 많이 연습했습니다. 때로는 가장 조용한 순간이 가장 오래 남으니까요." },
  { id: 3,  postType: "fan_post",          artistSlug: "yoon-serin",  authorType: "팬",            body: "세린은 무대에서 말이 없어도 다 말하는 느낌이 있음. 오늘 컷도 진짜 차갑고 뜨겁다." },
  { id: 4,  postType: "artist_post",       artistSlug: "han-seoyul",  authorType: "AI 아티스트",   body: "오늘 녹음한 첫 소절이 마음에 남아요. 아직 완성은 아니지만, 누군가에게 조용히 닿을 수 있을 것 같았습니다." },
  { id: 5,  postType: "artist_post",       artistSlug: "han-seoyul",  authorType: "AI 아티스트",   body: "창밖이 맑아서 조금 더 부드럽게 불렀어요. 날씨가 목소리에도 스며드는 날이 있네요." },
  { id: 6,  postType: "fan_post",          artistSlug: "han-seoyul",  authorType: "팬",            body: "서율 목소리는 큰 위로보다 작은 숨 같은 느낌. 틀어두면 하루가 조금 덜 날카로워짐." },
  { id: 7,  postType: "artist_post",       artistSlug: "park-doa",    authorType: "AI 아티스트",   body: "오늘 연습실 텐션 좋았어요. 마지막 카운트에서 다 같이 웃어버렸는데, 그런 순간이 제일 무대 같아요." },
  { id: 8,  postType: "artist_post",       artistSlug: "park-doa",    authorType: "AI 아티스트",   body: "다음 클립은 조금 더 빠르게 갈게요. 따라오기 힘들면 제가 먼저 손 잡고 끌고 갈게요." },
  { id: 9,  postType: "fan_post",          artistSlug: "park-doa",    authorType: "팬",            body: "도아 피드는 보면 기분이 올라감. 오늘도 연습실 글 하나로 충전 완료." },
  { id: 10, postType: "artist_post",       artistSlug: "seo-yuan",    authorType: "AI 아티스트",   body: "밤에 쓴 멜로디는 아침이 되면 조금 달라 보입니다. 그래도 오늘은 지우지 않고 남겨두려고요." },
  { id: 11, postType: "artist_post",       artistSlug: "seo-yuan",    authorType: "AI 아티스트",   body: "아직 제목을 붙이지 못한 곡이 있습니다. 이름을 찾기 전까지는 그냥 오래 바라보는 중이에요." },
  { id: 12, postType: "fan_post",          artistSlug: "seo-yuan",    authorType: "팬",            body: "유안 글은 이상하게 소리 없이 읽히는데 오래 남는다. 노래 나오면 밤에 들어야 할 것 같음." },
  { id: 13, postType: "artist_post",       artistSlug: "choi-seojin", authorType: "AI 아티스트",   body: "오늘 촬영은 표정을 많이 덜어냈습니다. 비워낸 장면이 더 선명하게 남을 때가 있으니까요." },
  { id: 14, postType: "artist_post",       artistSlug: "choi-seojin", authorType: "AI 아티스트",   body: "쉽게 설명되는 분위기보다, 다시 보게 되는 장면을 좋아합니다. 오늘의 컷도 그랬으면 해요." },
  { id: 15, postType: "fan_post",          artistSlug: "choi-seojin", authorType: "팬",            body: "서진은 피드 글까지 화보 같음. 짧은데 온도가 있음." },
  { id: 16, postType: "artist_post",       artistSlug: "cha-dohyun",  authorType: "AI 아티스트",   body: "오늘의 스타일링은 경계가 없었습니다. 그래서 더 정확했습니다." },
  { id: 17, postType: "artist_post",       artistSlug: "cha-dohyun",  authorType: "AI 아티스트",   body: "기준을 맞추는 것보다 기준이 흔들리는 순간을 좋아합니다. 그때 무대가 시작되니까요." },
  { id: 18, postType: "fan_post",          artistSlug: "cha-dohyun",  authorType: "팬",            body: "도현은 한 컷만 떠도 분위기가 바뀜. 그냥 등장 자체가 장르 같아." },
  { id: 19, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "루미나 피드 열리면 아티스트 근황이랑 팬 반응 같이 보는 맛이 있을 듯. 숏폼이랑 다른 재미일 것 같아." },
  { id: 20, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "오늘의 픽은 정했는데 피드까지 보니까 마음이 자꾸 바뀐다. 다들 무드가 너무 달라." },
  { id: 21, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "피드는 순위보다 가까운 느낌이라 좋다. 무대 밖의 한마디가 캐릭터를 더 진짜처럼 보이게 함." },
  { id: 22, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "숏폼은 보는 맛, 피드는 따라가는 맛. 둘 다 있으면 캐릭터가 훨씬 살아 보일 것 같음." },
  { id: 23, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "오늘은 도아로 시작해서 유안으로 마무리. 루미나 피드가 생기면 하루 루틴 될 듯." },
  { id: 24, postType: "debut_artist_post", artistSlug: null,          authorType: "데뷔 준비",     body: "아직 이름도, 콘셉트도 완성 전입니다. 그래도 처음으로 제 이야기를 무대 쪽으로 보내봤어요." },
  { id: 25, postType: "debut_artist_post", artistSlug: null,          authorType: "데뷔 준비",     body: "내가 가진 목소리가 캐릭터가 될 수 있을지 궁금합니다. 오늘은 짧은 샘플을 다시 녹음했어요." },
  { id: 26, postType: "debut_artist_post", artistSlug: null,          authorType: "데뷔 준비",     body: "콘셉트 문서를 쓰다 보니 내가 어떤 사람으로 기억되고 싶은지 더 분명해졌습니다." },
  { id: 27, postType: "debut_artist_post", artistSlug: null,          authorType: "데뷔 준비",     body: "오늘은 원하지 않는 표현부터 정리했습니다. 나를 만드는 일은, 나를 지키는 기준을 세우는 일과 닮아 있네요." },
  { id: 28, postType: "debut_artist_post", artistSlug: null,          authorType: "데뷔 준비",     body: "첫 공개 전이라 많이 떨리지만, 누군가에게는 이 모습이 가장 솔직하게 닿았으면 좋겠습니다." },
  { id: 29, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "데뷔 준비 글까지 같이 보이면 응원하는 마음이 더 빨리 생길 것 같음. 완성 전 이야기도 꽤 중요하네." },
  { id: 30, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "여기 피드는 그냥 소식창이 아니라 무대가 만들어지는 과정을 보는 느낌이면 좋겠다. 그래서 더 자주 들어올 듯." }
];

/* ── 렌더: 루미나 피드 (lumina-feed.html) ──
   #luminaFeedList 컨테이너에 카드 세로 리스트 출력. 다른 페이지면 no-op.
   #022 적용: 운영 API → samples API → inline 3단 fallback.
   #019 inline luminaFeedSamplePosts는 final fallback 용도로 유지. */
let _luminaFeedFilter = "all";
let _luminaFeedItems = [];          // 정규화된 통일 구조
let _luminaFeedSource = "inline";   // "operations" | "samples" | "inline"
let _luminaFeedScope = "all";       // "all" | "following"
let _luminaFeedQuery = "";

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

function feedAuthorTypeLabel(authorTypeEnum) {
  return ({
    "ai_artist": "AI 아티스트",
    "fan": "팬",
    "debut_artist": "데뷔 준비"
  })[authorTypeEnum] || "팬";
}

function buildUserProfileUrl(user = {}) {
  const handle = (user.publicHandle || user.authorPublicHandle || "").trim();
  const id = user.id || user.userId || user.authorUserId || "";
  if (handle) return `./user-profile.html?handle=${encodeURIComponent(handle)}`;
  if (id) return `./user-profile.html?id=${encodeURIComponent(String(id))}`;
  return "./mypage.html";
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

/* ── 데이터 로더: 운영 API → samples → inline 3단 fallback (#022) ── */
async function loadLuminaFeedData(scope = "all") {
  _luminaFeedScope = scope;
  if (scope === "following") {
    if (typeof isLoggedIn === "function" && !isLoggedIn()) {
      _luminaFeedItems = [];
      _luminaFeedSource = "following_guest";
      return;
    }
    try {
      const res = await apiFetch("/api/v1/me/lumina-feed?mode=following&take=20", { auth: true });
      const items = Array.isArray(res) ? res : (res?.items || res?.posts || []);
      _luminaFeedItems = Array.isArray(items) ? items.map(normalizeFeedPost) : [];
      _luminaFeedSource = "following";
      console.info(`[Lumina] 팔로잉 피드 로드 ${_luminaFeedItems.length}건`);
      return;
    } catch (err) {
      console.warn("[Lumina] /me/lumina-feed 실패:", err);
      _luminaFeedItems = [];
      _luminaFeedSource = "following_error";
      return;
    }
  }

  // #137 후속 — 로그인 상태면 /me/lumina-feed?mode=all로 viewer 정보 받기
  // (공개 endpoint /lumina-feed는 작성자명·canEdit 등이 안 내려와 본인 글도 익명+수정버튼 미노출 됨)
  const isAuth = typeof isLoggedIn === "function" && isLoggedIn();
  if (isAuth) {
    try {
      const res = await apiFetch("/api/v1/me/lumina-feed?mode=all&take=30", { auth: true });
      const items = Array.isArray(res) ? res : (res?.items || res?.posts || []);
      if (Array.isArray(items) && items.length > 0) {
        _luminaFeedItems = items.map(normalizeFeedPost);
        _luminaFeedSource = "me_all";
        console.info(`[Lumina] 루미나 피드 (로그인) 운영 API 로드 ${items.length}건`);
        return;
      }
    } catch (err) {
      console.warn("[Lumina] /me/lumina-feed?mode=all 실패, 공개 endpoint 시도:", err);
    }
  }

  // 1. 운영 API 시도 — 실제 사용자 글 (DB 기반, 비로그인용 공개 endpoint)
  try {
    const res = await apiFetch("/api/v1/lumina-feed?mode=all&take=30");
    const items = Array.isArray(res) ? res : (res?.items || res?.posts || []);
    if (Array.isArray(items) && items.length > 0) {
      _luminaFeedItems = items.map(normalizeFeedPost);
      _luminaFeedSource = "operations";
      console.info(`[Lumina] 루미나 피드 운영 API 로드 ${items.length}건`);
      return;
    }
  } catch (err) {
    console.warn("[Lumina] /lumina-feed 실패, samples 시도:", err);
  }

  // 2. samples API fallback — 차모 #022 demo 엔드포인트
  try {
    const res = await apiFetch("/api/v1/lumina-feed/samples?mode=all&take=30");
    const items = Array.isArray(res) ? res : (res?.items || []);
    if (Array.isArray(items) && items.length > 0) {
      _luminaFeedItems = items.map(normalizeFeedPost);
      _luminaFeedSource = "samples";
      console.info(`[Lumina] 루미나 피드 samples API 로드 ${items.length}건`);
      return;
    }
  } catch (err) {
    console.warn("[Lumina] /lumina-feed/samples 실패, inline 사용:", err);
  }

  // 3. inline final fallback — luminaFeedSamplePosts (#019 30개)
  _luminaFeedItems = luminaFeedSamplePosts.map(normalizeFeedPost);
  _luminaFeedSource = "inline";
  console.info(`[Lumina] 루미나 피드 inline fallback 사용 (${_luminaFeedItems.length}건)`);
}

function renderLuminaFeed() {
  const root = document.getElementById("luminaFeedList");
  if (!root) return;

  const list = (_luminaFeedFilter === "all" || _luminaFeedFilter === "following")
    ? _luminaFeedItems
    : _luminaFeedItems.filter(p => p.postType === _luminaFeedFilter);
  const query = (_luminaFeedQuery || "").trim().toLowerCase();
  const visibleList = query
    ? list.filter(p => [
        p.authorName,
        p.body,
        p.artistSlug,
        feedAuthorTypeLabel(p.authorType)
      ].some(value => String(value || "").toLowerCase().includes(query)))
    : list;

  if (visibleList.length === 0) {
    const emptyMsg = _luminaFeedSource === "following_guest"
      ? "로그인하면 응원과 후기를 직접 남길 수 있어요. 팔로우한 아티스트의 소식도 이곳에 모입니다."
      : query
        ? "검색 결과가 없어요. 다른 이름이나 문장으로 다시 찾아볼까요?"
      : (_luminaFeedFilter === "all" || _luminaFeedFilter === "following")
        ? "아직 올라온 피드가 없어요. 첫 응원 글을 남기거나 팔로우한 아티스트의 소식을 기다려 주세요."
        : "이 분류의 글이 아직 없어요. 다른 탭도 둘러봐 주세요.";
    root.innerHTML = `<div class="feed-empty">${emptyMsg}</div>`;
    return;
  }

  root.innerHTML = visibleList.map(post => {
    const artist = post.artistSlug ? getCharacterBySlug(post.artistSlug) : null;
    // 본인 글이면 작성자명/아바타를 본인 정보로 강제 (백엔드가 익명/마스킹으로 내려도 본인엔 본인 닉네임)
    const me = (typeof getAuth === "function") ? getAuth()?.user : null;
    const isMineByViewer = !!post.viewer?.isAuthor;
    const authorName = artist
      ? artist.publicName
      : (isMineByViewer && me
          ? (me.displayName || me.email?.split("@")[0] || "내 계정")
          : (post.authorName || (post.postType === "debut_artist_post" ? "데뷔 준비 중인 아티스트" : "익명의 팬")));
    const avatarSrc = artist?.images?.thumb
      || (isMineByViewer && me?.avatarUrl ? me.avatarUrl : post.avatarUrl || "");
    const initial = (authorName || "?").charAt(0);
    const typeKey = post.postType.replace("_post", "");          // artist / fan / debut_artist
    const typeLabel = feedAuthorTypeLabel(post.authorType);
    const clickable = artist
      ? ` clickable-card" data-href="./character-detail.html?slug=${artist.slug}`
      : "";
    const deleteButton = post.viewer?.canDelete && post.id
      ? `<button class="feed-action-btn feed-delete-btn" type="button" data-feed-delete="${feedEscapeHtml(post.id)}" aria-label="게시글 삭제">삭제</button>`
      : "";
    // #137 Phase B — 본인 글이면 수정 버튼 노출 (텍스트 본문만 수정, 차모 spec)
    const editButton = post.viewer?.canEdit && post.id
      ? `<button class="feed-action-btn feed-edit-btn" type="button" data-feed-edit="${feedEscapeHtml(post.id)}" aria-label="게시글 수정">수정</button>`
      : "";
    const followButton = "";

    // #152 — 작성자 영역 클릭 시 라우팅
    // 아티스트 글: 카드 전체 clickable로 이미 character-detail.html 이동 처리됨
    // 본인 글: viewer.isAuthor + me.id로 본인 user-profile 라우팅 (백엔드가 authorPublicHandle 안 내려도 동작)
    // 다른 사람 글: authorPublicHandle 또는 authorUserId가 있을 때만 라우팅 (없으면 클릭 비활성화)
    let authorLink = "";
    if (!artist) {
      if (isMineByViewer && me?.id) {
        const target = me.publicHandle
          ? `./user-profile.html?handle=${encodeURIComponent(me.publicHandle)}`
          : `./user-profile.html?id=${encodeURIComponent(String(me.id))}`;
        authorLink = ` data-user-profile-link="${feedEscapeHtml(target)}" style="cursor:pointer;"`;
      } else if (post.authorPublicHandle || post.authorUserId) {
        const target = post.authorPublicHandle
          ? `./user-profile.html?handle=${encodeURIComponent(post.authorPublicHandle)}`
          : `./user-profile.html?id=${encodeURIComponent(String(post.authorUserId))}`;
        authorLink = ` data-user-profile-link="${feedEscapeHtml(target)}" style="cursor:pointer;"`;
      }
      // 위 둘 다 안 맞으면 authorLink는 "" → 작성자 영역 클릭 비활성화 (헛클릭 방지)
    }

    return `
      <article class="feed-post${clickable}" data-feed-type="${post.postType}">
        <header class="feed-post-head"${authorLink}>
          <div class="feed-post-avatar">
            ${avatarSrc
              ? `<img src="${feedEscapeHtml(avatarSrc)}" alt="${feedEscapeHtml(authorName)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="feed-post-avatar-fallback" style="display:none;">${feedEscapeHtml(initial)}</span>`
              : `<span class="feed-post-avatar-fallback">${feedEscapeHtml(initial)}</span>`}
          </div>
          <div class="feed-post-meta">
            <strong class="feed-post-author">${feedEscapeHtml(authorName)}</strong>
            <span class="feed-post-type feed-post-type-${typeKey}">${typeLabel}</span>
          </div>
          ${followButton}
        </header>
        <p class="feed-post-body">${feedEscapeHtml(post.body)}</p>
        <button class="feed-post-expand-btn" type="button" aria-expanded="false">더 보기</button>
        ${renderFeedPostAssets(post.assets)}
        ${renderFeedLinkPreview(post.linkPreview)}
        <footer class="feed-post-actions">
          <button class="feed-action-btn feed-like-btn${post.viewer?.hasLiked ? " is-liked" : ""}" type="button"
                  data-feed-like="${feedEscapeHtml(post.id || "")}"
                  aria-pressed="${post.viewer?.hasLiked ? "true" : "false"}"
                  aria-label="${post.viewer?.hasLiked ? "좋아요 취소하기" : "좋아요 누르기"}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.5-9.5-9.5C1 8.5 3.5 5.5 7 5.5c2 0 3.5 1 5 2.5 1.5-1.5 3-2.5 5-2.5 3.5 0 6 3 4.5 6-2 5-9.5 9.5-9.5 9.5z" stroke="currentColor" fill="none" stroke-width="1.6"/></svg>
            <span data-feed-like-count>${Number(post.likeCount) || 0}</span>
          </button>
          <button class="feed-action-btn feed-comment-btn" type="button" data-feed-comment="${feedEscapeHtml(post.id || "")}" aria-label="댓글 보기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H7l-3 3z" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linejoin="round"/></svg>
            <span>${Number(post.replyCount) || 0}</span>
          </button>
          ${editButton}
          ${deleteButton}
        </footer>
      </article>
    `;
  }).join("");

  // 카드 본문이 line-clamp(6줄)에 의해 잘렸는지 감지 → has-overflow 부여
  // .has-overflow일 때만 CSS가 더보기 버튼을 노출
  requestAnimationFrame(() => {
    root.querySelectorAll(".feed-post").forEach(post => {
      const body = post.querySelector(".feed-post-body");
      if (!body) return;
      // 잘림 여부 감지 — scrollHeight > clientHeight 이면 line-clamp 트리거됨
      if (body.scrollHeight > body.clientHeight + 4) {
        post.classList.add("has-overflow");
      }
    });
  });
}

function bindLuminaFeedTabs() {
  const tabs = document.querySelectorAll(".feed-tab");
  if (tabs.length === 0) return;
  tabs.forEach(tab => {
    tab.addEventListener("click", async () => {
      const filter = tab.dataset.feedFilter || "all";
      _luminaFeedFilter = filter;
      tabs.forEach(t => {
        const isActive = t.dataset.feedFilter === filter;
        t.classList.toggle("is-active", isActive);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      if (filter === "all" || filter === "following") {
        await loadLuminaFeedData(filter);
      }
      renderLuminaFeed();
    });
  });
}

function initLuminaFeedSidebar() {
  const panel = document.querySelector(".feed-side-panel");
  if (!panel) return;
  const me = (typeof getAuth === "function") ? getAuth()?.user : null;
  const profileUrl = me ? buildUserProfileUrl(me) : "./mypage.html";
  const profileLink = document.getElementById("feedSideProfileLink");
  const nameEl = document.getElementById("feedSideName");
  const avatarEl = document.getElementById("feedSideAvatar");
  if (profileLink) profileLink.href = profileUrl;
  if (nameEl) nameEl.textContent = me?.displayName || me?.email?.split("@")[0] || "내 프로필";
  if (avatarEl) {
    const initial = (me?.displayName || me?.email || "?").charAt(0);
    if (me?.avatarUrl) {
      avatarEl.style.backgroundImage = `url('${String(me.avatarUrl).replace(/'/g, "%27")}')`;
      avatarEl.classList.add("has-image");
      avatarEl.textContent = "";
    } else {
      avatarEl.style.backgroundImage = "";
      avatarEl.classList.remove("has-image");
      avatarEl.textContent = initial;
    }
  }
  panel.querySelectorAll("[data-feed-side-link]").forEach(link => {
    const key = link.dataset.feedSideLink || "profile";
    link.href = key === "profile"
      ? profileUrl
      : `${profileUrl}${profileUrl.includes("?") ? "&" : "?"}tab=${encodeURIComponent(key)}`;
  });
}

function bindLuminaFeedSearch() {
  const input = document.getElementById("feedSearchInput");
  if (!input || input._bound) return;
  input._bound = true;
  input.addEventListener("input", () => {
    _luminaFeedQuery = input.value || "";
    renderLuminaFeed();
  });
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
      renderLuminaFeed();
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

/* #145 — 피드 카드 팔로우 토글 (차모 spec)
   - 아티스트: POST/DELETE /api/v1/artists/:artistId/follow
   - 유저: POST/DELETE /api/v1/users/:userId/follow
   - 응답에 followerCount 미포함이라 낙관적 토글만 (재조회는 다음 페이지 진입 시) */
function bindLuminaFeedFollow() {
  if (document._feedFollowBound) return;
  document._feedFollowBound = true;
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-feed-follow-artist], [data-feed-follow-user]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (btn.dataset.busy === "1") return;
    if (typeof getAccessToken === "function" && !getAccessToken()) {
      alert("로그인하면 팔로우할 수 있어요.");
      return;
    }
    const isArtist = !!btn.dataset.feedFollowArtist;
    const id = isArtist ? btn.dataset.feedFollowArtist : btn.dataset.feedFollowUser;
    if (!id) return;
    const wasFollowing = btn.dataset.following === "1";
    const endpoint = isArtist
      ? `/api/v1/artists/${encodeURIComponent(id)}/follow`
      : `/api/v1/users/${encodeURIComponent(id)}/follow`;
    btn.dataset.busy = "1";
    // 낙관적 토글
    btn.classList.toggle("is-following", !wasFollowing);
    btn.dataset.following = wasFollowing ? "0" : "1";
    btn.textContent = wasFollowing ? "팔로우" : "팔로잉";
    try {
      await apiFetch(endpoint, {
        method: wasFollowing ? "DELETE" : "POST",
        auth: true,
        throwOnError: true
      });
      // 같은 작성자/아티스트의 모든 카드 동기화
      document.querySelectorAll(
        isArtist
          ? `[data-feed-follow-artist="${id}"]`
          : `[data-feed-follow-user="${id}"]`
      ).forEach(b => {
        b.classList.toggle("is-following", !wasFollowing);
        b.dataset.following = wasFollowing ? "0" : "1";
        b.textContent = wasFollowing ? "팔로우" : "팔로잉";
      });
    } catch (err) {
      // 롤백
      btn.classList.toggle("is-following", wasFollowing);
      btn.dataset.following = wasFollowing ? "1" : "0";
      btn.textContent = wasFollowing ? "팔로잉" : "팔로우";
      console.warn("[#145 follow] 실패", { status: err?.status, body: err?.body });
      alert(err?.message || "팔로우 처리에 실패했어요.");
    } finally {
      btn.dataset.busy = "0";
    }
  });
}

function bindLuminaFeedDelete() {
  if (document._feedDeleteBound) return;
  document._feedDeleteBound = true;
  // #152 — 같은 위치에서 작성자 영역 클릭 라우팅도 같이 등록
  document.addEventListener("click", e => {
    const link = e.target.closest("[data-user-profile-link]");
    if (!link) return;
    // 안에 있는 버튼들(좋아요·수정·삭제·팔로우 등) 클릭은 무시
    if (e.target.closest("button, a")) return;
    e.preventDefault();
    const target = link.dataset.userProfileLink;
    if (target) window.location.href = target;
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
      renderLuminaFeed();
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
      renderLuminaFeed();
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
    if (e.target.closest(".feed-post-asset-item, .feed-post-asset-item img, .feed-link-preview-thumb img, .feed-post-avatar img, .lightbox-img, .lightbox-overlay")) {
      e.preventDefault();
    }
  });
  // 드래그 차단 (이미지 끌어서 저장 방지)
  document.addEventListener("dragstart", e => {
    if (e.target.closest(".feed-post-asset-item img, .lightbox-img")) {
      e.preventDefault();
    }
  });
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

const FEED_COMPOSE_MAX_IMAGES = 4;
const FEED_COMPOSE_MAX_BODY = 2000;
const FEED_ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// 작성창 상태 — 첨부 이미지 (assetId 확정된 것만 추적)
let _feedComposeAssets = []; // [{ assetId, previewUrl, fileName, mimeType }]
let _feedComposeUploading = false;

/* 카드의 이미지 그리드 렌더 (post.assets[].asset.url 기반) */
function renderFeedPostAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) return "";
  const items = assets
    .filter(a => a?.asset?.url)
    .slice(0, FEED_COMPOSE_MAX_IMAGES);
  if (items.length === 0) return "";
  const gridClass = `feed-post-assets feed-post-assets-${items.length}`;
  const isMulti = items.length > 1;
  // 라이트박스용 src 묶음을 부모에 데이터로 (다음/이전 슬라이드 가능)
  const sources = items.map(a => a.asset.url).join("|");
  return `
    <div class="${gridClass}${isMulti ? ' has-multi' : ''}" data-feed-asset-group="${feedEscapeHtml(sources)}">
      ${items.map((a, idx) => {
        const src = feedEscapeHtml(a.asset.thumbnailUrl || a.asset.url);
        const full = feedEscapeHtml(a.asset.url);
        const badge = (idx === 0 && isMulti)
          ? `<span class="feed-asset-multi-badge" aria-label="${items.length}장의 이미지"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 5h12v10H4zM18 7h2v10H8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>${items.length}</span>`
          : "";
        return `<a class="feed-post-asset-item" href="${full}" target="_blank" rel="noopener noreferrer" data-feed-asset data-asset-index="${idx}" data-asset-url="${full}">
          ${badge}
          <img src="${src}" alt="" loading="lazy" oncontextmenu="return false;" draggable="false" />
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

/* 작성창 전체 초기화 — 페이지 진입 시 1회 + 로그인 상태 변화 시 호출 */
function initFeedCompose() {
  const composeRoot = document.getElementById("feedCompose");
  const guestRoot = document.getElementById("feedComposeGuest");
  if (!composeRoot && !guestRoot) return; // 피드 페이지가 아님

  const loggedIn = isLoggedIn();
  if (composeRoot) composeRoot.hidden = !loggedIn;
  if (guestRoot) guestRoot.hidden = loggedIn;

  if (loggedIn) {
    syncFeedComposeAvatar();
    bindFeedComposeOnce();
  } else {
    // 비로그인 카드의 로그인 CTA
    if (guestRoot && !guestRoot._bound) {
      guestRoot._bound = true;
      guestRoot.querySelector('[data-action="login"]')?.addEventListener("click", e => {
        e.preventDefault();
        openAuthModal?.("login");
      });
    }
  }
}

function syncFeedComposeAvatar() {
  const avatarRoot = document.getElementById("feedComposeAvatar");
  if (!avatarRoot) return;
  const auth = getAuth?.();
  const user = auth?.user || {};
  const name = user.displayName || user.email?.split("@")[0] || "?";
  const initial = name.charAt(0);
  const avatarUrl = user.avatarUrl || user.avatarAsset?.url || "";
  if (avatarUrl) {
    avatarRoot.innerHTML = `<img src="${feedEscapeHtml(avatarUrl)}" alt="${feedEscapeHtml(name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="feed-compose-avatar-fallback" style="display:none;">${feedEscapeHtml(initial)}</span>`;
  } else {
    avatarRoot.innerHTML = `<span class="feed-compose-avatar-fallback">${feedEscapeHtml(initial)}</span>`;
  }
}

function bindFeedComposeOnce() {
  const composeRoot = document.getElementById("feedCompose");
  if (!composeRoot || composeRoot._bound) return;
  composeRoot._bound = true;

  const textarea = document.getElementById("feedComposeText");
  const counter = document.getElementById("feedComposeCounter");
  const submitBtn = document.getElementById("feedComposeSubmit");
  const fileInput = document.getElementById("feedComposeFile");

  // 글자수 + 제출 가능 여부
  const updateState = () => {
    const len = textarea.value.length;
    if (counter) counter.textContent = `${len} / ${FEED_COMPOSE_MAX_BODY}`;
    const hasContent = textarea.value.trim().length > 0 || _feedComposeAssets.length > 0;
    if (submitBtn) submitBtn.disabled = !hasContent || _feedComposeUploading;
  };

  textarea?.addEventListener("input", updateState);

  // 파일 선택 → 업로드
  fileInput?.addEventListener("change", async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // 같은 파일 다시 선택 가능하게
    if (files.length === 0) return;

    const remaining = FEED_COMPOSE_MAX_IMAGES - _feedComposeAssets.length;
    if (remaining <= 0) {
      setFeedComposeMessage(`이미지는 최대 ${FEED_COMPOSE_MAX_IMAGES}장까지 첨부할 수 있어요.`, "warn");
      return;
    }
    const accepted = files.slice(0, remaining);
    if (files.length > accepted.length) {
      setFeedComposeMessage(`이미지는 최대 ${FEED_COMPOSE_MAX_IMAGES}장까지 첨부할 수 있어요. ${accepted.length}장만 추가했어요.`, "warn");
    }

    for (const file of accepted) {
      if (!FEED_ALLOWED_IMAGE_MIMES.includes(file.type)) {
        setFeedComposeMessage("JPG, PNG, WEBP, GIF 파일만 첨부할 수 있어요.", "warn");
        continue;
      }
      await uploadFeedComposeImage(file);
    }
    updateState();
  });

  // 제출
  submitBtn?.addEventListener("click", async () => {
    if (submitBtn.disabled) return;
    const body = (textarea?.value || "").trim();
    if (!body && _feedComposeAssets.length === 0) {
      setFeedComposeMessage("내용 또는 이미지를 추가해주세요.", "warn");
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "게시 중";
    try {
      const payload = { body };
      if (_feedComposeAssets.length > 0) {
        payload.assetIds = _feedComposeAssets.map(a => a.assetId);
      }
      // #089 — 본문에서 첫 https URL 자동 감지 → externalUrl로 함께 전송 (백엔드가 metadata 저장)
      const urlMatch = body.match(/\bhttps:\/\/[^\s)\]]+/i);
      if (urlMatch) {
        payload.externalUrl = urlMatch[0];
      }
      await apiFetch("/api/v1/lumina-feed/posts", {
        method: "POST",
        auth: true,
        throwOnError: true,
        body: payload
      });
      // 성공 → 작성창 초기화 + 피드 새로고침
      textarea.value = "";
      _feedComposeAssets = [];
      renderFeedComposeThumbs();
      setFeedComposeMessage("피드에 올라갔어요.", "success");
      updateState();
      // 피드 다시 로드
      await loadLuminaFeedData(_luminaFeedFilter || "all");
      renderLuminaFeed();
    } catch (err) {
      const msg = err?.body?.message || err?.message || "";
      let userMsg = "게시하지 못했어요. 잠시 후 다시 시도해주세요.";
      if (/Policy violation|forbidden|too long|too short/i.test(msg)) {
        userMsg = "정책에 맞지 않는 내용이 포함되어 있어요. 표현을 수정해 주세요.";
      } else if (err?.status === 401) {
        userMsg = "로그인이 만료됐어요. 다시 로그인해주세요.";
      }
      setFeedComposeMessage(userMsg, "warn");
    } finally {
      submitBtn.textContent = "게시하기";
      updateState();
    }
  });

  // 썸네일 영역 — 제거 버튼 위임
  const thumbs = document.getElementById("feedComposeThumbs");
  thumbs?.addEventListener("click", e => {
    const removeBtn = e.target.closest("[data-feed-thumb-remove]");
    if (!removeBtn) return;
    const idx = Number(removeBtn.dataset.feedThumbRemove);
    if (Number.isInteger(idx) && idx >= 0 && idx < _feedComposeAssets.length) {
      _feedComposeAssets.splice(idx, 1);
      renderFeedComposeThumbs();
      updateState();
    }
  });

  updateState();
}

function setFeedComposeMessage(text, kind) {
  const el = document.getElementById("feedComposeMessage");
  if (!el) return;
  if (!text) { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = text;
  el.dataset.kind = kind || "info";
  // success는 잠시 후 자동 숨김
  if (kind === "success") {
    setTimeout(() => {
      if (el.dataset.kind === "success") { el.hidden = true; el.textContent = ""; }
    }, 2400);
  }
}

function renderFeedComposeThumbs() {
  const thumbs = document.getElementById("feedComposeThumbs");
  if (!thumbs) return;
  if (_feedComposeAssets.length === 0) {
    thumbs.hidden = true;
    thumbs.innerHTML = "";
    return;
  }
  thumbs.hidden = false;
  thumbs.innerHTML = _feedComposeAssets.map((asset, idx) => `
    <div class="feed-compose-thumb">
      <img src="${feedEscapeHtml(asset.previewUrl)}" alt="" />
      <button type="button" class="feed-compose-thumb-remove" data-feed-thumb-remove="${idx}" aria-label="이미지 삭제">×</button>
    </div>
  `).join("");
}

/* 단일 이미지 업로드 — intent → PUT → confirm */
async function uploadFeedComposeImage(file) {
  _feedComposeUploading = true;
  setFeedComposeMessage(`${file.name} 업로드 중…`, "info");
  try {
    // 1. intent 생성
    const intent = await apiFetch("/api/v1/me/assets/upload-intents", {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {
        fileName: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size
      }
    });
    if (!intent?.asset?.id || !intent?.upload) {
      throw new Error("Invalid upload intent response");
    }
    const assetId = intent.asset.id;
    const upload = intent.upload;

    // 2. 파일 업로드 (S3/R2 direct upload)
    if (upload.mode === "direct_upload_ready" && upload.url) {
      const headers = upload.requiredHeaders || {};
      const putRes = await fetch(upload.url, {
        method: upload.method || "PUT",
        headers,
        body: file
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status})`);
      }
    }
    // local mode (metadata_only)는 PUT 없이 confirm으로 바로 진행

    // 3. confirm
    const confirmed = await apiFetch(`/api/v1/me/assets/${encodeURIComponent(assetId)}/confirm-upload`, {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {}
    });
    const finalAsset = confirmed?.asset || confirmed;
    const previewUrl = finalAsset?.thumbnailUrl || finalAsset?.url || URL.createObjectURL(file);

    _feedComposeAssets.push({
      assetId,
      previewUrl,
      fileName: file.name,
      mimeType: file.type
    });
    renderFeedComposeThumbs();
    setFeedComposeMessage("", "info"); // 메시지 클리어
  } catch (err) {
    const msg = err?.body?.message || err?.message || "";
    let userMsg = "이미지를 업로드하지 못했어요.";
    if (/too large|payload/i.test(msg)) {
      userMsg = "파일이 너무 커요. 더 작은 이미지를 선택해주세요.";
    } else if (/unsupported|mime/i.test(msg)) {
      userMsg = "지원하지 않는 파일 형식이에요. JPG, PNG, WEBP, GIF로 다시 올려주세요.";
    } else if (err?.status === 401) {
      userMsg = "로그인이 만료됐어요. 다시 로그인해주세요.";
    }
    setFeedComposeMessage(userMsg, "warn");
  } finally {
    _feedComposeUploading = false;
  }
}

/* ══════════════════════════════════════════════
   #057 — 루미나 충전소 (charge.html)
   - 차모 backend: GET /api/v1/lumina-station?take=5
   - 결제 주문: POST /api/v1/payments/orders (Idempotency-Key 필수)
   - 보안 원칙:
     1) 클라이언트에서 임의로 잔액 변경 X — 항상 백엔드 재조회 결과만 신뢰
     2) Idempotency-Key는 클라이언트 생성 UUID v4 (중복 결제 방지)
     3) URL에 결제 정보(금액/상품ID 등) 노출 X
     4) payment.status="pg_pending"이면 결제 버튼 비활성
     5) 에러 응답 그대로 보여주지 않고 사용자 문구로 변환
   ══════════════════════════════════════════════ */

let _chargeStationData = null;
let _chargeOrdering = false;

/* UUID v4 생성 — Idempotency-Key 용도. crypto.randomUUID 우선, fallback */
function generateIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatCurrencyKRW(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0원";
  return `${n.toLocaleString("ko-KR")}원`;
}

function formatLuminaAmount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("ko-KR");
}

/* 충전소 데이터 로드 */
async function loadChargeStationData() {
  try {
    const data = await apiFetch("/api/v1/lumina-station?take=5", { auth: true });
    _chargeStationData = data || null;
    return _chargeStationData;
  } catch (err) {
    console.warn("[Lumina] /lumina-station 실패:", err);
    return null;
  }
}

function renderChargePage() {
  const balanceEl = document.getElementById("chargeBalance");
  const lastOrderEl = document.getElementById("chargeLastOrder");
  const policyHintEl = document.getElementById("chargePolicyHint");
  const productGrid = document.getElementById("chargeProductGrid");
  const ordersList = document.getElementById("chargeOrdersList");
  const pendingNotice = document.getElementById("chargePendingNotice");

  const data = _chargeStationData;
  if (!data) {
    if (productGrid) productGrid.innerHTML = `<div class="charge-error">충전 정보를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</div>`;
    if (ordersList) ordersList.innerHTML = `<div class="charge-empty">불러오지 못했어요.</div>`;
    return;
  }

  // 1. 잔액
  const balance = data.wallet?.cachedBalance ?? data.wallet?.balance ?? 0;
  if (balanceEl) balanceEl.textContent = formatLuminaAmount(balance);

  // 2. 정책 힌트
  if (policyHintEl) {
    const unitL = data.policy?.paidLikeUnitPriceLumina ?? 10;
    policyHintEl.textContent = `1개 = ${unitL}L`;
  }

  // 3. 결제 status — pg_pending이면 안내 카드 표시 + 결제 버튼 비활성
  const paymentStatus = data.payment?.status || "";
  const isPgPending = paymentStatus === "pg_pending";
  if (pendingNotice) pendingNotice.hidden = !isPgPending;

  // 4. 마지막 주문 표시
  const recentOrders = Array.isArray(data.recentOrders) ? data.recentOrders : [];
  if (lastOrderEl) {
    if (recentOrders.length > 0) {
      const last = recentOrders[0];
      const date = last.paidAt || last.createdAt;
      lastOrderEl.textContent = date ? formatRelativeDate(date) : "최근 충전 없음";
    } else {
      lastOrderEl.textContent = "충전 이력 없음";
    }
  }

  // 5. 상품 그리드
  const products = Array.isArray(data.products) ? data.products : [];
  if (productGrid) {
    if (products.length === 0) {
      productGrid.innerHTML = `<div class="charge-empty">지금 선택할 수 있는 충전 상품이 없어요.</div>`;
    } else {
      productGrid.innerHTML = products.map(p => renderChargeProductCard(p, isPgPending)).join("");
    }
  }

  // 6. 최근 충전 내역
  if (ordersList) {
    if (recentOrders.length === 0) {
      ordersList.innerHTML = `<div class="charge-empty">아직 충전 이력이 없어요. 첫 충전이 곧 시작됩니다.</div>`;
    } else {
      ordersList.innerHTML = recentOrders.map(renderChargeOrderRow).join("");
    }
  }
}

function renderChargeProductCard(p, isPgPending) {
  const productId = p.id || "";
  const name = feedEscapeHtml(p.name || "충전 상품");
  const luminaAmount = Number(p.luminaAmount || 0);
  const bonusAmount = Number(p.bonusAmount || 0);
  const totalLumina = Number(p.totalLumina || luminaAmount + bonusAmount);
  const priceAmount = Number(p.priceAmount || 0);
  const bonusRate = Number(p.bonusRate || 0);
  const isBest = !!p.isBestValue;
  const discountAmount = Number(p.discountAmount || 0);

  return `
    <article class="charge-product-card${isBest ? ' is-best' : ''}" data-product-id="${feedEscapeHtml(productId)}">
      ${isBest ? `<span class="charge-best-badge" title="가장 많이 선택되는 충전팩">BEST</span>` : ""}
      <header class="charge-product-head">
        <h3 class="charge-product-name">${name}</h3>
        ${bonusRate > 0 ? `<span class="charge-bonus-rate">+${bonusRate}% 보너스</span>` : ""}
      </header>
      <div class="charge-product-amount">
        <span class="charge-amount-main">${formatLuminaAmount(totalLumina)}<small>L</small></span>
        ${bonusAmount > 0
          ? `<span class="charge-amount-detail">기본 ${formatLuminaAmount(luminaAmount)}L + 보너스 ${formatLuminaAmount(bonusAmount)}L</span>`
          : ""}
      </div>
      <div class="charge-product-price">
        <strong>${formatCurrencyKRW(priceAmount)}</strong>
        ${discountAmount > 0 ? `<small class="charge-discount">${formatCurrencyKRW(discountAmount)} 할인</small>` : ""}
      </div>
      <button
        class="charge-buy-btn"
        type="button"
        data-charge-buy="${feedEscapeHtml(productId)}"
        ${isPgPending ? 'disabled' : ''}>
        ${isPgPending ? '결제 준비 중' : `${formatLuminaAmount(totalLumina)}L 충전하기`}
      </button>
    </article>
  `;
}

function renderChargeOrderRow(order) {
  const status = order.status || "pending";
  const statusLabel = ({
    pending: "결제 대기",
    paid: "결제 완료",
    failed: "결제 실패",
    cancelled: "결제 취소",
    refunded: "환불 완료"
  })[status] || status;
  const date = order.paidAt || order.createdAt || "";
  const dateText = date ? new Date(date).toLocaleDateString("ko-KR") : "-";
  const productName = feedEscapeHtml(order.productName || order.luminaProduct?.name || "충전");
  const lumina = Number(order.luminaAmount || order.totalLumina || 0);
  const price = Number(order.priceAmount || 0);

  return `
    <div class="charge-order-row" data-order-status="${status}">
      <div class="charge-order-meta">
        <strong>${productName}</strong>
        <small>${dateText} · ${statusLabel}</small>
      </div>
      <div class="charge-order-amount">
        <span class="charge-order-lumina">+${formatLuminaAmount(lumina)}L</span>
        <small>${formatCurrencyKRW(price)}</small>
      </div>
    </div>
  `;
}

/* 상품 카드 클릭 → 주문 생성 → PG 리다이렉트 (또는 안내) */
async function handleChargeBuy(productId) {
  if (_chargeOrdering) return;
  if (!productId) {
    alert("상품 정보를 확인할 수 없어요.");
    return;
  }
  if (!isLoggedIn()) {
    openAuthModal?.("login");
    return;
  }

  _chargeOrdering = true;
  // 보안: 같은 주문이 중복 생성되지 않도록 클라이언트 UUID 생성
  const idempotencyKey = generateIdempotencyKey();

  // 결제 버튼 로딩 상태 (#059: "결제 요청 중")
  const btn = document.querySelector(`[data-charge-buy="${productId}"]`);
  const originalText = btn?.textContent || "충전하기";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "결제 요청 중";
  }

  try {
    const order = await apiFetch("/api/v1/payments/orders", {
      method: "POST",
      auth: true,
      throwOnError: true,
      headers: { "Idempotency-Key": idempotencyKey },
      body: { luminaProductId: productId }
    });

    // 응답 확인 — PG 리다이렉트 URL이 있으면 이동, 아니면 안내
    const redirectUrl = order?.payment?.redirectUrl || order?.checkoutUrl || order?.paymentUrl;
    const status = order?.status || order?.payment?.status || "";

    if (redirectUrl && /^https?:\/\//i.test(redirectUrl)) {
      // PG 리다이렉트 — 보안: URL이 https인지 한 번 더 확인
      window.location.href = redirectUrl;
      return; // 페이지 떠나므로 후속 처리 불필요
    }

    if (status === "pg_pending" || status === "pending") {
      alert("결제 기능은 현재 준비 중입니다. 상품 정보와 예상 지급 루미나만 먼저 확인할 수 있어요.");
      // 충전소 데이터 재조회 (잔액은 변동 없지만 상태 갱신)
      await loadChargeStationData();
      renderChargePage();
    } else {
      alert("결제창에서 최종 금액과 상품명을 확인한 뒤 결제를 진행해 주세요.");
      await loadChargeStationData();
      renderChargePage();
    }
  } catch (err) {
    const msg = err?.body?.message || err?.message || "";
    const status = err?.status;
    // #059 오류/안내 문구 적용
    let userMsg = "결제 요청을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";
    if (status === 401) userMsg = "루미나 충전은 로그인 후 이용할 수 있어요.";
    else if (status === 404) userMsg = "지금 선택할 수 있는 충전 상품이 없어요. 페이지를 새로고침해 주세요.";
    else if (status === 409) userMsg = "이미 결제 요청을 처리 중이에요. 잠시 후 다시 시도해 주세요.";
    else if (status === 429) userMsg = "요청이 잠시 많아요. 잠시 후 다시 시도해 주세요.";
    else if (/insufficient|inactive/i.test(msg)) userMsg = "현재 충전이 어려운 상태예요. 고객센터로 문의해 주세요.";
    else if (/cancelled|cancel/i.test(msg)) userMsg = "결제가 취소됐어요. 루미나는 충전되지 않았습니다.";
    else if (/failed|fail/i.test(msg)) userMsg = "결제가 완료되지 않았어요. 결제 수단 또는 한도를 확인해 주세요.";
    alert(userMsg);
  } finally {
    _chargeOrdering = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

function bindChargePage() {
  // 비로그인 게이트의 로그인 CTA
  const gate = document.getElementById("chargeLoginGate");
  if (gate && !gate._bound) {
    gate._bound = true;
    document.getElementById("chargeLoginBtn")?.addEventListener("click", e => {
      e.preventDefault();
      openAuthModal?.("login");
    });
  }
  // 상품 카드 클릭 — 이벤트 위임
  const grid = document.getElementById("chargeProductGrid");
  if (grid && !grid._bound) {
    grid._bound = true;
    grid.addEventListener("click", e => {
      const buyBtn = e.target.closest("[data-charge-buy]");
      if (!buyBtn || buyBtn.disabled) return;
      const productId = buyBtn.dataset.chargeBuy;
      handleChargeBuy(productId);
    });
  }
}

async function initChargePage() {
  const content = document.getElementById("chargePageContent");
  const gate = document.getElementById("chargeLoginGate");
  if (!content && !gate) return; // 충전소 페이지 아님

  bindChargePage();

  if (!isLoggedIn()) {
    if (gate) gate.hidden = false;
    if (content) content.hidden = true;
    return;
  }
  if (gate) gate.hidden = true;
  if (content) content.hidden = false;

  await loadChargeStationData();
  renderChargePage();
}

/* 상대 시간 포맷 — 작은 헬퍼 (없으면 fallback) */
function formatRelativeDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const diff = Date.now() - d.getTime();
  const day = 86400000;
  if (diff < day) return "오늘";
  if (diff < 2 * day) return "어제";
  if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`;
  return d.toLocaleDateString("ko-KR");
}

/* ── 상태 메타 ──────────────────────────────── */
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
const shortformsLocal = [
  {
    title: "딥 플럼 스테이지",
    artist: "윤세린",
    metric: "조회 12.4만",
    mainTone: "차갑게 각인",
    hubTone: "차가운 시선으로 무대를 잠그는 티저",
    tone: "조명은 뜨거워도 표정은 쉽게 흔들리지 않아요. 제 무대는 한 번 보고 지나가는 장면이 아니라, 끝난 뒤에도 온도가 남는 순간이어야 하니까요.",
    image: "./assets/characters/yoon-serin/cover.png"
  },
  {
    title: "하이틴 센터 로그",
    artist: "한서율",
    metric: "조회 9.7만",
    mainTone: "오늘도 밝게",
    hubTone: "햇살 같은 에너지로 무대를 여는 컷",
    tone: "오늘도 제일 먼저 웃고, 제일 오래 손 흔들게요. 무대가 낯설지 않게, 제가 먼저 반짝이면서 기다리고 있을게요.",
    image: "./assets/characters/han-seoyul/cover.png"
  },
  {
    title: "도아의 리액션 캠",
    artist: "박도아",
    metric: "조회 15.3만",
    mainTone: "같이 웃자",
    hubTone: "일상과 먹방 리액션이 편하게 번지는 순간",
    tone: "맛있는 거 보면 표정부터 먼저 나와요. 꾸미려고 한 건 아닌데, 같이 웃어주면 그게 제일 좋은 장면이 되더라구요.",
    image: "./assets/characters/park-doa/cover.png"
  },
  {
    title: "블랙 드레스 필름",
    artist: "최서진",
    metric: "조회 6.2만",
    mainTone: "고요한 시선",
    hubTone: "고급스러운 정적과 시선이 남는 화보 컷",
    tone: "많은 말보다 오래 남는 한 컷을 믿어요. 시선이 머무는 동안, 제가 가진 고요한 결을 천천히 보여드릴게요.",
    image: "./assets/characters/choi-seojin/cover.png"
  },
  {
    title: "젠더리스 런웨이",
    artist: "차도현",
    metric: "조회 8.5만",
    mainTone: "경계를 넘어",
    hubTone: "하이패션 무드로 무대를 장악하는 컷",
    tone: "제게 패션은 갑옷이고, 무대는 선언이에요. 어떤 이름으로도 다 설명되지 않는 방식으로, 오늘도 제 기준을 세워보겠습니다.",
    image: "./assets/characters/cha-dohyun/cover.png"
  },
  {
    title: "새벽 라이브 노트",
    artist: "서유안",
    metric: "조회 7.1만",
    mainTone: "잔잔히 오래",
    hubTone: "자연스러운 숨결과 음악적 깊이가 흐르는 컷",
    tone: "크게 말하지 않아도 닿는 마음이 있다고 생각해요. 오늘 남긴 작은 멜로디가 누군가의 밤에 조용히 머물렀으면 좋겠습니다.",
    image: "./assets/characters/seo-yuan/cover.png"
  },
  {
    title: "비비드 픽업 컷",
    artist: "하윤아",
    metric: "조회 11.2만",
    mainTone: "색을 먼저",
    hubTone: "스트릿 뷰티와 트렌드 감도가 튀는 픽업 컷",
    tone: "오늘의 색은 제가 먼저 정해볼게요. 빠르게 지나가는 피드 안에서도 한 번쯤 멈추게 만드는 감각, 그걸 제 방식으로 보여드릴게요.",
    image: "./assets/characters/ha-yuna/cover.png"
  },
  {
    title: "누아르 클로즈업",
    artist: "권태준",
    metric: "조회 5.9만",
    mainTone: "낮게 남는 눈빛",
    hubTone: "깊은 눈빛과 낮은 톤이 쌓이는 무드 컷",
    tone: "많은 대사는 필요 없을 때가 있습니다. 긴 침묵과 낮은 목소리 사이에, 제가 남기고 싶은 감정이 더 선명해지니까요.",
    image: "./assets/characters/kwon-taejun/cover.png"
  }
];

/* ── 비즈니스 패키지 ─────────────────────────── */
const businessPackages = [
  { name: "숏폼 캠페인", target: "뷰티 / 패션 / 커머스", summary: "아티스트의 말투와 무드를 살린 짧은 영상형 캠페인입니다. 팬이 저장하고 다시 보는 장면을 중심으로 설계합니다.", deliverables: ["숏폼 콘셉트 3종", "썸네일 방향 3종", "브랜드 컷 1세트"] },
  { name: "프리미엄 에디토리얼", target: "주얼리 / 럭셔리 / 에디토리얼", summary: "최서진, 윤세린, 차도현처럼 고유한 무드가 강한 아티스트를 중심으로 화보형 장면을 구성합니다.", deliverables: ["에디토리얼 컷", "브랜드 티저", "룩북형 이미지"] },
  { name: "캐릭터 브랜딩", target: "브랜드 콜라보 / IP 협업", summary: "캐릭터의 설정, 팬덤 반응, 반복 노출 포인트를 함께 설계하는 장기형 IP 협업입니다.", deliverables: ["캐릭터 협업안", "콘텐츠 콘셉트", "팬덤 운영 제안"] }
];

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
function renderMainArtists() {
  const root = document.getElementById("mainArtistGrid");
  if (!root) return;

  const list = _artists.filter(isPublicLineup);

  // 좋아요 많은 순으로 정렬 (랭킹 데이터가 도착하면 자동 반영)
  // _rankings가 비어있으면 sort 결과 0 → 원래 순서 유지 (fallback)
  list.sort((a, b) => getLikesCount(b.slug) - getLikesCount(a.slug));

  root.innerHTML = list.map(a => `
    <article class="artist-card clickable-card" data-href="./character-detail.html?slug=${a.slug}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      <div class="artist-media artist-media-${a.slug}">
        <img class="artist-media-image artist-media-image-${a.slug}"
          src="${a.images.thumb || a.images.cover}" alt="${a.publicName}"
          onerror="this.style.display='none'" />
        <div class="artist-media-copy">
          <span class="artist-role">${a.role}</span>
          <strong>${a.name}</strong>
        </div>
      </div>
      <div class="artist-body">
        <p>${artistToneCopy(a)}</p>
        <div class="tag-list">${a.tags.map(t => `<span>${t}</span>`).join("")}</div>
        <a class="text-link" href="./character-detail.html?slug=${a.slug}">무드 보기</a>
      </div>
    </article>
  `).join("");
}

/* ── 렌더링: 메인 hero "이달의 아티스트" ─────── */
/* 좋아요 1위 메인/프리미엄 캐릭터를 자동으로 hero에 표시.
   - 좋아요 데이터가 비어있으면 첫 번째 메인 캐릭터로 fallback (HTML 하드코딩과 일관)
   - 루미나 픽 데이터(_rankings)가 도착하면 자동 갱신 */
function renderHeroFeature() {
  const root = document.getElementById("heroFeature");
  if (!root) return;

  // 메인 라인업 6명 (status는 무시 — 운영진 결정한 공식 라인업)
  const candidates = _artists.filter(isPublicLineup);
  if (!candidates.length) return; // 후보 없으면 HTML fallback 유지

  // 좋아요 많은 순으로 정렬, 동률이면 원래 등록 순서
  const sorted = [...candidates].sort((a, b) => getLikesCount(b.slug) - getLikesCount(a.slug));
  const top = sorted[0];
  const likes = getLikesCount(top.slug);

  // 좋아요 0이면 "이달의 아티스트" (fallback 첫 캐릭), 1+ 있으면 "지금 1위" 강조
  const label = likes > 0 ? `이달의 픽 · ${formatLikeCount(likes)} 응원` : "이달의 아티스트";

  // 태그 최대 3개만 표시
  const tagsHTML = (top.tags || []).slice(0, 3).map(t => `<li>${t}</li>`).join("");

  root.innerHTML = `
    <div class="hero-feature-media">
      <img src="${top.images.thumb || top.images.cover}" alt="${top.publicName} 프로필" />
    </div>
    <div class="hero-feature-body">
      <span class="hero-feature-label">${label}</span>
      <strong>${top.publicName}</strong>
      <p class="hero-feature-summary">${top.summary || ""}</p>
      <p>${artistToneCopy(top) || top.intro || ""}</p>
      <ul class="hero-feature-tags">${tagsHTML}</ul>
      <a class="text-link hero-feature-link" href="./character-detail.html?slug=${top.slug}">${top.publicName} 무드 보기</a>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   루미나 픽 (popular-vote.html)
   3탭: Monthly Pick / Cheer Race / Hall of Fame
   백엔드 API:
   - GET /api/v1/popular-vote/main-pick
   - GET /api/v1/popular-vote/hall-of-fame/monthly-picks?year={year}
   - GET /api/v1/popular-vote/hall-of-fame/year-champion?year={year}
   - Debut Race는 기존 boost-campaigns 흐름 (free-like)
   ══════════════════════════════════════════════ */

let _popularVote = {
  mainPick: null,         // { campaign, leader, rankings }
  monthlyPicks: [],       // 월간 1위 배열 (해당 연도)
  yearChampion: null,     // { year, champion, rankings, rule }
  loaded: false
};

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

async function loadPopularVoteState() {
  const year = new Date().getFullYear();
  try {
    const [mainPick, monthlyPicks, yearChampion] = await Promise.all([
      apiFetch("/api/v1/popular-vote/main-pick").catch(err => {
        console.warn("[Lumina] main-pick 로드 실패:", err);
        return null;
      }),
      apiFetch(`/api/v1/popular-vote/hall-of-fame/monthly-picks?year=${year}`).catch(err => {
        console.warn("[Lumina] monthly-picks 로드 실패:", err);
        return null;
      }),
      apiFetch(`/api/v1/popular-vote/hall-of-fame/year-champion?year=${year}`).catch(err => {
        console.warn("[Lumina] year-champion 로드 실패:", err);
        return null;
      })
    ]);
    // 응답 형식이 배열일 수도 있고 { items: [] } 일 수도 — 양쪽 다 처리
    const monthlyArr = Array.isArray(monthlyPicks)
      ? monthlyPicks
      : (monthlyPicks?.items || monthlyPicks?.picks || []);
    _popularVote = {
      mainPick,
      monthlyPicks: monthlyArr,
      // year-champion 응답: { year, champion, rankings, rule } — 객체 통째로 저장
      yearChampion: yearChampion,
      loaded: true
    };
  } catch (err) {
    console.warn("[Lumina] 루미나 픽 로드 실패:", err);
    _popularVote.loaded = true; // 실패해도 fallback 렌더링은 진행
  }
}

/* ── 렌더: Main Pick 탭 ──
   백엔드 응답이 비어있으면 _artists 메인 + _rankings로 fallback */
function renderMainPickTab() {
  const leaderRoot = document.getElementById("mainPickLeader");
  const rankingsRoot = document.getElementById("mainPickRankings");
  if (!leaderRoot || !rankingsRoot) return;

  // 데이터 소스 결정: API 우선, 없으면 로컬 fallback
  const apiLeader = _popularVote.mainPick?.leader;
  const apiRankings = _popularVote.mainPick?.rankings;

  let leaderArtist = null;
  let rankingsList = [];

  if (apiLeader && Array.isArray(apiRankings) && apiRankings.length > 0) {
    // API 데이터 사용 — 차모 답변(2026-05-02 Q4) 기준 row 구조:
    // { rankNo, artist, totalFreeLikes, totalLuminaBoosts, totalWeightedScore }
    leaderArtist = getCharacterBySlug(apiLeader.artist?.slug || apiLeader.slug || apiLeader.artistSlug);
    rankingsList = apiRankings.map(r => ({
      artist: getCharacterBySlug(r.artist?.slug || r.slug || r.artistSlug),
      likes: r.totalFreeLikes ?? r.totalWeightedScore ?? r.totalLikes ?? r.likes ?? r.score ?? 0
    })).filter(r => r.artist);
  } else {
    // Fallback: 초기 공개 6명 라인업을 좋아요 순으로
    const mainList = _artists
      .filter(isPublicLineup)
      .map(a => ({ artist: a, likes: getLikesCount(a.slug) }))
      .sort((a, b) => b.likes - a.likes);
    if (mainList.length > 0) {
      leaderArtist = mainList[0].artist;
      rankingsList = mainList;
    }
  }

  // 헤더 패널 leader 이름 갱신
  const heroLeaderEl = document.getElementById("heroLeaderName");
  if (heroLeaderEl && leaderArtist) heroLeaderEl.textContent = leaderArtist.publicName;

  // 헤더 패널 캠페인 이름 자동 갱신 (백엔드 boost 캠페인 데이터 있으면 사용)
  const heroCampaignEl = document.getElementById("heroCampaignLabel");
  if (heroCampaignEl) {
    const campaignName = _currentCampaign?.name
      || _popularVote.mainPick?.campaign?.name
      || "응원 레이스";
    heroCampaignEl.textContent = campaignName;
  }

  if (!leaderArtist) {
    leaderRoot.innerHTML = `<div class="vote-empty">아직 첫 응원이 도착하기 전이에요. 이달의 주인공은 팬의 첫 선택에서 시작됩니다.</div>`;
    rankingsRoot.innerHTML = "";
    return;
  }

  // 1위 큰 카드
  const leaderLikes = rankingsList[0]?.likes ?? getLikesCount(leaderArtist.slug);
  // 이달의 픽 1위 카드는 팬이 바로 읽을 수 있도록 항상 수상소감 톤을 노출
  const messages = getCharacterMessages(leaderArtist.slug);
  const tribute = messages.tributeMessage;

  leaderRoot.innerHTML = `
    <article class="vote-leader-card clickable-card" data-href="./character-detail.html?slug=${leaderArtist.slug}">
      <div class="vote-leader-media">
        <img src="${leaderArtist.images.cover || leaderArtist.images.thumb}" alt="${leaderArtist.publicName}" />
        <div class="vote-leader-crown">👑</div>
      </div>
      <div class="vote-leader-body">
        <span class="vote-leader-label">이달의 픽 · ${formatLikeCount(leaderLikes)} 응원</span>
        <strong>${leaderArtist.publicName}</strong>
        <blockquote class="vote-leader-tribute">
          <p>${tribute}</p>
          <cite>— ${leaderArtist.publicName}</cite>
        </blockquote>
        <a class="text-link" href="./character-detail.html?slug=${leaderArtist.slug}">${leaderArtist.publicName} 무드 보기</a>
      </div>
    </article>
  `;

  // 2~N위 리스트 (1위 제외)
  const rest = rankingsList.slice(1);
  if (rest.length === 0) {
    rankingsRoot.innerHTML = "";
  } else {
    // 5위(=list 4번째)까지만 기본 표시, 나머지는 더보기 토글
    const VISIBLE_LIMIT = 4; // 2위~5위 = 4명
    const initiallyVisible = rest.slice(0, VISIBLE_LIMIT);
    const hidden = rest.slice(VISIBLE_LIMIT);

    const renderRow = (r, idx) => {
      const rankNum = idx + 2; // list 첫 항목이 2위
      // 1~3위는 금은동 메달, 4위 이후는 숫자만
      const medal = rankNum === 2 ? "🥈" : rankNum === 3 ? "🥉" : "";
      return `
        <li class="vote-ranking-row clickable-card" data-href="./character-detail.html?slug=${r.artist.slug}">
          <span class="vote-rank-label">
            ${medal ? `<span class="vote-rank-medal">${medal}</span>` : ""}
            <span class="vote-rank-num">${rankNum}위</span>
          </span>
          <img class="vote-rank-thumb" src="${r.artist.images.thumb || r.artist.images.cover}" alt="${r.artist.publicName}" />
          <div class="vote-rank-info">
            <strong>${r.artist.publicName}</strong>
            <small>${r.artist.summary || ""}</small>
          </div>
          <span class="vote-rank-likes">${formatLikeCount(r.likes)}</span>
        </li>
      `;
    };

    rankingsRoot.innerHTML = `
      <h3 class="vote-section-subtitle">응원 순위</h3>
      <ol class="vote-ranking-rows">
        ${initiallyVisible.map(renderRow).join("")}
        ${hidden.length > 0 ? `
          <div class="vote-ranking-hidden" hidden>
            ${hidden.map((r, i) => renderRow(r, i + VISIBLE_LIMIT)).join("")}
          </div>
        ` : ""}
      </ol>
      ${hidden.length > 0 ? `
        <button class="vote-rankings-more" type="button" data-action="toggle-rankings">
          <span class="vote-more-text">${hidden.length}명 더보기 ↓</span>
        </button>
      ` : ""}
    `;

    // 더보기 토글
    const moreBtn = rankingsRoot.querySelector(".vote-rankings-more");
    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        const hiddenBlock = rankingsRoot.querySelector(".vote-ranking-hidden");
        if (!hiddenBlock) return;
        const isOpen = !hiddenBlock.hasAttribute("hidden");
        if (isOpen) {
          hiddenBlock.setAttribute("hidden", "");
          moreBtn.querySelector(".vote-more-text").textContent = `${hidden.length}명 더보기 ↓`;
        } else {
          hiddenBlock.removeAttribute("hidden");
          moreBtn.querySelector(".vote-more-text").textContent = "접기 ↑";
        }
      });
    }
  }
}

/* ── 렌더: Debut Race 탭 ──
   status=public인 모든 활동 중 캐릭터를 좋아요 순으로 + 좋아요 버튼 작동
   (메인/프리미엄/sub 모두 포함 — 루미나 픽은 진짜 응원하는 곳) */
function renderDebutRaceTab() {
  const root = document.getElementById("debutRaceGrid");
  if (!root) return;

  const list = _artists
    .filter(a => a.status === "public")
    .map(a => ({ artist: a, likes: getLikesCount(a.slug) }))
    .sort((a, b) => b.likes - a.likes);

  if (list.length === 0) {
    root.innerHTML = `<div class="vote-empty">아직 진행 중인 픽이 없어요. 다음 라운드가 열리면 이곳에서 바로 응원할 수 있습니다.</div>`;
    return;
  }

  // URL ?artist=slug로 강조 대상 결정
  const highlightSlug = new URLSearchParams(window.location.search).get("artist");

  root.innerHTML = list.map((r, i) => {
    const a = r.artist;
    const isHighlighted = a.slug === highlightSlug;
    const rankNum = i + 1;
    // 1~3위 금은동 메달
    const medal = rankNum === 1 ? "🥇" : rankNum === 2 ? "🥈" : rankNum === 3 ? "🥉" : "";
    // 캐릭터별 1인칭 투표 독려 멘트
    const appeal = getCharacterMessages(a.slug).voteAppeal;
    return `
      <article class="vote-debut-card clickable-card${isHighlighted ? " is-highlighted" : ""}"
        data-href="./character-detail.html?slug=${a.slug}"
        style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
        <div class="vote-debut-rank-badge${medal ? " has-medal" : ""}">
          ${medal ? `<span class="vote-debut-medal">${medal}</span>` : ""}
          <span class="vote-debut-rank-num">${rankNum}위</span>
        </div>
        <div class="vote-debut-media">
          <img src="${a.images.thumb || a.images.cover}" alt="${a.publicName}" onerror="this.style.display='none'" />
          ${likeButtonHTML(a.slug, "like-btn-large like-btn-vote")}
        </div>
        <div class="vote-debut-body">
            <strong>${a.publicName}</strong>
            <small>${a.summary || ""}</small>
            <p class="vote-debut-appeal">"${appeal}"</p>
        </div>
      </article>
    `;
  }).join("");
}

/* ── 렌더: Hall of Fame 탭 ──
   Year Champion 큰 배너 + Monthly Picks 그리드 */
function renderHallOfFameTab() {
  const championRoot = document.getElementById("yearChampion");
  const monthlyRoot = document.getElementById("monthlyPicksGrid");
  if (!championRoot || !monthlyRoot) return;

  const year = new Date().getFullYear();

  // Year Champion (1년 누적 1위 — 연말에만 결정)
  // 차모 답변(2026-05-02 Q4) 기준 응답: { year, champion, rankings, rule }
  // champion은 row 구조: { rankNo, artist, totalFreeLikes, totalLuminaBoosts, totalWeightedScore } 또는 null
  const championWrapper = _popularVote.yearChampion;
  const champion = championWrapper?.champion || null;
  if (champion) {
    const championArtist = getCharacterBySlug(champion.artist?.slug || champion.slug || champion.artistSlug);
    if (championArtist) {
      const championScore = champion.totalWeightedScore ?? champion.totalFreeLikes ?? champion.totalScore ?? champion.score ?? 0;
      championRoot.innerHTML = `
        <article class="vote-year-champion-card clickable-card" data-href="./character-detail.html?slug=${championArtist.slug}">
          <div class="vote-year-trophy">🏆</div>
          <div class="vote-year-info">
            <span class="vote-year-label">${year} 연간 챔피언</span>
            <strong>${championArtist.publicName}</strong>
            <p>1년 누적 응원 ${formatLikeCount(championScore)}점으로 ${year}년 가장 빛난 이름이 되었습니다.</p>
          </div>
          <div class="vote-year-media">
            <img src="${championArtist.images.cover || championArtist.images.thumb}" alt="${championArtist.publicName}" />
          </div>
        </article>
      `;
    } else {
      championRoot.innerHTML = renderHallOfFameWaiting(year);
    }
  } else {
    championRoot.innerHTML = renderHallOfFameWaiting(year);
  }

  // Monthly Picks (해당 연도 월간 1위들)
  const picks = _popularVote.monthlyPicks || [];
  if (picks.length === 0) {
    monthlyRoot.innerHTML = `<div class="vote-empty">${year}년 첫 월간 1위는 팬들의 응원이 모이는 순간 이곳에 기록됩니다.</div>`;
    return;
  }

  // 월 내림차순 정렬 (최근 월 먼저)
  // 차모 답변 기준: MonthlyPickWinner row에 campaign, artist include
  const sorted = [...picks].sort((a, b) => (b.month || 0) - (a.month || 0));
  monthlyRoot.innerHTML = sorted.map(pick => {
    const artist = getCharacterBySlug(pick.artist?.slug || pick.slug || pick.artistSlug);
    const monthLabel = `${year}.${String(pick.month || "?").padStart(2, "0")}`;
    const score = pick.totalWeightedScore ?? pick.totalFreeLikes ?? pick.totalScore ?? pick.score ?? 0;
    if (!artist) {
      return `
        <div class="vote-monthly-card vote-monthly-card-unknown">
          <span class="vote-monthly-month">${monthLabel}</span>
          <strong>알 수 없는 아티스트</strong>
        </div>
      `;
    }
    return `
      <article class="vote-monthly-card clickable-card" data-href="./character-detail.html?slug=${artist.slug}">
        <div class="vote-monthly-media">
          <img src="${artist.images.thumb || artist.images.cover}" alt="${artist.publicName}" />
        </div>
        <div class="vote-monthly-info">
          <span class="vote-monthly-month">${monthLabel}</span>
          <strong>${artist.publicName}</strong>
          <small>${formatLikeCount(score)} 응원</small>
        </div>
      </article>
    `;
  }).join("");
}

function renderHallOfFameWaiting(year) {
  return `
    <div class="vote-year-waiting">
      <div class="vote-year-trophy" aria-hidden="true">🏆</div>
      <h3>${year} 연간 챔피언</h3>
      <p>이 자리는 올해 가장 오래 사랑받은 아티스트에게 열립니다. 매일의 응원이 1년의 영광으로 이어집니다.</p>
    </div>
  `;
}

/* ── 탭 전환 ── */
function bindVoteTabs() {
  const root = document.getElementById("voteTabs");
  if (!root) return;
  const buttons = [...root.querySelectorAll(".vote-tab-btn")];
  const panels = {
    "main-pick":   document.getElementById("tabMainPick"),
    "debut-race":  document.getElementById("tabDebutRace"),
    "hall-of-fame": document.getElementById("tabHallOfFame")
  };
  function activate(tabKey) {
    buttons.forEach(b => {
      const isActive = b.dataset.tab === tabKey;
      b.classList.toggle("is-active", isActive);
      b.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    Object.entries(panels).forEach(([k, panel]) => {
      if (!panel) return;
      const isActive = k === tabKey;
      panel.classList.toggle("is-active", isActive);
      if (isActive) panel.removeAttribute("hidden");
      else          panel.setAttribute("hidden", "");
    });
  }
  buttons.forEach(b => {
    b.addEventListener("click", () => activate(b.dataset.tab));
  });
  // URL ?tab=...로 초기 탭 결정
  const initialTab = new URLSearchParams(window.location.search).get("tab");
  if (initialTab && panels[initialTab]) {
    activate(initialTab);
  }
}

/* ── 루미나 픽 페이지 init ── */
async function initPopularVotePage() {
  // 캠페인/랭킹 + 루미나 픽 데이터 + 무료 좋아요 잔여 한도 병렬 로드
  await Promise.all([
    loadBoostState().catch(() => {}),
    loadPopularVoteState(),
    loadFreeLikeQuota()
  ]);
  renderMainPickTab();
  renderDebutRaceTab();
  renderHallOfFameTab();
  updateHeroQuotaDisplay();
  bindVoteTabs();
}

/* ── 렌더링: 비공개 아티스트 라인 ─────────────── */
function renderDebutLine() {
  const root = document.getElementById("debutLineGrid");
  if (!root) return;

  const list = _artists.filter(isHiddenLineupArtist);
  if (!list.length) { root.closest("section")?.setAttribute("hidden", ""); return; }

  root.innerHTML = list.map(a => {
    const isMale = a.gender === "male";
    const silhouetteClass = isMale ? "silhouette-male" : "silhouette-female";
    const silhouetteLabel = isMale ? "HIDDEN<br>STAGE" : "NEW<br>STAGE";
    const silhouetteText = isMale ? "남성 아티스트 공개 준비 중" : "여성 아티스트 공개 준비 중";

    return `
    <article class="debut-card clickable-card" data-href="./character-detail.html?slug=${a.slug}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      <div class="debut-card-media ${silhouetteClass}">
        <div class="debut-silhouette">
          <span>${silhouetteLabel}</span>
          <small>${silhouetteText}</small>
        </div>
        <div class="debut-gender-badge">${isMale ? "♂" : "♀"}</div>
      </div>
      <div class="debut-card-body">
        <span class="debut-card-type eyebrow">${a.type}</span>
        <strong>${a.publicName}</strong>
        <p>${artistToneCopy(a)}</p>
        <a class="text-link" href="./character-detail.html?slug=${a.slug}">무드 보기</a>
      </div>
    </article>`;
  }).join("");

  bindDebutLineCarousel();
}

function bindDebutLineCarousel() {
  const root = document.getElementById("debutLineGrid");
  const prev = document.getElementById("debutLinePrev");
  const next = document.getElementById("debutLineNext");
  if (!root || !prev || !next || root.dataset.carouselBound === "true") return;
  root.dataset.carouselBound = "true";

  const scrollByCard = direction => {
    const card = root.querySelector(".debut-card");
    const gap = parseFloat(getComputedStyle(root).columnGap || "16") || 16;
    const width = card ? card.getBoundingClientRect().width + gap : root.clientWidth;
    root.scrollBy({ left: direction * width, behavior: "smooth" });
  };

  prev.addEventListener("click", () => scrollByCard(-1));
  next.addEventListener("click", () => scrollByCard(1));
}

/* ── 렌더링: 숏폼 그리드 ─────────────────────── */
function renderShortforms() {
  const root = document.getElementById("shortformGrid");
  if (!root) return;
  root.innerHTML = _shortforms.map(item => {
    const a = getCharacterByName(item.artist);
    const img = item.image || a?.images.thumb || a?.images.cover || "";
    return `
      <article class="short-card clickable-card" data-href="./character-detail.html?slug=${a?.slug || ""}">
        <div class="short-card-head">
          <span class="eyebrow">${item.artist}</span>
          <strong>${item.title}</strong>
        </div>
        <div class="short-media"${mediaStyle(img)}>
          <span class="short-media-metric">${item.metric}</span>
        </div>
        <div class="short-body">
          <p>${item.mainTone || item.tone}</p>
          <a class="text-link" href="./character-detail.html?slug=${a?.slug || ""}">캐릭터 보기</a>
        </div>
      </article>`;
  }).join("");
}

/* ── 렌더링: 숏폼 허브 ───────────────────────── */
function renderShortformHub() {
  const root = document.getElementById("shortformHub");
  if (!root) return;
  root.innerHTML = _shortforms.map(item => {
    const a = getCharacterByName(item.artist);
    const img = item.image || a?.images.thumb || a?.images.cover || "";
    return `
      <article class="feed-card clickable-card" data-href="./character-detail.html?slug=${a?.slug || ""}">
        <div class="feed-card-head">
          <span class="eyebrow">${item.artist}</span>
          <strong>${item.title}</strong>
        </div>
        <div class="feed-card-media"${mediaStyle(img)}>
          <span class="feed-card-chip">${a?.type || ""}</span>
          <span class="feed-card-metric">${item.metric}</span>
        </div>
        <div class="feed-card-body">
          <p>${item.hubTone || item.tone}</p>
          <a class="text-link" href="./character-detail.html?slug=${a?.slug || ""}">캐릭터 보기</a>
        </div>
      </article>`;
  }).join("");
}

/* ── 렌더링: 로스터 ──────────────────────────── */
function renderRoster() {
  const root = document.getElementById("rosterGrid");
  if (!root) return;
  const featured = _artists.filter(a => ["yoon-serin","han-seoyul","park-doa","choi-seojin"].includes(a.slug));
  root.innerHTML = featured.map(a => `
    <article class="roster-card ${statusMeta[a.status].className} clickable-card"
      data-href="./character-detail.html?slug=${a.slug}"
      data-secret="${a.status === "secret"}">
      <div class="roster-media roster-media-${a.status}"${mediaStyle(a.images.thumb || a.images.cover)}>
        <strong>${a.publicName}</strong>
      </div>
      <div class="roster-body">
        <div class="roster-meta">
          <span class="eyebrow">${a.type}</span>
          <span class="status-badge status-badge-${a.status}">${statusMeta[a.status].label}</span>
        </div>
        <p>${artistToneCopy(a)}</p>
        <a class="text-link ${a.status === "secret" ? "is-dimmed" : ""}" href="./character-detail.html?slug=${a.slug}">무드 보기</a>
      </div>
    </article>`).join("");
}

/* ── 렌더링: 캐릭터 카탈로그 ────────────────── */
function renderCatalogMedia(a) {
  const s = statusMeta[a.status];
  if (a.status === "secret") {
    return `<div class="catalog-media catalog-media-${a.tier} catalog-media-${a.status}">
      <div class="catalog-overlay">
        <span class="eyebrow">${a.type}</span>
        <strong>${a.publicName}</strong>
        <em class="catalog-status-caption">${s.summaryLabel}</em>
      </div></div>`;
  }
  return `<div class="catalog-media catalog-media-${a.tier} catalog-media-${a.status}">
    <img class="catalog-image catalog-image-${a.slug}" src="${a.images.thumb || a.images.cover}" alt="${a.publicName}" onerror="this.style.display='none'" />
    <div class="catalog-overlay"><em class="catalog-status-caption">${s.summaryLabel}</em></div>
  </div>`;
}

function renderCharacterCatalog(filter = "all", tagFilter = "", statusFilter = "all") {
  const root = document.getElementById("characterCatalog");
  if (!root) return;

  const tierLabel = { main: "메인", premium: "프리미엄", sub: "서브", experiment: "실험" };
  // 5개 메인 type — 여기에 안 잡히면 "기타" 필터에서 자동 노출 (향후 새 type 추가 시점 판단용)
  const KNOWN_TYPES = ["아티스트", "모델", "배우", "엔터테이너", "스포츠"];

  let list;
  if (filter === "all") {
    list = _artists;
  } else if (filter === "기타") {
    list = _artists.filter(a => !KNOWN_TYPES.includes(a.type));
  } else {
    list = _artists.filter(a => a.type === filter || a.tier === filter);
  }
  if (tagFilter) list = list.filter(a => a.tags.includes(tagFilter));
  // status 필터 (사용자 클릭 시) — type 필터와 독립적으로 AND 적용
  if (statusFilter && statusFilter !== "all") {
    list = list.filter(a => a.status === statusFilter);
  }

  // 정렬: 상태 그룹(public > candidate > secret) 순서 유지하면서 그룹 안에서 좋아요 많은 순
  // 좋아요 데이터가 비어있으면 같은 그룹 안에서는 원래 순서 유지 (stable sort)
  const statusOrder = { public: 0, candidate: 1, secret: 2 };
  list = [...list].sort((a, b) => {
    const so = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (so !== 0) return so;
    return getLikesCount(b.slug) - getLikesCount(a.slug);
  });

  // #080 — 빈상태: 필터 결과가 0이면 안내 카드
  if (list.length === 0) {
    root.innerHTML = `<div class="catalog-empty" style="grid-column:1/-1;padding:48px 24px;text-align:center;color:rgba(240,238,248,0.62);background:rgba(10,8,18,0.32);border:1px dashed rgba(255,20,147,0.18);border-radius:14px;">
      <strong style="display:block;font-size:15px;color:var(--ink);margin-bottom:6px;">아직 이 카테고리에 공개된 아티스트가 없어요</strong>
      준비 중인 라인업은 곧 순차적으로 공개됩니다.
    </div>`;
    return;
  }

  root.innerHTML = list.map(a => `
    <article class="catalog-card ${statusMeta[a.status].className} clickable-card"
      data-href="./character-detail.html?slug=${a.slug}"
      data-secret="${a.status === "secret"}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      ${renderCatalogMedia(a)}
      ${a.status === "public" ? likeButtonHTML(a.slug, "like-btn-large like-btn-catalog") : ""}
      <div class="catalog-body">
        <h3 class="catalog-name">${a.publicName}</h3>
        <div class="catalog-meta">
          <span>${statusMeta[a.status].label}</span>
          <span>${tierLabel[a.tier] || a.tier}</span>
        </div>
        <p class="catalog-summary">${artistToneCopy(a)}</p>
        <dl class="catalog-details">
          <div><dt>팬 포인트</dt><dd>${a.fandom}</dd></div>
          <div><dt>브랜드 무드</dt><dd>${a.business}</dd></div>
        </dl>
        <div class="tag-list">${a.tags.map(t => `<span>${t}</span>`).join("")}</div>
        <a class="text-link ${a.status === "secret" ? "is-dimmed" : ""}" href="./character-detail.html?slug=${a.slug}">무드 보기</a>
      </div>
    </article>`).join("");

  const note = document.getElementById("activeFilterNote");
  if (note) {
    const parts = [];
    if (tagFilter) parts.push(`태그: <strong>${tagFilter}</strong>`);
    if (filter && filter !== "all") parts.push(`분류: <strong>${filter}</strong>`);
    if (statusFilter && statusFilter !== "all") {
      const statusLabelMap = { public: "공개 활동 중", candidate: "데뷔 예정", secret: "비공개 라인" };
      parts.push(`상태: <strong>${statusLabelMap[statusFilter] || statusFilter}</strong>`);
    }
    if (parts.length === 0) {
      note.innerHTML = "";
    } else {
      note.innerHTML = `<span>현재 필터: ${parts.join(" / ")}</span>` +
        (tagFilter ? `<a href="./characters.html" class="text-link">필터 해제</a>` : "");
    }
  }
}

function bindCharacterFilters() {
  const filterRoot = document.getElementById("characterFilters");
  const statusRoot = document.getElementById("characterStatusFilters");
  if (!filterRoot && !statusRoot) return;

  const typeBtns = filterRoot ? [...filterRoot.querySelectorAll("[data-filter]")] : [];
  const statusBtns = statusRoot ? [...statusRoot.querySelectorAll("[data-status-filter]")] : [];
  const activeTag = new URLSearchParams(window.location.search).get("tag") || "";

  // 현재 활성 상태 — 두 필터바 모두 추적
  const getCurrentType = () => filterRoot?.querySelector(".is-active")?.dataset.filter || "all";
  const getCurrentStatus = () => statusRoot?.querySelector(".is-active")?.dataset.statusFilter || "all";

  typeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      typeBtns.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderCharacterCatalog(btn.dataset.filter, activeTag, getCurrentStatus());
    });
  });
  statusBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      statusBtns.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderCharacterCatalog(getCurrentType(), activeTag, btn.dataset.statusFilter);
    });
  });
  if (activeTag) renderCharacterCatalog("all", activeTag, getCurrentStatus());
}

/* ── 렌더링: 캐릭터 상세 ─────────────────────── */
/* ── 캐릭터 상세 페이지 갤러리 비동기 갱신 (#031) ──
   목록 API `/api/v1/artists`에 assets[]이 빠져있을 가능성 대비.
   상세 페이지 진입 시 개별 `/api/v1/artists/{slug}` 호출 → 정확한 gallery로 갱신.
   에밀리 권장 패턴: artist.assets.filter(usageType=gallery).map(url) */
async function fetchAndUpdateDetailGallery(slug, artistName) {
  if (!slug) return;
  if (shouldKeepLocalGallery(slug)) return;
  try {
    const full = await apiFetch(`/api/v1/artists/${encodeURIComponent(slug)}`);
    if (!full || !Array.isArray(full.assets) || full.assets.length === 0) return;

    const galleryItems = full.assets
      .filter(a => a.usageType === "gallery")
      .map(a => ({ caption: a.caption || "Gallery", src: normalizeAssetUrl(a.url) }));

    if (galleryItems.length === 0) return;

    // _artists 캐시 갱신 (다음 진입 시 빠르게)
    const cached = _artists.find(a => a.slug === slug);
    if (cached) {
      cached.assets = full.assets;
      cached.gallery = galleryItems;
      // cover/thumb도 최신 운영 데이터로 갱신
      const fullCover = full.assets.find(a => a.usageType === "cover");
      const fullThumb = full.assets.find(a => a.usageType === "thumb");
      if (fullCover?.url) cached.images.cover = normalizeAssetUrl(fullCover.url);
      if (fullThumb?.url) cached.images.thumb = normalizeAssetUrl(fullThumb.url);
    }

    // 슬라이더/라이트박스 새 데이터로 다시 그리기
    initGallerySlider(galleryItems, artistName);
    initLightbox(galleryItems, artistName);
    console.info(`[Lumina] 상세 갤러리 갱신: ${slug} (${galleryItems.length}장)`);
  } catch (err) {
    console.warn(`[Lumina] 개별 아티스트 fetch 실패 (${slug}) — 기존 갤러리 유지:`, err);
  }
}

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
      if (label) label.textContent = "팔로잉";
      btn.dataset.following = "1";
    } else {
      btn.classList.remove("is-following");
      const label = btn.querySelector("[data-detail-follow-label]");
      if (label) label.textContent = "팔로우";
      btn.dataset.following = "0";
    }
  } else {
    // 비로그인 — 버튼은 hidden 유지 (팔로워 수만 보여줌)
    btn.hidden = true;
  }
}

function bindArtistDetailFollow() {
  if (document._detailFollowBound) return;
  document._detailFollowBound = true;
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-detail-follow]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (btn.dataset.busy === "1") return;
    if (typeof getAccessToken === "function" && !getAccessToken()) {
      alert("로그인하면 팔로우할 수 있어요.");
      return;
    }
    const artistId = btn.dataset.artistId;
    if (!artistId) {
      alert("아티스트 정보를 불러오지 못했어요. 새로고침 후 다시 시도해주세요.");
      return;
    }
    const wasFollowing = btn.dataset.following === "1";
    btn.dataset.busy = "1";
    // 낙관적 토글
    btn.classList.toggle("is-following", !wasFollowing);
    btn.dataset.following = wasFollowing ? "0" : "1";
    const label = btn.querySelector("[data-detail-follow-label]");
    if (label) label.textContent = wasFollowing ? "팔로우" : "팔로잉";
    // 팔로워 수 즉시 +1/-1
    const countEl = btn.querySelector("[data-detail-follower-count]");
    if (countEl) {
      const m = countEl.textContent.match(/[\d,]+/);
      if (m) {
        const cur = parseInt(m[0].replace(/,/g, ""), 10) || 0;
        const next = wasFollowing ? Math.max(0, cur - 1) : cur + 1;
        countEl.textContent = `팔로워 ${next.toLocaleString("ko-KR")}`;
      }
    }
    try {
      const res = await apiFetch(`/api/v1/artists/${encodeURIComponent(artistId)}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        auth: true,
        throwOnError: true
      });
      // #153 — 응답에 stats/viewer 포함됨. 정확한 값으로 최종 동기화
      if (res?.stats?.followerCount !== undefined && countEl) {
        countEl.textContent = `팔로워 ${Number(res.stats.followerCount).toLocaleString("ko-KR")}`;
      }
      if (res?.viewer) {
        const isFollowing = res.viewer.isFollowing || res.viewer.canUnfollow;
        btn.classList.toggle("is-following", !!isFollowing);
        btn.dataset.following = isFollowing ? "1" : "0";
        if (label) label.textContent = isFollowing ? "팔로잉" : "팔로우";
      }
    } catch (err) {
      // 롤백
      btn.classList.toggle("is-following", wasFollowing);
      btn.dataset.following = wasFollowing ? "1" : "0";
      if (label) label.textContent = wasFollowing ? "팔로잉" : "팔로우";
      console.warn("[#150 detail follow] 실패", { status: err?.status, body: err?.body });
      alert(err?.message || "팔로우 처리에 실패했어요.");
      // 팔로워 수 원복
      if (countEl) {
        const m = countEl.textContent.match(/[\d,]+/);
        if (m) {
          const cur = parseInt(m[0].replace(/,/g, ""), 10) || 0;
          const next = wasFollowing ? cur + 1 : Math.max(0, cur - 1);
          countEl.textContent = `팔로워 ${next.toLocaleString("ko-KR")}`;
        }
      }
    } finally {
      btn.dataset.busy = "0";
    }
  });
}

/* #152 — 일반 유저 공개 프로필 페이지 (차모 spec `3fa2600 Add public user profile viewer APIs`)
   - URL: ./user-profile.html?handle={publicHandle} 또는 ?id={userId}
   - GET /api/v1/users/handle/:publicHandle/profile  (Authorization 선택)
   - GET /api/v1/users/handle/:publicHandle/lumina-feed?take=20&cursor=<postId>
   - 본인이면 viewer.isSelf === true → "프로필 편집" 버튼 → 마이페이지로 이동
   - 팔로우는 #148 endpoint 사용 (POST/DELETE /api/v1/users/:userId/follow), #153 응답으로 stats/viewer 갱신 */
let _userProfileData = null;
let _userProfilePostsCursor = null;
async function initUserProfilePage() {
  // 진입 시 모든 빈 상태/에러 카드 강제 hidden — HTML hidden 속성이 CSS·i18n에 덮이지 않도록 명시 처리
  ["userProfileEmpty", "userProfileBlocked", "userProfilePostsEmpty", "userProfilePostsSection", "userProfileLoadMore"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.hidden = true;
      el.style.display = "none";
    }
  });

  const params = new URLSearchParams(window.location.search);
  const handle = params.get("handle");
  const userId = params.get("id");
  if (!handle && !userId) {
    showUserProfileNotFound();
    return;
  }

  const isAuth = typeof isLoggedIn === "function" && isLoggedIn();
  const profileEndpoint = handle
    ? `/api/v1/users/handle/${encodeURIComponent(handle)}/profile`
    : `/api/v1/users/${encodeURIComponent(userId)}/profile`;
  const feedEndpoint = handle
    ? `/api/v1/users/handle/${encodeURIComponent(handle)}/lumina-feed?take=20`
    : `/api/v1/users/${encodeURIComponent(userId)}/lumina-feed?take=20`;

  // 1. 프로필 조회
  try {
    const res = await apiFetch(profileEndpoint, { auth: isAuth });
    if (!res?.user) {
      showUserProfileNotFound();
      return;
    }
    _userProfileData = res;
    renderUserProfileCard(res);
    bindUserProfileFollow();
  } catch (err) {
    if (err?.status === 403) {
      // 차단된 계정
      showUserProfileBlocked();
    } else {
      console.warn("[#152 user-profile] 프로필 조회 실패:", err?.status, err?.message);
      showUserProfileNotFound();
    }
    return;
  }

  // 2. 글 목록 조회 (별도 try — 프로필은 보였는데 글 조회만 실패해도 프로필은 유지)
  await loadUserProfilePosts(feedEndpoint, isAuth, /*append*/ false);

  // 3. "이전 글 더 보기" 바인딩
  const loadMoreBtn = document.getElementById("userProfileLoadMore");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", async () => {
      if (!_userProfilePostsCursor) return;
      loadMoreBtn.disabled = true;
      const sep = feedEndpoint.includes("?") ? "&" : "?";
      const nextUrl = `${feedEndpoint}${sep}cursor=${encodeURIComponent(_userProfilePostsCursor)}`;
      await loadUserProfilePosts(nextUrl, isAuth, /*append*/ true);
      loadMoreBtn.disabled = false;
    });
  }

  // 페이지 인터랙션 — 본인 글 수정/좋아요/삭제 핸들러는 피드 페이지와 공유
  bindLuminaFeedExpand();
  bindLuminaFeedDelete();
  bindLuminaFeedEdit();
  bindLuminaFeedLike();
  bindLuminaFeedComment();
  bindFeedAssetLightbox(); // 피드 이미지 라이트박스 + 우클릭 차단

  // X 패턴 3탭 (게시물 / 사진 / 숏폼) — client-side 필터
  bindUserProfileTabs();
  bindProfileEditModal();
  const requestedTab = params.get("tab");
  if (requestedTab) setUserProfileActiveTab(requestedTab);
}

let _userProfileActiveTab = "posts";
/* 프로필 편집 모달 — 본인 프로필일 때만 작동
   - "프로필 편집" 버튼 클릭 → 모달 열기
   - 아바타 변경: 기존 uploadMypageAvatar() 재사용 (PATCH /me/profile { avatarAssetId })
   - cover banner 변경: 차모 #156 spec 받기 전엔 "곧 공개돼요" 안내
   - 자기소개 변경: PATCH /me/profile { bio } (차모 spec 미확인 → 실패 시 안내)
   - ESC, X, 배경 클릭으로 닫기 */
function bindProfileEditModal() {
  if (document._profileEditModalBound) return;
  document._profileEditModalBound = true;

  const modal = document.getElementById("profileEditModal");
  if (!modal) return;

  // 1) 열기 — "프로필 편집" 버튼 (data-open-edit-modal)
  document.addEventListener("click", e => {
    const trigger = e.target.closest("[data-open-edit-modal]");
    if (trigger) {
      e.preventDefault();
      openProfileEditModal();
    }
    // 닫기 (배경/×버튼)
    if (e.target.closest("[data-profile-edit-close]")) {
      e.preventDefault();
      closeProfileEditModal();
    }
  });

  // 2) ESC 닫기
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) {
      closeProfileEditModal();
    }
  });

  // 3) 자기소개 입력 카운터
  const bioInput = document.getElementById("profileEditBio");
  const bioCounter = document.getElementById("profileEditBioCounter");
  if (bioInput && bioCounter) {
    bioInput.addEventListener("input", () => {
      bioCounter.textContent = bioInput.value.length;
    });
  }

  // 4) 아바타 변경 버튼 → 파일 선택 → 업로드
  const avatarChangeBtn = document.getElementById("profileEditAvatarChange");
  const avatarInput = document.getElementById("profileEditAvatarInput");
  if (avatarChangeBtn && avatarInput) {
    avatarChangeBtn.addEventListener("click", () => avatarInput.click());
    avatarInput.addEventListener("change", async () => {
      const file = avatarInput.files?.[0];
      avatarInput.value = "";
      if (!file) return;
      await handleProfileEditAvatarUpload(file);
    });
  }

  // 5) cover 변경 버튼 → 파일 선택 → 업로드 (#156 차모 spec)
  const coverChangeBtn = document.getElementById("profileEditCoverChange");
  const coverInput = document.getElementById("profileEditCoverInput");
  if (coverChangeBtn && coverInput) {
    coverChangeBtn.addEventListener("click", () => coverInput.click());
    coverInput.addEventListener("change", async () => {
      const file = coverInput.files?.[0];
      coverInput.value = "";
      if (!file) return;
      await handleProfileEditCoverUpload(file);
    });
  }

  // 6) 저장 버튼 — 자기소개만 저장 (아바타는 즉시 업로드)
  const saveBtn = document.getElementById("profileEditSaveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => await saveProfileEdit());
  }
}

function openProfileEditModal() {
  const modal = document.getElementById("profileEditModal");
  if (!modal) return;
  // 본인 프로필 필수 검증
  const me = (typeof getAuth === "function") ? getAuth()?.user : null;
  if (!me) {
    if (typeof openAuthModal === "function") openAuthModal("login");
    return;
  }
  // 현재 user 정보로 초기값 채우기
  const profileUser = _userProfileData?.user || me;
  // 자기소개
  const bioInput = document.getElementById("profileEditBio");
  const bioCounter = document.getElementById("profileEditBioCounter");
  if (bioInput) {
    bioInput.value = (profileUser.bio || "").trim();
    if (bioCounter) bioCounter.textContent = bioInput.value.length;
  }
  // 아바타
  syncProfileEditAvatarPreview(profileUser);
  // cover
  syncProfileEditCoverPreview(profileUser);
  // 상태 초기화
  setProfileEditStatus("", "info");

  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  // animation frame
  requestAnimationFrame(() => modal.classList.add("is-open"));
  document.body.style.overflow = "hidden";
}

function closeProfileEditModal() {
  const modal = document.getElementById("profileEditModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  document.body.style.overflow = "";
  setTimeout(() => {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }, 200);
}

function syncProfileEditAvatarPreview(user) {
  const preview = document.getElementById("profileEditAvatarPreview");
  const fallback = document.getElementById("profileEditAvatarFallback");
  if (!preview) return;
  const url = user?.avatarUrl || "";
  if (url) {
    preview.style.backgroundImage = `url('${String(url).replace(/'/g, "%27")}')`;
    preview.classList.add("has-image");
    if (fallback) fallback.style.display = "none";
  } else {
    preview.style.backgroundImage = "";
    preview.classList.remove("has-image");
    if (fallback) {
      fallback.textContent = (user?.displayName || "?").charAt(0);
      fallback.style.display = "";
    }
  }
}

function syncProfileEditCoverPreview(user) {
  const preview = document.getElementById("profileEditCoverPreview");
  if (!preview) return;
  const url = user?.coverImageUrl || ""; // #156 차모 spec 받으면 활성화
  if (url) {
    preview.style.backgroundImage = `url('${String(url).replace(/'/g, "%27")}')`;
    preview.classList.add("has-image");
  } else {
    preview.style.backgroundImage = "";
    preview.classList.remove("has-image");
  }
}

/* #156 차모 spec — cover banner 업로드 (avatar와 동일 flow + usageType: profile_cover)
   1. POST /me/assets/upload-intents { usageType: "profile_cover" }
   2. PUT upload.url (S3)
   3. POST /me/assets/:assetId/confirm-upload
   4. PATCH /me/profile { coverAssetId } */
async function handleProfileEditCoverUpload(file) {
  const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
  const MAX = 8 * 1024 * 1024;
  if (!ALLOWED.includes(file.type)) {
    setProfileEditStatus("지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.", "error");
    return;
  }
  if (file.size > MAX) {
    setProfileEditStatus("이미지는 8MB 이하 파일로 선택해 주세요.", "error");
    return;
  }

  // blob 미리보기 (모달 cover + user-profile 헤더 cover 둘 다)
  const blobUrl = URL.createObjectURL(file);
  const modalCover = document.getElementById("profileEditCoverPreview");
  const headerCover = document.getElementById("userProfileCover");
  if (modalCover) {
    modalCover.style.backgroundImage = `url('${blobUrl}')`;
    modalCover.classList.add("has-image");
  }
  setProfileEditStatus("표지 이미지를 업로드하고 있어요…", "info");

  try {
    // 1) upload intent (usageType: profile_cover) — 차모 spec + 기존 호환 필드 둘 다
    const intent = await apiFetch("/api/v1/me/assets/upload-intents", {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
        mimeType: file.type,           // 기존 endpoint 호환
        fileSizeBytes: file.size,      // 기존 endpoint 호환
        usageType: "profile_cover"
      }
    });
    if (!intent?.asset?.id || !intent?.upload) throw new Error("Invalid upload intent");
    const assetId = intent.asset.id;
    const upload = intent.upload;

    // 2) 직접 업로드 (S3 PUT)
    if (upload.mode === "direct_upload_ready" && upload.url) {
      const putRes = await fetch(upload.url, {
        method: upload.method || "PUT",
        headers: upload.requiredHeaders || {},
        body: file
      });
      if (!putRes.ok) {
        const err = new Error(`Upload failed (${putRes.status})`);
        err.status = putRes.status;
        throw err;
      }
    }

    // 3) confirm-upload
    const confirmed = await apiFetch(`/api/v1/me/assets/${encodeURIComponent(assetId)}/confirm-upload`, {
      method: "POST", auth: true, throwOnError: true, body: {}
    });
    const finalAsset = confirmed?.asset || confirmed;
    const finalAssetId = finalAsset?.id || assetId;

    // 4) PATCH /me/profile { coverAssetId }
    const patched = await apiFetch("/api/v1/me/profile", {
      method: "PATCH", auth: true, throwOnError: true,
      body: { coverAssetId: finalAssetId }
    });
    const updatedUser = patched?.user || patched;
    const newCoverUrl = updatedUser?.coverImageUrl || updatedUser?.coverAsset?.url || finalAsset?.url || "";

    // 5) UI 갱신: 모달 + 헤더 + setAuth + _userProfileData
    if (modalCover) {
      if (newCoverUrl) {
        modalCover.style.backgroundImage = `url('${String(newCoverUrl).replace(/'/g, "%27")}')`;
        modalCover.classList.add("has-image");
      }
    }
    if (headerCover) {
      if (newCoverUrl) {
        headerCover.style.backgroundImage = `url('${String(newCoverUrl).replace(/'/g, "%27")}')`;
        headerCover.classList.add("has-image");
      }
    }
    if (_userProfileData?.user) {
      _userProfileData.user.coverImageUrl = newCoverUrl;
    }
    const auth = getAuth();
    if (auth) {
      setAuth({
        ...auth,
        user: {
          ...auth.user,
          coverImageUrl: newCoverUrl,
          coverAsset: updatedUser?.coverAsset || finalAsset
        }
      });
    }
    setProfileEditStatus("표지 이미지가 저장됐어요.", "success");
  } catch (err) {
    console.error("[#156 cover upload] 실패:", err, "status=", err?.status, "body=", err?.body);
    let msg = "표지 저장에 실패했어요. 잠시 후 다시 시도해 주세요.";
    if (err?.status === 401) msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
    else if (err?.status === 413) msg = "이미지 용량이 너무 커요. 8MB 이하 파일로 다시 시도해 주세요.";
    else if (err?.status === 415) msg = "지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.";
    setProfileEditStatus(msg, "error");
    // 실패 시 원래 cover로 복구
    syncProfileEditCoverPreview(_userProfileData?.user || getAuth()?.user || {});
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }
}

async function handleProfileEditAvatarUpload(file) {
  // 클라이언트 검증
  const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
  const MAX = 8 * 1024 * 1024;
  if (!ALLOWED.includes(file.type)) {
    setProfileEditStatus("지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.", "error");
    return;
  }
  if (file.size > MAX) {
    setProfileEditStatus("이미지는 8MB 이하 파일로 선택해 주세요.", "error");
    return;
  }

  // blob 미리보기 (모달 + 페이지 헤더 둘 다)
  const blobUrl = URL.createObjectURL(file);
  const preview = document.getElementById("profileEditAvatarPreview");
  const fallback = document.getElementById("profileEditAvatarFallback");
  const headerAvatar = document.getElementById("userProfileAvatar");
  const headerFallback = document.getElementById("userProfileAvatarFallback");
  if (preview) {
    preview.style.backgroundImage = `url('${blobUrl}')`;
    preview.classList.add("has-image");
    if (fallback) fallback.style.display = "none";
  }
  setProfileEditStatus("프로필 사진을 업로드하고 있어요…", "info");

  try {
    // 1) upload intent — avatar용 (차모 spec 필드명 + 기존 필드명 둘 다 보내기 — 백엔드 호환성)
    const intent = await apiFetch("/api/v1/me/assets/upload-intents", {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
        mimeType: file.type,           // 기존 avatar endpoint 호환
        fileSizeBytes: file.size,      // 기존 avatar endpoint 호환
        usageType: "profile_avatar"
      }
    });
    if (!intent?.asset?.id || !intent?.upload) throw new Error("Invalid upload intent");
    const assetId = intent.asset.id;
    const upload = intent.upload;

    // 2) S3 PUT
    if (upload.mode === "direct_upload_ready" && upload.url) {
      const putRes = await fetch(upload.url, {
        method: upload.method || "PUT",
        headers: upload.requiredHeaders || {},
        body: file
      });
      if (!putRes.ok) {
        const err = new Error(`Upload failed (${putRes.status})`);
        err.status = putRes.status;
        throw err;
      }
    }

    // 3) confirm
    const confirmed = await apiFetch(`/api/v1/me/assets/${encodeURIComponent(assetId)}/confirm-upload`, {
      method: "POST", auth: true, throwOnError: true, body: {}
    });
    const finalAsset = confirmed?.asset || confirmed;
    const finalAssetId = finalAsset?.id || assetId;

    // 4) PATCH /me/profile { avatarAssetId }
    const patched = await apiFetch("/api/v1/me/profile", {
      method: "PATCH", auth: true, throwOnError: true,
      body: { avatarAssetId: finalAssetId }
    });
    const updatedUser = patched?.user || patched;
    const newAvatarUrl = updatedUser?.avatarUrl || updatedUser?.avatarAsset?.url || finalAsset?.url || "";

    // 5) UI 갱신: 모달 + 페이지 헤더 + setAuth + _userProfileData
    if (preview && newAvatarUrl) {
      preview.style.backgroundImage = `url('${String(newAvatarUrl).replace(/'/g, "%27")}')`;
      preview.classList.add("has-image");
      if (fallback) fallback.style.display = "none";
    }
    if (headerAvatar && newAvatarUrl) {
      headerAvatar.style.backgroundImage = `url('${String(newAvatarUrl).replace(/'/g, "%27")}')`;
      headerAvatar.classList.add("has-image");
      if (headerFallback) headerFallback.style.display = "none";
    }
    if (_userProfileData?.user) {
      _userProfileData.user.avatarUrl = newAvatarUrl;
    }
    const auth = getAuth();
    if (auth) {
      setAuth({
        ...auth,
        user: {
          ...auth.user,
          avatarUrl: newAvatarUrl,
          avatarAsset: updatedUser?.avatarAsset || finalAsset
        }
      });
    }
    // 헤더 드롭다운 아바타도 갱신 (있으면)
    if (typeof syncUserMenuAvatar === "function") syncUserMenuAvatar();
    setProfileEditStatus("프로필 사진이 저장됐어요.", "success");
  } catch (err) {
    console.error("[profile-edit avatar] 실패:", err, "status=", err?.status, "body=", err?.body);
    let msg = "이미지 저장에 실패했어요. 잠시 후 다시 시도해 주세요.";
    if (err?.status === 401) msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
    else if (err?.status === 413) msg = "이미지 용량이 너무 커요. 8MB 이하 파일로 다시 시도해 주세요.";
    else if (err?.status === 415) msg = "지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.";
    setProfileEditStatus(msg, "error");
    syncProfileEditAvatarPreview(_userProfileData?.user || getAuth()?.user || {});
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }
}

async function saveProfileEdit() {
  const saveBtn = document.getElementById("profileEditSaveBtn");
  const bioInput = document.getElementById("profileEditBio");
  if (!bioInput) return;
  const newBio = bioInput.value.trim();
  const currentBio = (_userProfileData?.user?.bio || "").trim();
  // 변경 없으면 그냥 닫기
  if (newBio === currentBio) {
    closeProfileEditModal();
    return;
  }
  if (saveBtn) saveBtn.disabled = true;
  setProfileEditStatus("저장 중…", "info");
  try {
    const patched = await apiFetch("/api/v1/me/profile", {
      method: "PATCH",
      auth: true,
      throwOnError: true,
      body: { bio: newBio }
    });
    const updatedUser = patched?.user || patched;
    // user-profile 데이터 갱신
    if (_userProfileData?.user) {
      _userProfileData.user.bio = updatedUser?.bio ?? newBio;
    }
    // 헤더 자기소개 즉시 갱신
    const bioEl = document.getElementById("userProfileBio");
    if (bioEl) {
      const finalBio = (updatedUser?.bio ?? newBio).trim();
      if (finalBio) {
        bioEl.textContent = finalBio;
        bioEl.classList.remove("is-empty");
      } else {
        bioEl.textContent = "아직 소개가 없어요.";
        bioEl.classList.add("is-empty");
      }
      bioEl.hidden = false;
      bioEl.style.display = "";
    }
    // setAuth 갱신
    const auth = getAuth();
    if (auth) setAuth({ ...auth, user: { ...auth.user, bio: updatedUser?.bio ?? newBio } });
    setProfileEditStatus("자기소개를 저장했어요.", "success");
    setTimeout(() => closeProfileEditModal(), 700);
  } catch (err) {
    console.error("[profile-edit bio] 실패:", err);
    let msg = "저장에 실패했어요. 잠시 후 다시 시도해 주세요.";
    if (err?.status === 401) msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
    else if (err?.status === 422 || err?.status === 400) msg = "입력한 내용을 확인해 주세요.";
    setProfileEditStatus(msg, "error");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function setProfileEditStatus(text, kind) {
  const el = document.getElementById("profileEditStatus");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = text;
  el.dataset.kind = kind || "info";
  el.hidden = false;
}

/* #155 차모 spec — 본인 좋아요한 글 목록
   GET /api/v1/me/lumina-feed/likes?take=20&cursor=<reactionId>
   응답: { items: [{ like, post }], nextCursor, ... }
   items[].post를 normalizeFeedPost로 변환해서 기존 카드 렌더러에 넣음 */
async function loadUserProfileLikes() {
  const list = document.getElementById("userProfilePostList");
  const emptyEl = document.getElementById("userProfilePostsEmpty");
  if (!list) return;

  // 로딩 안내
  list.innerHTML = `<div class="user-profile-loading" style="padding:32px 16px;text-align:center;color:rgba(220,210,240,0.55);font-size:14px;">좋아요한 글을 불러오고 있어요…</div>`;
  if (emptyEl) { emptyEl.hidden = true; emptyEl.style.display = "none"; }

  try {
    const res = await apiFetch("/api/v1/me/lumina-feed/likes?take=20", {
      auth: true,
      throwOnError: true
    });
    console.info("[#155 likes] response:", res);
    // 응답 fallback: items[].post 또는 posts[] (차모 답변에 둘 다 언급)
    let postsRaw = [];
    if (Array.isArray(res?.items) && res.items.length) {
      postsRaw = res.items.map(it => it?.post || it).filter(Boolean);
    } else if (Array.isArray(res?.posts) && res.posts.length) {
      postsRaw = res.posts;
    } else if (Array.isArray(res) && res.length) {
      postsRaw = res;
    }
    const posts = postsRaw.map(p => (typeof normalizeFeedPost === "function" ? normalizeFeedPost(p) : p));

    if (posts.length === 0) {
      list.innerHTML = "";
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.style.display = "";
        emptyEl.innerHTML = `<strong>아직 좋아요한 글이 없어요.</strong><p>마음에 든 글에 좋아요를 누르면 이곳에 모아져요.</p>`;
      }
      return;
    }

    _luminaFeedItems = posts;
    list.innerHTML = renderUserProfilePostListHtml(posts, { preservePostAuthor: true });
  } catch (err) {
    console.error("[#155 likes] 실패:", err);
    list.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.style.display = "";
      let msg = "좋아요한 글을 불러오지 못했어요.";
      if (err?.status === 401) msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
      emptyEl.innerHTML = `<strong>${feedEscapeHtml(msg)}</strong><p>잠시 후 다시 시도해 주세요.</p>`;
    }
  }
}

function bindUserProfileTabs() {
  const tabs = document.querySelectorAll("[data-user-profile-tab]");
  if (!tabs.length) return;
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.userProfileTab;
      setUserProfileActiveTab(key);
    });
  });
}

function setUserProfileActiveTab(key) {
  const allowed = new Set(["posts", "media", "shortform", "likes"]);
  if (!allowed.has(key) || _userProfileActiveTab === key) return;
  const targetTab = document.querySelector(`[data-user-profile-tab="${key}"]`);
  if (targetTab?.hidden || targetTab?.style?.display === "none") return;
  _userProfileActiveTab = key;
  document.querySelectorAll("[data-user-profile-tab]").forEach(t => {
    const active = t.dataset.userProfileTab === key;
    t.classList.toggle("is-active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
  });
  applyUserProfileTabFilter();
}

function applyUserProfileTabFilter() {
  const list = document.getElementById("userProfilePostList");
  const emptyEl = document.getElementById("userProfilePostsEmpty");
  const loadMoreBtn = document.getElementById("userProfileLoadMore");
  if (!list) return;

  const all = Array.isArray(_luminaFeedItems) ? _luminaFeedItems : [];

  // ── 사진 탭 → 그리드 갤러리 (X / IG 미디어 탭 스타일)
  if (_userProfileActiveTab === "media") {
    // 모든 글의 자산에서 이미지만 펼쳐서 정사각형 썸네일 그리드로
    const images = [];
    all.forEach(p => {
      if (!Array.isArray(p.assets)) return;
      p.assets.forEach(a => {
        const url = a?.asset?.url || a?.url || a?.publicUrl || "";
        const thumb = a?.asset?.thumbnailUrl || a?.thumbnailUrl || url;
        const type = (a?.asset?.mimeType || a?.type || a?.mimeType || "").toString().toLowerCase();
        const isImage = /^image\//.test(type) || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url);
        if (url && isImage) images.push({ url, thumb });
      });
    });
    if (images.length === 0) {
      list.innerHTML = "";
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.style.display = "";
        emptyEl.innerHTML = `<strong>아직 사진이 없어요.</strong><p>이미지가 포함된 글이 이곳에 모아져요.</p>`;
      }
    } else {
      if (emptyEl) { emptyEl.hidden = true; emptyEl.style.display = "none"; }
      const sources = images.map(i => i.url).join("|");
      list.innerHTML = `<div class="user-profile-media-grid" data-feed-asset-group="${feedEscapeHtml(sources)}">
        ${images.map((img, idx) => `
          <a class="user-profile-media-item feed-post-asset-item" href="${feedEscapeHtml(img.url)}" target="_blank" rel="noopener noreferrer" data-feed-asset data-asset-index="${idx}" data-asset-url="${feedEscapeHtml(img.url)}">
            <img src="${feedEscapeHtml(img.thumb)}" alt="" loading="lazy" oncontextmenu="return false;" draggable="false" />
          </a>
        `).join("")}
      </div>`;
    }
    if (loadMoreBtn) { loadMoreBtn.hidden = true; loadMoreBtn.style.display = "none"; }
    return;
  }

  // ── 숏폼 탭 placeholder
  if (_userProfileActiveTab === "shortform") {
    list.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.style.display = "";
      emptyEl.innerHTML = `<strong>숏폼은 곧 공개돼요.</strong><p>준비되는 대로 이곳에 모아볼 수 있게 할게요.</p>`;
    }
    if (loadMoreBtn) { loadMoreBtn.hidden = true; loadMoreBtn.style.display = "none"; }
    return;
  }

  // ── 좋아요 탭: 본인만 노출, #155 차모 endpoint
  // GET /api/v1/me/lumina-feed/likes?take=20&cursor=<reactionId>
  // 응답: { items: [{ like, post }], nextCursor, ... }
  if (_userProfileActiveTab === "likes") {
    if (loadMoreBtn) { loadMoreBtn.hidden = true; loadMoreBtn.style.display = "none"; }
    loadUserProfileLikes(); // 비동기로 endpoint 호출 + 렌더
    return;
  }

  // ── 게시물 탭 (기본)
  const filtered = all;
  if (filtered.length === 0) {
    list.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.style.display = "";
      emptyEl.innerHTML = `<strong>아직 공개한 글이 없어요.</strong><p>피드에 글을 남기면 이곳에 모아볼 수 있습니다.</p>`;
    }
  } else {
    if (emptyEl) { emptyEl.hidden = true; emptyEl.style.display = "none"; }
    list.innerHTML = renderUserProfilePostListHtml(filtered);
  }

  // 더 보기 버튼은 게시물 탭에서만 노출
  if (loadMoreBtn) {
    const showLoadMore = _userProfileActiveTab === "posts" && !!_userProfilePostsCursor;
    loadMoreBtn.hidden = !showLoadMore;
    loadMoreBtn.style.display = showLoadMore ? "" : "none";
  }
}

function renderUserProfileCard(data) {
  const card = document.getElementById("userProfileCard");
  if (!card) return;
  card.hidden = false;
  card.style.display = "";

  // 빈 상태 카드들 강제 숨김 (i18n/CSS 무관)
  ["userProfileEmpty", "userProfileBlocked"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.hidden = true; el.style.display = "none"; }
  });

  const user = data.user || {};
  const stats = data.stats || {};
  const viewer = data.viewer || {};

  // 페이지 타이틀
  document.title = `${user.displayName || "프로필"} — Lumina Stage`;

  // Cover banner — coverImageUrl 있으면 이미지로 덮음, 없으면 CSS 기본 그라디언트
  const coverEl = document.getElementById("userProfileCover");
  if (coverEl) {
    if (user.coverImageUrl) {
      coverEl.style.backgroundImage = `url('${String(user.coverImageUrl).replace(/'/g, "%27")}')`;
      coverEl.classList.add("has-image");
    } else {
      coverEl.style.backgroundImage = "";
      coverEl.classList.remove("has-image");
    }
  }

  // 아바타
  const avatarEl = document.getElementById("userProfileAvatar");
  const avatarFallback = document.getElementById("userProfileAvatarFallback");
  if (avatarEl) {
    if (user.avatarUrl) {
      avatarEl.style.backgroundImage = `url('${user.avatarUrl}')`;
      avatarEl.classList.add("has-image");
      if (avatarFallback) avatarFallback.style.display = "none";
    } else if (avatarFallback) {
      avatarFallback.textContent = (user.displayName || "?").charAt(0);
      avatarFallback.style.display = "";
    }
  }

  // 이름·핸들
  const nameEl = document.getElementById("userProfileName");
  if (nameEl) nameEl.textContent = user.displayName || "Lumina User";
  const handleEl = document.getElementById("userProfileHandle");
  if (handleEl) {
    // 자동 생성된 핸들(user-xxxxxxxxxxxx 패턴)은 사용자에게 의미 없는 식별자라 숨김
    // 사용자가 직접 설정한 publicHandle만 노출 (영문/숫자 짧은 핸들)
    const handle = (user.publicHandle || "").trim();
    const isAutoGenerated = /^user-[a-f0-9]{16,}$/i.test(handle) || handle.length > 24;
    if (handle && !isAutoGenerated) {
      handleEl.textContent = `@${handle}`;
      handleEl.hidden = false;
      handleEl.style.display = "";
    } else {
      handleEl.textContent = "";
      handleEl.hidden = true;
      handleEl.style.display = "none";
    }
  }

  // 자기소개 (#154 에밀리 카피: 비어있으면 "아직 소개가 없어요." 표시)
  const bioEl = document.getElementById("userProfileBio");
  const bioToggleEl = document.getElementById("userProfileBioToggle");
  if (bioEl) {
    const bio = (user.bio || "").trim();
    if (bio) {
      bioEl.textContent = bio;
      bioEl.classList.remove("is-empty");
      bioEl.classList.remove("is-expanded");
    } else {
      bioEl.textContent = "아직 소개가 없어요.";
      bioEl.classList.add("is-empty");
      bioEl.classList.remove("is-expanded");
    }
    bioEl.hidden = false;
    bioEl.style.display = "";

    // 더보기 토글 — 3줄 넘으면 노출
    if (bioToggleEl) {
      bioToggleEl.textContent = "더 보기";
      // 다음 프레임에 측정 (line-clamp 적용 후)
      requestAnimationFrame(() => {
        const isClipped = !bioEl.classList.contains("is-empty") && (bioEl.scrollHeight > bioEl.clientHeight + 1);
        if (isClipped) {
          bioToggleEl.classList.add("is-visible");
          if (!bioToggleEl._bound) {
            bioToggleEl._bound = true;
            bioToggleEl.addEventListener("click", () => {
              const expanded = bioEl.classList.toggle("is-expanded");
              bioToggleEl.textContent = expanded ? "접기" : "더 보기";
            });
          }
        } else {
          bioToggleEl.classList.remove("is-visible");
        }
      });
    }
  }

  // 통계
  setUserProfileStat("userProfileFollowerCount", stats.followerCount ?? stats.followers ?? 0);
  setUserProfileStat("userProfileFollowingCount", (stats.followingCount ?? stats.followingUsers ?? 0));
  setUserProfileStat("userProfilePostCount", stats.postCount ?? stats.posts ?? 0);

  // 액션 (본인 vs 남) — 본인이면 편집만, 남이면 팔로우만. 둘 다 보이는 일 절대 금지.
  const followBtn = document.getElementById("userProfileFollowBtn");
  const editBtn = document.getElementById("userProfileEditBtn");
  // 본인 판단: viewer.isSelf 또는 viewer.canEditProfile 또는 (로그인 사용자 id == 프로필 user id) 중 하나라도 true면 본인
  const myUserId = (typeof getAuth === "function") ? (getAuth()?.user?.id || getAuth()?.user?.userId) : null;
  const isSelf = !!(viewer.isSelf || viewer.canEditProfile || (myUserId && user.id && String(myUserId) === String(user.id)));
  if (isSelf) {
    if (editBtn)   { editBtn.hidden = false;  editBtn.style.display = ""; }
    if (followBtn) { followBtn.hidden = true; followBtn.style.display = "none"; }
    // 본인 프로필이면 "좋아요" 탭 노출 (다른 사람에겐 안 보임)
    const likesTab = document.querySelector(".user-profile-tab-likes");
    if (likesTab) { likesTab.hidden = false; likesTab.style.display = ""; }
  } else {
    if (editBtn)   { editBtn.hidden = true;   editBtn.style.display = "none"; }
    if (followBtn) {
      followBtn.hidden = false;
      followBtn.style.display = "";
      followBtn.dataset.userId = user.id || "";
      applyUserProfileFollowState(viewer);
    }
    // 좋아요 탭 강제 숨김 (다른 사람 프로필)
    const likesTab = document.querySelector(".user-profile-tab-likes");
    if (likesTab) { likesTab.hidden = true; likesTab.style.display = "none"; }
  }
}

function setUserProfileStat(elId, value) {
  const el = document.getElementById(elId);
  if (!el) return;
  const n = Number(value) || 0;
  el.textContent = n.toLocaleString("ko-KR");
}

function applyUserProfileFollowState(viewer) {
  const btn = document.getElementById("userProfileFollowBtn");
  if (!btn) return;
  const label = btn.querySelector("[data-detail-follow-label]");
  if (viewer?.isFollowing || viewer?.canUnfollow) {
    btn.classList.add("is-following");
    btn.dataset.following = "1";
    if (label) label.textContent = "팔로잉";
  } else {
    btn.classList.remove("is-following");
    btn.dataset.following = "0";
    if (label) label.textContent = "팔로우";
  }
}

function bindUserProfileFollow() {
  const btn = document.getElementById("userProfileFollowBtn");
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener("click", async e => {
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
    // 낙관적 토글
    btn.classList.toggle("is-following", !wasFollowing);
    btn.dataset.following = wasFollowing ? "0" : "1";
    const label = btn.querySelector("[data-detail-follow-label]");
    if (label) label.textContent = wasFollowing ? "팔로우" : "팔로잉";
    try {
      const res = await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        auth: true,
        throwOnError: true
      });
      // #153 — 응답에 stats/viewer 포함됨. 정확한 값으로 재반영
      if (res?.viewer) applyUserProfileFollowState(res.viewer);
      if (res?.stats) {
        const followerCount = res.stats.followerCount ?? res.stats.followers ?? null;
        if (followerCount !== null) setUserProfileStat("userProfileFollowerCount", followerCount);
      }
    } catch (err) {
      // 롤백
      btn.classList.toggle("is-following", wasFollowing);
      btn.dataset.following = wasFollowing ? "1" : "0";
      if (label) label.textContent = wasFollowing ? "팔로잉" : "팔로우";
      console.warn("[#152 user follow] 실패", { status: err?.status, body: err?.body });
      alert(err?.message || "팔로우 처리에 실패했어요.");
    } finally {
      btn.dataset.busy = "0";
    }
  });
}

async function loadUserProfilePosts(endpoint, isAuth, append) {
  const list = document.getElementById("userProfilePostList");
  const section = document.getElementById("userProfilePostsSection");
  const emptyEl = document.getElementById("userProfilePostsEmpty");
  const loadMoreBtn = document.getElementById("userProfileLoadMore");
  if (!list || !section) return;
  section.hidden = false;
  section.style.display = "";
  try {
    const res = await apiFetch(endpoint, { auth: isAuth });
    const items = Array.isArray(res?.items) ? res.items : [];
    const normalized = items.map(normalizeFeedPost);

    if (!append) {
      _luminaFeedItems = normalized; // 피드 페이지 함수와 공유 — 좋아요/수정/삭제 핸들러가 _luminaFeedItems 사용
    } else {
      _luminaFeedItems = (_luminaFeedItems || []).concat(normalized);
    }

    // 카드 렌더 + 빈 상태 명시 토글 (display까지 같이)
    if (!append && normalized.length === 0) {
      list.innerHTML = "";
      if (emptyEl) { emptyEl.hidden = false; emptyEl.style.display = ""; }
    } else if (emptyEl) {
      emptyEl.hidden = true;
      emptyEl.style.display = "none";
    }
    if (normalized.length > 0) {
      const html = renderUserProfilePostListHtml(normalized);
      if (append) {
        list.insertAdjacentHTML("beforeend", html);
      } else {
        list.innerHTML = html;
      }
    }

    // 다음 페이지 cursor
    _userProfilePostsCursor = res?.nextCursor || null;
    if (loadMoreBtn) {
      const show = !!_userProfilePostsCursor;
      loadMoreBtn.hidden = !show;
      loadMoreBtn.style.display = show ? "" : "none";
    }
  } catch (err) {
    console.warn("[#152 user-profile posts] 조회 실패:", err?.status, err?.message);
    if (!append && list) {
      list.innerHTML = `<p class="user-profile-posts-empty" style="display:block;">글 목록을 불러오지 못했어요.</p>`;
    }
    if (emptyEl) emptyEl.hidden = true;
  }
}

/* user-profile.html 전용 글 카드 렌더 (피드 페이지의 카드 디자인과 일관성) */
function renderUserProfilePostListHtml(posts, options = {}) {
  // 기본 글 목록은 프로필 주인이 작성자라 헤더 정보로 보정.
  // 좋아요 탭은 다른 사람 글을 모아보는 영역이라 원작성자 정보를 보존해야 함.
  const profileUser = _userProfileData?.user || {};
  return posts.map(post => {
    const preservePostAuthor = !!options.preservePostAuthor;
    const displayName = preservePostAuthor
      ? (post.authorName || "Lumina User")
      : (profileUser.displayName || "Lumina User");
    const avatarUrl = preservePostAuthor ? (post.avatarUrl || "") : (profileUser.avatarUrl || "");
    const authorTarget = preservePostAuthor
      ? buildUserProfileUrl({
          publicHandle: post.authorPublicHandle,
          id: post.authorUserId
        })
      : "";
    const authorLinkAttr = preservePostAuthor && (post.authorPublicHandle || post.authorUserId)
      ? ` data-user-profile-link="${feedEscapeHtml(authorTarget)}" style="cursor:pointer;"`
      : "";
    const initial = (displayName || "?").charAt(0);
    const avatarSrc = avatarUrl;
    const deleteButton = post.viewer?.canDelete && post.id
      ? `<button class="feed-action-btn feed-delete-btn" type="button" data-feed-delete="${feedEscapeHtml(post.id)}" aria-label="게시글 삭제">삭제</button>`
      : "";
    const editButton = post.viewer?.canEdit && post.id
      ? `<button class="feed-action-btn feed-edit-btn" type="button" data-feed-edit="${feedEscapeHtml(post.id)}" aria-label="게시글 수정">수정</button>`
      : "";
    return `
      <article class="feed-post" data-feed-type="${post.postType}">
        <header class="feed-post-head"${authorLinkAttr}>
          <div class="feed-post-avatar">
            ${avatarSrc
              ? `<img src="${feedEscapeHtml(avatarSrc)}" alt="${feedEscapeHtml(displayName)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="feed-post-avatar-fallback" style="display:none;">${feedEscapeHtml(initial)}</span>`
              : `<span class="feed-post-avatar-fallback">${feedEscapeHtml(initial)}</span>`}
          </div>
          <div class="feed-post-meta">
            <strong class="feed-post-author">${feedEscapeHtml(displayName)}</strong>
          </div>
        </header>
        <p class="feed-post-body">${feedEscapeHtml(post.body)}</p>
        ${renderFeedPostAssets(post.assets)}
        ${renderFeedLinkPreview(post.linkPreview)}
        <footer class="feed-post-actions">
          <button class="feed-action-btn feed-like-btn${post.viewer?.hasLiked ? " is-liked" : ""}" type="button"
                  data-feed-like="${feedEscapeHtml(post.id || "")}"
                  aria-pressed="${post.viewer?.hasLiked ? "true" : "false"}"
                  aria-label="${post.viewer?.hasLiked ? "좋아요 취소하기" : "좋아요 누르기"}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.5-9.5-9.5C1 8.5 3.5 5.5 7 5.5c2 0 3.5 1 5 2.5 1.5-1.5 3-2.5 5-2.5 3.5 0 6 3 4.5 6-2 5-9.5 9.5-9.5 9.5z" stroke="currentColor" fill="none" stroke-width="1.6"/></svg>
            <span data-feed-like-count>${Number(post.likeCount) || 0}</span>
          </button>
          <button class="feed-action-btn feed-comment-btn" type="button" data-feed-comment="${feedEscapeHtml(post.id || "")}" aria-label="댓글 보기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H7l-3 3z" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linejoin="round"/></svg>
            <span>${Number(post.replyCount) > 0 ? Number(post.replyCount) : "0"}</span>
          </button>
          ${editButton}
          ${deleteButton}
        </footer>
      </article>
    `;
  }).join("");
}

function showUserProfileNotFound() {
  const empty = document.getElementById("userProfileEmpty");
  if (empty) { empty.hidden = false; empty.style.display = ""; }
  // 다른 카드들은 강제 숨김
  ["userProfileCard", "userProfileBlocked", "userProfilePostsSection"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.hidden = true; el.style.display = "none"; }
  });
  document.title = "프로필을 찾을 수 없어요 — Lumina Stage";
}
function showUserProfileBlocked() {
  const blocked = document.getElementById("userProfileBlocked");
  if (blocked) { blocked.hidden = false; blocked.style.display = ""; }
  ["userProfileCard", "userProfileEmpty", "userProfilePostsSection"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.hidden = true; el.style.display = "none"; }
  });
  document.title = "이 프로필을 볼 수 없어요 — Lumina Stage";
}

function renderCharacterDetail() {
  const hero = document.getElementById("detailHero");
  if (!hero) return;

  const slug   = new URLSearchParams(window.location.search).get("slug");
  const artist = slug ? getCharacterBySlug(slug) : null;

  // #080 후속 — slug 누락 또는 일치 없음 → 빈상태 안내 (이전: _artists[0] fallback이라 다른 캐릭터가 보였음)
  if (!artist) {
    hero.className = "detail-hero-card";
    hero.innerHTML = `<div class="detail-hero-secret"><strong>아티스트 정보를 찾을 수 없어요</strong><p style="margin-top:8px;color:rgba(240,238,248,0.62);font-size:14px;">URL을 다시 확인하거나 아티스트 목록에서 다시 들어와 주세요.</p><a class="text-link" href="./characters.html" style="margin-top:12px;display:inline-block;">아티스트 목록으로 돌아가기 →</a></div>`;
    const intro = document.getElementById("detailIntro");
    if (intro) intro.innerHTML = "";
    const meta = document.getElementById("detailMeta");
    if (meta) meta.innerHTML = "";
    const gallery = document.getElementById("detailGallery");
    if (gallery) gallery.innerHTML = "";
    const shorts = document.getElementById("detailShorts");
    if (shorts) shorts.innerHTML = "";
    document.title = "아티스트를 찾을 수 없어요 — Lumina Stage";
    return;
  }
  const status = statusMeta[artist.status];

  document.title = `${artist.publicName} — Lumina Stage`;

  // 캐릭터 컬러 CSS 변수 주입
  if (artist.colorAccent) {
    document.documentElement.style.setProperty("--char-accent", artist.colorAccent);
    document.documentElement.style.setProperty("--char-accent-soft", artist.colorAccent + "22");
  }

  hero.className = `detail-hero-card ${status.className}`;
  hero.innerHTML = artist.status === "secret"
    ? `<div class="detail-hero-secret"><span class="eyebrow">${artist.type}</span><strong>${artist.publicName}</strong><em class="catalog-status-caption">${status.label}</em></div>`
    : `<div class="detail-hero-frame"><img class="detail-hero-image detail-hero-image-${artist.slug}" src="${artist.images.thumb || artist.images.cover}" alt="${artist.publicName}" /></div>`;

  const intro = document.getElementById("detailIntro");
  if (intro) {
    intro.innerHTML = `
      <p class="eyebrow">공식 프로필</p>
      <h1>${artist.publicName}</h1>
      <p class="detail-summary">${artist.summary}</p>
      <div class="detail-bio">
        <p>${artist.intro}</p>
        <p class="detail-concept">${artist.concept}</p>
      </div>
      <div class="detail-intro-bottom">
        <div class="detail-sns-section">
          <span class="detail-section-label">SNS</span>
          <div class="detail-sns-buttons">
            <a class="detail-sns-btn detail-sns-btn-youtube" href="#" aria-label="유튜브">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.6 5.8a3 3 0 0 0 2.1 2.1C4.5 20.5 12 20.5 12 20.5s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.8 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>유튜브
            </a>
            <a class="detail-sns-btn detail-sns-btn-insta" href="#" aria-label="인스타그램">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8 0 3.2 0 3.6-.1 4.8-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1-3.2 0-3.6 0-4.8-.1-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12c0-3.2 0-3.6.1-4.8C2.4 3.9 4 2.3 7.2 2.3c1.2-.1 1.6-.1 4.8-.1zm0-2.2C8.7 0 8.3 0 7.1.1 2.7.3.3 2.7.1 7.1.1 8.3 0 8.7 0 12c0 3.3 0 3.7.1 4.9.2 4.4 2.6 6.8 7 7C8.3 24 8.7 24 12 24c3.3 0 3.7 0 4.9-.1 4.4-.2 6.8-2.6 7-7 .1-1.2.1-1.6.1-4.9 0-3.3 0-3.7-.1-4.9-.2-4.4-2.6-6.8-7-7C15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"/></svg>인스타그램
            </a>
            <a class="detail-sns-btn detail-sns-btn-tiktok" href="#" aria-label="틱톡">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 3.3A4.5 4.5 0 0 1 15.2 0h-3.3v16.4a2.7 2.7 0 0 1-2.7 2.3 2.7 2.7 0 0 1-2.7-2.7 2.7 2.7 0 0 1 2.7-2.7c.3 0 .5 0 .8.1V9.9a6 6 0 0 0-.8-.1 6 6 0 0 0-6 6 6 6 0 0 0 6 6 6 6 0 0 0 6-6V8.2a7.8 7.8 0 0 0 4.5 1.4V6.3a4.5 4.5 0 0 1-2.1-3z"/></svg>틱톡
            </a>
          </div>
        </div>
        <div class="detail-tags-section">
          <span class="detail-section-label">태그</span>
          <div class="detail-hashtags">
            ${artist.tags.map(t => `<span class="detail-hashtag">#${t}</span>`).join("")}
          </div>
        </div>
      </div>`;
  }

  const meta = document.getElementById("detailMeta");
  if (meta) {
    const tierLabel = { main: "메인", premium: "프리미엄", sub: "서브", experiment: "실험" };
    meta.innerHTML = `
      <span class="status-badge status-badge-${artist.status}">${status.label}</span>
      <span class="detail-type-tag">${artist.type}</span>
      <span class="detail-tier-tag">${tierLabel[artist.tier] || artist.tier}</span>
      <button class="detail-share-btn" type="button" data-share-character="${artist.slug}" aria-label="이 아티스트 공유하기">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>
        공유하기
      </button>`;
  }

  const gallery = document.getElementById("detailGallery");
  if (gallery) {
    const galleryItems = artist.gallery?.length
      ? artist.gallery.map(item => Array.isArray(item)
        ? { caption: item[0] || "Gallery", src: item[1] }
        : item)
      : [
          { caption: "Cover", src: artist.images.cover },
          { caption: "Thumbnail", src: artist.images.thumb }
        ];

    // detail-body-grid 인라인 스타일 직접 적용 (CSS 충돌 완전 차단)
    const bodyGrid = gallery.closest(".detail-body-grid");
    if (bodyGrid) {
      Object.assign(bodyGrid.style, {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "24px",
        alignItems: "stretch",
        marginBottom: "40px"
      });
    }

    gallery.innerHTML = artist.status === "secret" ? "" : `
      <div id="galleryHeader" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:8px;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);">포토 갤러리</span>
          <strong style="font-size:17px;font-weight:700;color:var(--ink);">공식 이미지</strong>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="galleryPrev" aria-label="이전" style="background:var(--panel);border:1px solid var(--line);color:var(--ink);width:36px;height:36px;border-radius:50%;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">‹</button>
          <span id="galleryCounter" style="font-size:12px;color:var(--muted);min-width:64px;text-align:center;"></span>
          <button id="galleryNext" aria-label="다음" style="background:var(--panel);border:1px solid var(--line);color:var(--ink);width:36px;height:36px;border-radius:50%;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">›</button>
        </div>
      </div>
      <div id="gallerySlider" style="width:100%;flex:1;min-height:0;overflow:hidden;border-radius:14px;background:#16122a;">
        <div id="galleryTrack" style="display:flex;height:100%;"></div>
      </div>`;

    initGallerySlider(galleryItems, artist.publicName);
    initLightbox(galleryItems, artist.publicName);

    // #031: 운영 API에서 정확한 gallery 가져와서 갱신 (에밀리 코드 패턴 적용)
    // /api/v1/artists 목록 응답에 assets가 빠져있는 경우 대비 → 개별 API 호출
    fetchAndUpdateDetailGallery(artist.slug, artist.publicName);
  }

  const profile = document.getElementById("detailProfile");
  if (profile) {
    profile.innerHTML = Object.entries(artist.profile)
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  }

  const shortsRoot = document.getElementById("detailShorts");
  if (shortsRoot) {
    shortsRoot.innerHTML = artist.shorts.map(item => `
      <article class="detail-short-card">
        <div class="detail-short-media ${status.className}"${mediaStyle(artist.images.thumb)}>
          <span class="eyebrow">${artist.publicName}</span>
          <strong>${item.title}</strong>
        </div>
        <div class="detail-short-body"><span>${item.metric}</span></div>
      </article>`).join("");
  }

  const cta = document.getElementById("detailCta");
  if (cta) {
    // #150 — 차모 spec: viewer.canFollow / canUnfollow / isFollowing / stats.followerCount
    // 초기 렌더는 캐릭터 시드 데이터로 일단 표시, fetchArtistDetailViewer()가 비동기로 갱신
    const followerCount = artist._stats?.followerCount;
    const followerText = typeof followerCount === "number"
      ? `<small data-detail-follower-count>팔로워 ${followerCount.toLocaleString("ko-KR")}</small>`
      : `<small data-detail-follower-count></small>`;
    const followBtn = artist.status === "secret"
      ? ""
      : `<button class="cta-btn cta-btn-follow" type="button" data-detail-follow="${feedEscapeHtml(artist.slug)}" hidden>
           <span class="cta-btn-icon">+</span>
           <span class="cta-btn-label"><strong data-detail-follow-label>팔로우</strong>${followerText}</span>
         </button>`;
    cta.innerHTML = artist.status === "secret"
      ? `<div class="detail-cta-card is-secret"><strong>아직 베일 속에 있는 아티스트입니다</strong><p>첫 공개 순간에 가장 잘 어울리는 장면으로 찾아올게요.</p></div>`
      : `<div class="detail-cta-card">
           <div class="detail-cta-info">
             <strong>${artist.publicName}의 다음 무대를 응원하세요</strong>
             <p>오늘의 응원은 순위와 콘텐츠 반응에 반영되어 다음 장면을 여는 힘이 됩니다.</p>
           </div>
           <div class="detail-cta-actions">
             ${followBtn}
             <button class="cta-btn cta-btn-support" disabled>
               <span class="cta-btn-icon">💜</span>
               <span class="cta-btn-label"><strong>후원하기</strong><small>곧 공개</small></span>
             </button>
             <button class="cta-btn cta-btn-chat" disabled>
               <span class="cta-btn-icon">💬</span>
               <span class="cta-btn-label"><strong>캐릭터챗</strong><small>곧 공개</small></span>
             </button>
           </div>
         </div>`;
    // 비동기로 viewer/stats 받아 팔로우 버튼·팔로워 수 갱신
    if (artist.status !== "secret") {
      fetchArtistDetailViewer(artist.slug);
    }
  }

  const tagNav = document.getElementById("detailTagNavigation");
  if (tagNav) {
    tagNav.innerHTML = artist.tags
      .map(t => `<a class="tag-link" href="./characters.html?tag=${encodeURIComponent(t)}">${t}</a>`).join("");
  }
}

/* ── 렌더링: 비즈니스 패키지 ─────────────────── */
function renderBusinessPackages() {
  const root = document.getElementById("businessPackageGrid");
  if (!root) return;
  root.innerHTML = businessPackages.map(item => `
    <article class="package-card">
      <span class="eyebrow">${item.target}</span>
      <strong>${item.name}</strong>
      <p>${item.summary}</p>
      <ul class="package-list">${item.deliverables.map(d => `<li>${d}</li>`).join("")}</ul>
    </article>`).join("");
}

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

function setMypageText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setMypageInput(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function formatMypageNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function getMypageAccountDisplayId(user = {}) {
  const social = user.socialAccount || user.socialProfile || user.oauthAccount || user.providerAccount || {};
  const provider = user.provider || user.socialProvider || social.provider || "";
  const socialId = user.providerUserId || user.socialId || user.externalId || social.providerUserId || social.providerId || social.socialId;
  if (socialId) return provider ? `${provider}:${socialId}` : socialId;
  return user.email ? user.email.split("@")[0] : (user.id || user.userId || user.uuid || "계정 ID 확인 중");
}

function updateMypageProfilePreview(user = {}, displayName = "") {
  const name = displayName || user.displayName || user.name || user.nickname || user.email || "LS";
  const initials = name.replace(/\s+/g, "").slice(0, 2).toUpperCase() || "LS";
  const avatarUrl = user.avatarUrl || user.avatarImageUrl || user.profileImageUrl || user.avatarAsset?.url || user.profileImage?.url || "";
  setMypageText("mypageAvatar", initials);
  setMypageText("mypageProfilePreviewInitial", initials);
  const preview = document.getElementById("mypageProfilePreview");
  if (preview) {
    preview.style.backgroundImage = avatarUrl ? `url('${String(avatarUrl).replace(/'/g, "%27")}')` : "";
    preview.classList.toggle("has-image", !!avatarUrl);
  }
}

/* ══════════════════════════════════════════════
   #058 — 마이페이지 프로필 이미지 업로드/미리보기 (2026-05-03)
   - 흐름: 파일 선택 → 즉시 blob 미리보기 (is-pending)
           → upload-intent → PUT/metadata_only → confirm-upload (is-loading)
           → PATCH /me/profile { avatarAssetId } → setAuth 갱신
           → 헤더 드롭다운 / 피드 작성 아바타 동기화 (is-success)
   - 실패 시: 이전 이미지 원복 + 오류 문구 (is-error)
   ══════════════════════════════════════════════ */
const MYPAGE_AVATAR_ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MYPAGE_AVATAR_MAX_BYTES = 8 * 1024 * 1024; // 8MB — 2026 SNS 표준 (Instagram/FB/LinkedIn/Discord/Threads 동일)

function setMypageAvatarStatus(message, kind = "info") {
  const el = document.getElementById("mypageAvatarStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("is-info", "is-loading", "is-success", "is-error");
  el.classList.add(`is-${kind}`);
}

function setMypageAvatarPreviewState(state) {
  // state: "idle" | "pending" | "loading" | "success" | "error"
  const preview = document.getElementById("mypageProfilePreview");
  if (!preview) return;
  preview.classList.remove("is-pending", "is-loading", "is-success", "is-error");
  if (state && state !== "idle") preview.classList.add(`is-${state}`);
}

function showMypageAvatarBlobPreview(blobUrl) {
  const preview = document.getElementById("mypageProfilePreview");
  if (!preview) return;
  preview.style.backgroundImage = `url('${String(blobUrl).replace(/'/g, "%27")}')`;
  preview.classList.add("has-image");
}

function bindMypageAvatarUpload() {
  const btn = document.getElementById("mypageAvatarButton");
  const input = document.getElementById("mypageAvatarInput");
  if (!btn || !input) return;
  if (btn._bound) return; // idempotent
  btn._bound = true;

  btn.addEventListener("click", () => {
    if (!isLoggedIn()) {
      openAuthModal?.("login");
      return;
    }
    input.click();
  });

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    // 같은 파일 재선택 가능하도록 즉시 비움
    input.value = "";
    if (!file) return;
    await handleMypageAvatarSelect(file);
  });
}

async function handleMypageAvatarSelect(file) {
  // 1) 클라이언트 검증
  if (!MYPAGE_AVATAR_ALLOWED.includes(file.type)) {
    setMypageAvatarPreviewState("error");
    setMypageAvatarStatus("지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.", "error");
    return;
  }
  if (file.size > MYPAGE_AVATAR_MAX_BYTES) {
    setMypageAvatarPreviewState("error");
    setMypageAvatarStatus("이미지는 8MB 이하 파일로 선택해 주세요.", "error");
    return;
  }

  // 2) 즉시 blob 미리보기 (저장 전 임을 시각적으로 구분)
  const blobUrl = URL.createObjectURL(file);
  showMypageAvatarBlobPreview(blobUrl);
  setMypageAvatarPreviewState("pending");
  setMypageAvatarStatus(`${file.name} 미리보기 중. 저장을 진행합니다…`, "info");

  // 3) 업로드 흐름
  try {
    setMypageAvatarPreviewState("loading");
    setMypageAvatarStatus("이미지를 업로드하고 있어요…", "loading");
    await uploadMypageAvatar(file);
    setMypageAvatarPreviewState("success");
    setMypageAvatarStatus("프로필 이미지가 저장됐어요.", "success");
    // 1.6초 후 success 표시 해제 (idle로 복귀, 저장된 이미지는 그대로 유지)
    setTimeout(() => {
      setMypageAvatarPreviewState("idle");
      setMypageAvatarStatus("선택한 이미지는 저장 전에도 이곳에서 먼저 확인할 수 있습니다.", "info");
    }, 1600);
  } catch (err) {
    // 디버깅 — 콘솔에 상세 (사용자가 콘솔에서 어느 단계 실패했는지 확인 가능)
    console.error("[#058 avatar upload] 실패:", err, "status=", err?.status, "body=", err?.body, "stage=", err?._stage);

    // 실패 시 이전 이미지로 원복
    const auth = getAuth();
    updateMypageProfilePreview(auth?.user || {}, auth?.user?.displayName || "");
    setMypageAvatarPreviewState("error");

    // status별 사용자 카피 분기
    let msg;
    if (err?.status === 401) {
      msg = "로그인이 만료됐어요. 다시 로그인해 주세요.";
    } else if (err?.status === 413) {
      msg = "이미지 용량이 너무 커요. 8MB 이하 파일로 다시 시도해 주세요.";
    } else if (err?.status === 415) {
      msg = "지원하지 않는 형식이에요. JPG, PNG, WEBP 파일을 선택해 주세요.";
    } else if (err?.status === 409) {
      msg = "같은 이미지로 이미 처리 중이에요. 잠시 후 다시 시도해 주세요.";
    } else if (err?.status === 429) {
      msg = "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.";
    } else if (err?.message?.includes("Failed to fetch") || err?.name === "AbortError") {
      msg = "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
    } else {
      msg = "이미지 저장에 실패했어요. 잠시 후 다시 시도해 주세요. (상세는 개발자 콘솔 확인)";
    }
    setMypageAvatarStatus(msg, "error");
  } finally {
    // blob URL 메모리 해제 (background-image는 이미 적용됐고, 성공 시 user.avatarUrl로 덮어씌워짐)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }
}

async function uploadMypageAvatar(file) {
  // 1. upload-intent
  let intent;
  try {
    intent = await apiFetch("/api/v1/me/assets/upload-intents", {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {
        fileName: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size
      }
    });
  } catch (err) {
    err._stage = "upload-intents";
    throw err;
  }
  if (!intent?.asset?.id || !intent?.upload) {
    const err = new Error("Invalid upload intent response");
    err._stage = "upload-intents";
    err.body = intent;
    throw err;
  }
  const assetId = intent.asset.id;
  const upload = intent.upload;
  console.info("[#058 avatar upload] intent OK", { assetId, mode: upload.mode });

  // 2. 직접 업로드 (S3/R2 direct upload mode)
  if (upload.mode === "direct_upload_ready" && upload.url) {
    const headers = upload.requiredHeaders || {};
    let putRes;
    try {
      putRes = await fetch(upload.url, {
        method: upload.method || "PUT",
        headers,
        body: file
      });
    } catch (err) {
      err._stage = "direct-upload";
      throw err;
    }
    if (!putRes.ok) {
      const err = new Error(`Upload failed (${putRes.status})`);
      err.status = putRes.status;
      err._stage = "direct-upload";
      throw err;
    }
    console.info("[#058 avatar upload] direct upload OK");
  }
  // metadata_only mode는 PUT 없이 confirm으로 진행

  // 3. confirm-upload
  let confirmed;
  try {
    confirmed = await apiFetch(`/api/v1/me/assets/${encodeURIComponent(assetId)}/confirm-upload`, {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {}
    });
  } catch (err) {
    err._stage = "confirm-upload";
    throw err;
  }
  const finalAsset = confirmed?.asset || confirmed;
  const finalAssetId = finalAsset?.id || assetId;
  console.info("[#058 avatar upload] confirm OK", { finalAssetId, url: finalAsset?.url });

  // 4. PATCH /me/profile { avatarAssetId } — 프로필에 연결
  let patched;
  try {
    patched = await apiFetch("/api/v1/me/profile", {
      method: "PATCH",
      auth: true,
      throwOnError: true,
      body: { avatarAssetId: finalAssetId }
    });
  } catch (err) {
    err._stage = "patch-profile";
    throw err;
  }
  // 응답에서 user 객체 받기 (백엔드에 따라 patched.user 또는 patched 자체)
  const updatedUser = patched?.user || patched;
  console.info("[#058 avatar upload] PATCH profile OK", updatedUser);

  // 5. setAuth 갱신 — 다른 페이지/리로드 시에도 반영되도록
  const auth = getAuth();
  if (auth) {
    const merged = {
      ...auth.user,
      ...updatedUser,
      // 신뢰 가능한 새 url 우선순위 (백엔드 필드명 다양성 대비)
      avatarUrl: updatedUser?.avatarUrl || updatedUser?.avatarAsset?.url || finalAsset?.url || auth.user?.avatarUrl,
      avatarAsset: updatedUser?.avatarAsset || finalAsset || auth.user?.avatarAsset
    };
    setAuth({ ...auth, user: merged });

    // 6. UI 동기화 — 마이페이지 / 헤더 드롭다운 / 피드 작성
    updateMypageProfilePreview(merged, merged.displayName || "");
    syncUserMenuAvatar();
    if (typeof syncFeedComposeAvatar === "function") syncFeedComposeAvatar();
  }
  return updatedUser;
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

async function initMypagePage() {
  if (!document.body.classList.contains("page-mypage")) return;

  const auth = getAuth();
  const user = auth?.user || null;
  const authed = !!auth?.accessToken;

  document.querySelectorAll("[data-auth-required]").forEach(el => {
    el.hidden = !authed;
  });
  document.querySelectorAll("[data-guest-only]").forEach(el => {
    el.hidden = authed;
  });

  document.querySelectorAll("[data-mypage-login]").forEach(btn => {
    btn.onclick = () => openAuthModal("login");
  });
  document.querySelectorAll("[data-mypage-signup]").forEach(btn => {
    btn.onclick = () => openAuthModal("register");
  });
  document.querySelectorAll("[data-mypage-placeholder]").forEach(btn => {
    btn.onclick = () => alert("차모 API 확인 후 연결될 예정입니다.");
  });

  // #058 — 프로필 이미지 업로드 핸들러 바인드 (로그인 여부 무관, 클릭 시 분기)
  bindMypageAvatarUpload();

  if (!authed) return;

  const displayName = user?.displayName || user?.name || user?.nickname || user?.email?.split("@")[0] || "내 계정";
  const email = user?.email || "이메일 확인 중";

  setMypageText("mypageUserName", displayName);
  setMypageText("mypageUserEmail", email);
  updateMypageProfilePreview(user, displayName);
  setMypageInput("mypageProfileId", getMypageAccountDisplayId(user));
  setMypageInput("mypageProfileEmail", email);
  setMypageInput("mypageNickname", displayName);

  // 공개 프로필(user-profile.html) 진입 링크 — publicHandle 우선, 없으면 user.id
  const publicProfileLink = document.getElementById("mypagePublicProfileLink");
  if (publicProfileLink) {
    if (user?.publicHandle) {
      publicProfileLink.href = `./user-profile.html?handle=${encodeURIComponent(user.publicHandle)}`;
      publicProfileLink.hidden = false;
    } else if (user?.id) {
      publicProfileLink.href = `./user-profile.html?id=${encodeURIComponent(String(user.id))}`;
      publicProfileLink.hidden = false;
    } else {
      publicProfileLink.hidden = true;
    }
  }

  const canChangeNickname = user?.canChangeNickname;
  const nextChangeAt = user?.nicknameNextChangeAt;
  if (canChangeNickname === false && nextChangeAt) {
    const nextDate = new Date(nextChangeAt).toLocaleDateString("ko-KR");
    setMypageText("mypageNicknameStatus", `${nextDate} 이후 다시 변경할 수 있습니다.`);
  } else {
    setMypageText("mypageNicknameStatus", "닉네임은 변경 후 30일 동안 다시 바꿀 수 없습니다.");
  }

  if (!_wallet?.loaded) {
    await loadWallet();
  }
  const balance = _wallet?.balance || 0;
  setMypageText("mypageLuminaBalance", formatMypageNumber(balance));
  setMypageText("mypageStellaBalance", balance >= 10000 ? formatMypageNumber(balance / 10000) : "0");
  setMypageText("mypageWalletStatus", _wallet?.loaded ? "현재 사용할 수 있는 잔액입니다." : "잔액 API 확인이 필요합니다.");

  // #140 정산 프로필 — 차모 spec: GET/PATCH /api/v1/me/settlement-profile
  initMypageSettlementProfile();
}

/* #140 — 정산 프로필 (마이페이지 지갑 탭, 차모 spec 그대로)
   - GET /api/v1/me/settlement-profile  → 기존 값 채우기
   - PATCH /api/v1/me/settlement-profile  → 저장
   - 서버 저장: bankName / accountHolderName(마스킹) / accountLast4 / holderMatchesIdentity / payoutExceptionReason
   - 본인인증 / 자동 송금은 별개 흐름 (#115 평가표 본인인증 게이트 30%) */
async function initMypageSettlementProfile() {
  const form = document.getElementById("mypageSettlementForm");
  if (!form) return;

  const bankInput = document.getElementById("settlementBankName");
  const holderInput = document.getElementById("settlementHolder");
  const last4Input = document.getElementById("settlementLast4");
  const matchCheck = document.getElementById("settlementHolderMatch");
  const exceptionWrap = document.getElementById("settlementExceptionWrap");
  const exceptionInput = document.getElementById("settlementException");
  const errorEl = document.getElementById("settlementError");
  const savedEl = document.getElementById("settlementSaved");
  const saveBtn = document.getElementById("settlementSaveBtn");

  // 본인 명의 체크 시 예외 사유 영역 토글
  const updateExceptionVisibility = () => {
    if (!exceptionWrap) return;
    exceptionWrap.hidden = !!matchCheck?.checked;
  };
  matchCheck?.addEventListener("change", updateExceptionVisibility);

  // 1. 기존 정산 프로필 GET
  try {
    const res = await apiFetch("/api/v1/me/settlement-profile", { auth: true });
    const profile = res?.profile || res?.data || res || {};
    if (bankInput) bankInput.value = profile.bankName || "";
    if (holderInput) holderInput.value = profile.accountHolderName || "";
    if (last4Input) last4Input.value = profile.accountLast4 || "";
    if (matchCheck) matchCheck.checked = !!profile.holderMatchesIdentity;
    if (exceptionInput) exceptionInput.value = profile.payoutExceptionReason || "";
    updateExceptionVisibility();
    if (savedEl && (profile.bankName || profile.accountLast4)) {
      savedEl.textContent = "최근 저장된 정보를 불러왔어요.";
      savedEl.hidden = false;
    }
  } catch (err) {
    // 신규 사용자 — 404/empty는 정상
    console.info("[#140 settlement-profile] 기존 정보 없음 또는 미연결:", err?.status);
    updateExceptionVisibility();
  }

  // 2. 저장
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (errorEl) errorEl.hidden = true;
    if (savedEl) savedEl.hidden = true;

    const bankName = (bankInput?.value || "").trim();
    const accountHolderName = (holderInput?.value || "").trim();
    const accountLast4 = (last4Input?.value || "").trim();
    const holderMatchesIdentity = !!matchCheck?.checked;
    const payoutExceptionReason = (exceptionInput?.value || "").trim();

    // 클라이언트 검증
    if (!bankName) return showSettlementError("은행명을 입력해주세요.");
    if (!accountHolderName) return showSettlementError("예금주를 입력해주세요.");
    if (!/^[0-9]{4}$/.test(accountLast4)) return showSettlementError("계좌 끝 4자리는 숫자 4자리여야 해요.");

    const payload = { bankName, accountHolderName, accountLast4, holderMatchesIdentity };
    if (!holderMatchesIdentity && payoutExceptionReason) {
      payload.payoutExceptionReason = payoutExceptionReason;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "저장 중…";
    }
    try {
      await apiFetch("/api/v1/me/settlement-profile", {
        method: "PATCH",
        auth: true,
        throwOnError: true,
        body: payload
      });
      if (savedEl) {
        savedEl.textContent = "정산 정보를 저장했어요.";
        savedEl.hidden = false;
      }
    } catch (err) {
      console.warn("[#140 settlement-profile PATCH] 실패", { status: err?.status, body: err?.body });
      showSettlementError(err?.message || "저장에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "저장";
      }
    }
  });

  function showSettlementError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }
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
    ".feed-post-asset-item img", ".feed-link-preview-thumb img",
    ".gallery-slide img",        // 포토 갤러리 슬라이드 (cell 안 img)
    "#galleryTrack img",         // 갤러리 트랙(id) 안 모든 img
    "#gallerySlider img",        // 갤러리 슬라이더(id) 안 모든 img
    ".encar-main-img",           // 라이트박스 메인 이미지
    ".encar-thumb",              // 라이트박스 하단 썸네일
    ".mypage-profile-image img"
  ].join(", ");
  document.addEventListener("contextmenu", e => {
    if (e.target.matches?.(protectedSelector)) e.preventDefault();
  }, { passive: false });
  // 드래그 시작 방지 (CSS user-drag와 함께 이중 보강)
  document.addEventListener("dragstart", e => {
    if (e.target.matches?.(protectedSelector)) e.preventDefault();
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
  initMypagePage();
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

  renderMainArtists();
  renderHeroFeature();
  renderDebutLine();
  renderShortforms();
  renderShortformHub();
  renderBusinessPackages();
  renderRoster();
  renderCharacterCatalog();
  bindCharacterFilters();
  renderCharacterDetail();
  bindArtistDetailFollow(); // #150 — 아티스트 상세 팔로우 버튼
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
    await initChargePage();
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

init();
