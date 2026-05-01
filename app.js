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

async function apiFetch(path, options = {}) {
  if (!API_BASE) return null;
  const { method = "GET", body, auth = false, throwOnError = false } = options;

  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

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

async function authLogin(email, password) {
  const data = await apiFetch("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
    throwOnError: true
  });
  if (data?.accessToken) setAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
  return data;
}
async function authRegister(email, password, displayName) {
  const data = await apiFetch("/api/v1/auth/register", {
    method: "POST",
    body: { email, password, displayName },
    throwOnError: true
  });
  if (data?.accessToken) setAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
  return data;
}
async function authLogout() {
  try { await apiFetch("/api/v1/auth/logout", { method: "POST", auth: true }); } catch {}
  clearAuth();
  updateAuthUI();
}

/* ── 백엔드 응답에서 토큰 추출 (키 이름 자동 인식) ── */
function applyAuthResponse(data, providerName = "백엔드") {
  console.log(`[Lumina] ${providerName} 응답 받음:`, data);
  // 백엔드가 다양한 키로 응답할 수 있어 모두 시도
  const accessToken = data?.accessToken || data?.access_token || data?.token;
  const refreshToken = data?.refreshToken || data?.refresh_token;
  const user = data?.user || data?.profile || data?.account || data?.member;

  if (!accessToken) {
    console.error(`[Lumina] ${providerName} 응답에 토큰 없음:`, data);
    alert(`${providerName} 로그인 실패\n\n백엔드 응답:\n${JSON.stringify(data, null, 2)}\n\n→ 백엔드 응답 형식 확인 필요`);
    return false;
  }
  setAuth({ accessToken, refreshToken, user });
  closeAuthModal();
  updateAuthUI();
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
        <label class="auth-modal-field"><span>닉네임</span>
          <input type="text" name="displayName" required autocomplete="nickname" placeholder="팬덤에서 쓸 이름" /></label>
        <label class="auth-modal-field"><span>비밀번호 (8자 이상)</span>
          <input type="password" name="password" required minlength="8" autocomplete="new-password" /></label>
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
      await authRegister(form.email.value.trim(), form.password.value, form.displayName.value.trim());
    }
    closeAuthModal();
    updateAuthUI();
    form.reset();
  } catch (err) {
    errorEl.textContent = err.message || (mode === "login" ? "로그인에 실패했습니다." : "가입에 실패했습니다.");
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

function openAuthModal(tab = "login") {
  createAuthModal();
  const modal = document.getElementById("authModal");
  switchAuthTab(tab);
  modal.classList.add("is-open");
  document.body.style.overflow = "hidden";
  setTimeout(() => modal.querySelector(`[data-form="${tab}"] input[name="email"]`)?.focus(), 120);
  // 소셜 로그인 버튼 자동 로드 (활성화된 provider만)
  renderSocialButtons();
  // Google SDK 미리 로드 (클릭 시 더 빠른 반응)
  loadGoogleSDK().catch(() => { /* 클릭 시 다시 시도 */ });
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
    alert("카카오 로그인 준비 중입니다.\n(Kakao JavaScript Key 등록 필요)");
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
    alert("네이버 로그인 준비 중입니다.\n(Naver Client ID 등록 필요)");
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

function getLikesCount(slug) {
  const rank = _rankings.find(r => r.slug === slug);
  return rank?.likes || 0;
}

function formatLikeCount(n) {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(".0", "") + "만";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(".0", "") + "천";
  return String(n);
}

function likeButtonHTML(slug) {
  const count = getLikesCount(slug);
  const liked = _userLikedSlugs.has(slug) ? " is-liked" : "";
  return `
    <button class="like-btn${liked}" data-like-slug="${slug}" type="button" aria-label="좋아요">
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
    await apiFetch(`/api/v1/boost-campaigns/${_currentCampaign.id}/free-like`, {
      method: "POST",
      body: { artistSlug: slug },
      auth: true,
      throwOnError: true
    });
    // 성공: 클라이언트 상태 + UI 업데이트
    _userLikedSlugs.add(slug);
    const rank = _rankings.find(r => r.slug === slug);
    if (rank) rank.likes += 1;
    else _rankings.push({ slug, likes: 1 });
    updateLikeButtons(slug);
  } catch (err) {
    console.error("[Lumina] 좋아요 실패:", err);
    if (err.status === 429 || err.body?.code === "DAILY_LIMIT") {
      alert("오늘 좋아요를 모두 보내셨어요!\n내일 다시 응원해주세요 💜");
    } else if (err.status === 401) {
      clearAuth();
      updateAuthUI();
      openAuthModal("login");
    } else {
      alert("좋아요 실패: " + (err.message || "잠시 후 다시 시도해주세요"));
    }
    if (btnEl) btnEl.disabled = false;
  }
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
    handleLike(btn.dataset.likeSlug, btn);
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
  } else {
    loginBtn.textContent = "로그인";
    loginBtn.dataset.action = "login";
    signupBtn.textContent = "회원가입";
    signupBtn.dataset.action = "signup";
  }
  // 드롭다운 닫기 (UI 갱신 시)
  closeUserMenu();
}

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
    <button class="user-menu-item" type="button" data-action="profile">
      <span>마이 프로필</span>
      <small>준비 중</small>
    </button>
    <button class="user-menu-item" type="button" data-action="wallet">
      <span>루미나 지갑</span>
      <small>준비 중</small>
    </button>
    <button class="user-menu-item" type="button" data-action="orders">
      <span>주문 내역</span>
      <small>준비 중</small>
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
      } else {
        // 준비 중 메뉴
        alert("이 기능은 곧 추가됩니다!");
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
    gender: "female", type: "아이돌", tier: "main", status: "public",
    role: "대표 비주얼",
    artistDescription: "Lumina Stage의 첫 무대를 맡게 됐어요. 차갑게 등장해서, 뜨겁게 각인될게요.",
    summary: "차갑게, 그러나 또렷하게.",
    fandom: "강한 비주얼 입덕형",
    business: "뷰티, 향수, 패션 필름",
    tags: ["시크", "퍼포먼스", "뷰티"],
    colorAccent: "#c4b0f0",
    images: { cover: "./assets/characters/yoon-serin/cover.png", thumb: "./assets/characters/yoon-serin/thumb.png" },
    intro: "서울 강남에서 태어난 윤세린은 열 살 때 우연히 참가한 뮤직비디오 오디션을 계기로 아역모델로 데뷔했다. 또래보다 훨씬 강한 눈빛과 타고난 무대 감각으로 현장에서 빠르게 이름을 알렸고, 중학교 2학년 재학 중 스타에이 엔터테인먼트 연습생으로 선발되며 본격적인 아티스트의 길을 걷기 시작했다. 2년간의 혹독한 훈련을 거치며 퍼포먼스와 비주얼 양면에서 정제된 무기를 갖추게 됐고, 이후 Lumina Stage 1기 메인 대표로 데뷔했다.",
    concept: "강한 시선, 정제된 퍼포먼스, 그리고 일상과 무대 사이의 극적인 온도 차. 윤세린은 차갑게 등장해서 뜨겁게 각인된다.",
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
    type: "아이돌", tier: "main", status: "public",
    role: "센터 확장",
    artistDescription: "센터에 서서 모두를 빛나게 만들고 싶어요. 혼자 빛나는 무대는 없으니까요.",
    summary: "센터에서 다 같이, 더 빛나게.",
    fandom: "대중형 확장형",
    business: "패션, 음료, 라이프스타일",
    tags: ["센터", "하이틴", "대중성"],
    colorAccent: "#f0a8cc",
    images: { cover: "./assets/characters/han-seoyul/cover.png", thumb: "./assets/characters/han-seoyul/thumb.png" },
    intro: "경기도 분당에서 자란 한서율은 중학교 시절 전국 청소년 댄스 대회에서 2연패를 달성하며 일찌감치 재능을 증명했다. 아이디어엠 공개 오디션 최종 합격 후 1년간 트레이닝을 마치고 Lumina Stage 1기로 합류했다. 센터에 서는 순간 공간 전체를 밝히는 반짝임이 있고, 어떤 팀원과 붙어도 자연스럽게 분위기를 끌어올리는 무드메이커 기질이 타고났다.",
    concept: "센터의 무게를 즐기되 절대 혼자 빛나지 않는다. 한서율의 존재감은 모두가 더 빛나게 만드는 방식으로 작동한다.",
    profile: { 생년월일: "2003년 6월 22일 (만 22세)", 출신지: "경기도 분당", 신체: "166cm", 혈액형: "O형", 포지션: "메인 아이돌 / 센터형", 데뷔: "2024년 Lumina Stage 1기", 팬포인트: "정면 비주얼과 대중성", 광고축: "패션 · 음료 · 라이프스타일", MBTI: "ENFJ", 취미: "배드민턴, 카페 투어, 그림 그리기" },
    shorts: [{ title: "센터 무드 스냅", metric: "조회 9.7만" }, { title: "하이틴 센터 포맷", metric: "조회 10.1만" }, { title: "팬서비스 포토무드", metric: "좋아요 2.8만" }]
  },
  {
    name: "박도아", publicName: "박도아", slug: "park-doa",
    gender: "female",
    type: "스트리머", tier: "main", status: "public",
    role: "팬 소통형",
    artistDescription: "옆집 언니처럼 편하게 다가갈게요. 솔직하게, 자주 만나러 와요~",
    summary: "솔직하고 편하게, 옆집 언니처럼.",
    fandom: "댓글·호감 전환형",
    business: "푸드, 라이프, 커머스",
    tags: ["친근함", "리액션", "생활형"],
    colorAccent: "#f0c870",
    images: { cover: "./assets/characters/park-doa/cover.png", thumb: "./assets/characters/park-doa/thumb.png" },
    intro: "부산 해운대 출신 박도아는 고등학교 1학년 때 시작한 틱톡 계정이 6개월 만에 팔로워 12만을 돌파하며 자신의 가능성을 직접 증명했다. 먹방, 리액션, 일상 브이로그를 자유롭게 오가는 콘텐츠 감각과 부산 특유의 직설적인 입담이 팬들의 마음을 사로잡았다.",
    concept: "화면 속에 있어도 옆집 언니처럼 편하다. 박도아의 친근함은 설계된 것이 아니라 그냥 그런 사람이라서다.",
    profile: { 생년월일: "2002년 11월 5일 (만 23세)", 출신지: "부산 해운대구", 신체: "163cm", 혈액형: "B형", 포지션: "커뮤니티 훅 / 스트리머", 데뷔: "2024년 Lumina Stage 1기", 팬포인트: "리액션과 친근함", 광고축: "푸드 · 커머스 · 라이프", MBTI: "ESFP", 취미: "먹방 촬영, 독서, 바다 수영" },
    shorts: [{ title: "친근 리액션 포맷", metric: "조회 15.3만" }, { title: "생활형 브이로그컷", metric: "댓글 1.1천" }, { title: "먹방 리액션 티저", metric: "저장 3.7천" }]
  },
  {
    name: "최서진", publicName: "최서진", slug: "choi-seojin",
    gender: "female",
    type: "배우", tier: "premium", status: "public",
    role: "프리미엄 간판",
    artistDescription: "조용하지만 분명한 무게감으로 화면을 채울게요. 한 컷, 하나의 화보로.",
    summary: "한 컷의 무게감, 한 장의 화보.",
    fandom: "프리미엄 선망형",
    business: "주얼리, 럭셔리 뷰티, 에디토리얼",
    tags: ["럭셔리", "에디토리얼", "프리미엄"],
    colorAccent: "#a0bce8",
    images: { cover: "./assets/characters/choi-seojin/cover.png", thumb: "./assets/characters/choi-seojin/thumb.png" },
    intro: "서울 용산에서 태어난 최서진은 여덟 살 때 아역배우로 첫 스크린을 밟았다. 성장하면서 자연스럽게 패션·뷰티 모델로 영역을 넓혔고, 파리 아르떼 에콜 교환학생으로 선발되어 유럽 예술·패션 씬을 직접 경험했다. Lumina Stage에서는 프리미엄 라인의 간판을 맡아 스튜디오 전체의 품격을 책임진다.",
    concept: "화려하지 않아도 존재감이 넘친다. 최서진이 있는 장면은 그 자체로 하나의 화보가 된다.",
    profile: { 생년월일: "1999년 1월 28일 (만 27세)", 출신지: "서울 용산구", 신체: "172cm", 혈액형: "AB형", 포지션: "프리미엄 메인 / 배우", 데뷔: "2024년 Lumina Stage 1기", 팬포인트: "고급감과 존재감", 광고축: "주얼리 · 럭셔리 뷰티 · 에디토리얼", MBTI: "INFJ", 취미: "현대미술 관람, 와인 페어링, 필름 카메라" },
    shorts: [{ title: "에디토리얼 컷 무드", metric: "조회 6.2만" }, { title: "럭셔리 화보 티저", metric: "저장 2.1천" }, { title: "브랜드 무드 필름", metric: "완주율 68%" }]
  },
  {
    name: "오혜린", publicName: "오혜린", slug: "oh-hyerin",
    gender: "female",
    type: "아이돌", tier: "sub", status: "debut",
    role: "감성 보컬",
    artistDescription: "청아한 보컬과 감정 몰입형 콘텐츠로 데뷔를 준비 중인 서브 아이돌.",
    summary: "감성 보컬 중심의 청아한 라인",
    fandom: "감성 몰입형", business: "음향, 감성 캠페인, 뷰티",
    tags: ["보컬", "감성", "청아함"],
    colorAccent: "#a8d8f0",
    images: { cover: "./assets/characters/oh-hyerin/cover.jpg", thumb: "./assets/characters/oh-hyerin/thumb.jpg" },
    intro: "청아한 보컬 감성을 중심으로 데뷔를 준비 중인 라인입니다.",
    concept: "감정 몰입형 숏폼과 무드형 콘텐츠에 적합한 예비 아이돌.",
    profile: { 포지션: "서브 아이돌 / 보컬", 팬포인트: "청아함과 감성선", 운영상태: "데뷔 예정", 광고축: "감성 캠페인 · 뷰티" },
    shorts: [{ title: "데뷔 예정 무드", metric: "준비 중" }]
  },
  {
    name: "민채온", publicName: "민채온", slug: "min-chaeon",
    gender: "female",
    type: "아이돌", tier: "candidate", status: "secret",
    role: "피트니스 아이돌",
    artistDescription: "큐티한 얼굴과 건강한 글래머 체형의 반전. 후원 전환율이 높은 피트니스형 아이돌.",
    summary: "큐티 피트니스 반전 매력 아이돌",
    fandom: "직관적 매력 소비형", business: "피트니스, 스포츠 뷰티, 라이프스타일",
    tags: ["피트니스", "러블리", "반전매력"],
    colorAccent: "#f0b0c0",
    images: { cover: "./assets/characters/min-chaeon/cover.jpg", thumb: "./assets/characters/min-chaeon/thumb.jpg" },
    intro: "큐티한 얼굴과 건강한 체형의 반전 매력으로 주목받는 피트니스형 아이돌입니다.",
    concept: "귀여운 줄 알았는데 무대에 서면 완전히 다른 사람이 된다.",
    profile: { 포지션: "피트니스 아이돌", 팬포인트: "귀여움과 건강미 반전", 광고축: "피트니스 · 스포츠 뷰티" },
    shorts: [{ title: "피트니스 티저", metric: "공개 예정" }]
  },
  {
    name: "차도현", publicName: "차도현", slug: "cha-dohyun",
    gender: "male",
    type: "아티스트", tier: "sub", status: "public",
    role: "젠더리스 패션",
    artistDescription: "첫 무대를 앞두고 있어요. 패션은 갑옷, 무대는 전쟁터 — 어떤 옷을 입어도 결국 저답게.",
    summary: "곧 무대 위에서 만나요. 결국 저답게.",
    fandom: "아티스트 팬덤형",
    business: "하이패션, 매거진 화보, 스트릿 럭셔리",
    tags: ["하이패션", "젠더리스", "아티스트"],
    colorAccent: "#9090d0",
    images: { cover: "./assets/characters/cha-dohyun/cover.jpg", thumb: "./assets/characters/cha-dohyun/thumb.jpg" },
    intro: "슬림한 실루엣과 날카로운 눈매, 체인과 진주 레이어링이 트레이드마크. 하이패션과 K-pop 아티스트성을 동시에 구현하는 Lumina Stage 첫 번째 남성 아티스트다. 성별을 초월한 스타일링과 무대 퍼포먼스로 장르의 경계를 무너뜨린다.",
    concept: "패션은 갑옷이고 무대는 전쟁터다. 차도현은 어떤 옷을 입어도 결국 자기 자신이다.",
    profile: { 포지션: "젠더리스 패션 아티스트", 팬포인트: "하이패션과 아티스트성", 광고축: "하이패션 · 매거진 · 스트릿 럭셔리", MBTI: "INFP", 취미: "빈티지 패션 수집, 드로잉, 전시 탐방" },
    shorts: [{ title: "하이패션 화보 티저", metric: "공개 중" }, { title: "스트릿 룩북", metric: "조회 8.1만" }]
  },
  {
    name: "강시아", publicName: "강시아", slug: "kang-sia",
    gender: "female",
    type: "모델", tier: "candidate", status: "secret",
    role: "도시형 라이프스타일",
    artistDescription: "에포트리스 시크 무드의 도시형 모델. 향수·데님·카페 감성에 특화.",
    summary: "에포트리스 시크 도시형 모델",
    fandom: "라이프스타일 선망형", business: "향수, 데님, 도시 라이프스타일",
    tags: ["시크", "내추럴", "라이프스타일"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/kang-sia/cover.jpg", thumb: "./assets/characters/kang-sia/thumb.jpg" },
    intro: "공개 예정 라인입니다.", concept: "아무것도 하지 않는 것처럼 보이는데 가장 멋있다.",
    profile: { 포지션: "도시형 모델", 팬포인트: "비공개", 광고축: "향수 · 데님 · 라이프스타일" },
    shorts: [{ title: "Coming Soon", metric: "공개 예정" }]
  },
  {
    name: "이지원", publicName: "이지원", slug: "lee-jiwon",
    gender: "female",
    type: "배우", tier: "candidate", status: "secret",
    role: "쿨한 톱스타",
    artistDescription: "긴 흑발과 쿨한 아우라의 톱스타형 배우. 자동차·테크·액션 광고에 특화.",
    summary: "쿨한 톱스타 배우 포지션",
    fandom: "선망형", business: "자동차, 테크, 액션 화보",
    tags: ["톱스타", "쿨함", "액션"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/lee-jiwon/cover.jpg", thumb: "./assets/characters/lee-jiwon/thumb.jpg" },
    intro: "공개 예정 라인입니다.", concept: "바람에 흔들리지 않는다. 원래 그런 사람이라서.",
    profile: { 포지션: "쿨 톱스타 배우", 팬포인트: "비공개", 광고축: "자동차 · 테크 · 액션" },
    shorts: [{ title: "Coming Soon", metric: "공개 예정" }]
  },
  {
    name: "하윤아", publicName: "하윤아", slug: "ha-yuna",
    gender: "female",
    type: "모델", tier: "candidate", status: "secret",
    role: "SNS 스트릿 뷰티",
    artistDescription: "고양이상 눈매와 비비드 컬러의 SNS 스트릿 뷰티. 숏폼 트렌드 특화.",
    summary: "SNS 스트릿 쿨뷰티 트렌드세터",
    fandom: "트렌드 팔로워형", business: "스트릿 패션, 색조 뷰티, Y2K",
    tags: ["스트릿", "뷰티", "트렌드"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/ha-yuna/cover.jpg", thumb: "./assets/characters/ha-yuna/thumb.jpg" },
    intro: "공개 예정 라인입니다.", concept: "트렌드를 따라가는 게 아니라 트렌드를 만든다.",
    profile: { 포지션: "스트릿 뷰티 모델", 팬포인트: "비공개", 광고축: "스트릿 패션 · 색조 뷰티" },
    shorts: [{ title: "Coming Soon", metric: "공개 예정" }]
  },
  {
    name: "백리아", publicName: "백리아", slug: "baek-ria",
    gender: "female",
    type: "아이돌", tier: "candidate", status: "secret",
    role: "청량 직캠 보컬",
    artistDescription: "맑은 얼굴과 청량 컬러의 직캠형 아이돌. 보컬 커버와 여름 무대 콘텐츠 특화.",
    summary: "청량 보컬 직캠 아이돌",
    fandom: "직캠 바이럴형", business: "청량 무대, 여름 음료, 직캠 숏폼",
    tags: ["청량", "보컬", "직캠"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/baek-ria/cover.jpg", thumb: "./assets/characters/baek-ria/thumb.jpg" },
    intro: "공개 예정 라인입니다.", concept: "무대에서 가장 밝게 빛나는 사람.",
    profile: { 포지션: "청량 직캠 보컬", 팬포인트: "비공개", 광고축: "청량 무대 · 여름 콘텐츠" },
    shorts: [{ title: "Coming Soon", metric: "공개 예정" }]
  },
  {
    name: "오유나", publicName: "오유나", slug: "oh-yuna",
    gender: "female",
    type: "아이돌", tier: "candidate", status: "secret",
    role: "여름 페스티벌 디바",
    artistDescription: "워터 페스티벌과 솔로 무대의 디바. 시즌 이벤트와 여름 광고 특화.",
    summary: "여름 페스티벌 솔로 디바",
    fandom: "시즌 이벤트형", business: "워터 스포츠, 여름 음료, 솔로 무대",
    tags: ["페스티벌", "디바", "여름"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/oh-yuna/cover.jpg", thumb: "./assets/characters/oh-yuna/thumb.jpg" },
    intro: "공개 예정 라인입니다.", concept: "여름이 오면 가장 먼저 생각나는 사람.",
    profile: { 포지션: "여름 페스티벌 디바", 팬포인트: "비공개", 광고축: "워터 스포츠 · 여름 음료" },
    shorts: [{ title: "Coming Soon", metric: "공개 예정" }]
  },
  {
    name: "권태준", publicName: "권태준", slug: "kwon-taejun",
    gender: "male",
    type: "배우", tier: "candidate", status: "secret",
    role: "누아르 배우",
    artistDescription: "넓은 어깨와 깊은 눈빛의 누아르 배우. 저음 챗과 감정 연기 콘텐츠 특화.",
    summary: "묵직한 누아르 배우 포지션",
    fandom: "감성 몰입형", business: "수트, 시계, 향수, 누아르",
    tags: ["누아르", "배우", "감성"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/kwon-taejun/cover.jpg", thumb: "./assets/characters/kwon-taejun/thumb.jpg" },
    intro: "공개 예정 라인입니다.", concept: "말이 없어도 존재감이 공간을 채운다.",
    profile: { 포지션: "누아르 배우", 팬포인트: "비공개", 광고축: "수트 · 시계 · 향수" },
    shorts: [{ title: "Coming Soon", metric: "공개 예정" }]
  },
  {
    name: "서하민", publicName: "서하민", slug: "seo-hamin",
    gender: "male",
    type: "MC", tier: "candidate", status: "secret",
    role: "커뮤니티 MC",
    artistDescription: "안경과 큐카드의 유쾌한 이벤트 진행자. 플랫폼 이벤트와 커뮤니티 리텐션 특화.",
    summary: "유쾌한 이벤트 MC 포지션",
    fandom: "커뮤니티 참여형", business: "예능 숏폼, 팬 이벤트, 고민 상담",
    tags: ["MC", "예능", "커뮤니티"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/seo-hamin/cover.jpg", thumb: "./assets/characters/seo-hamin/thumb.jpg" },
    intro: "공개 예정 라인입니다.", concept: "분위기를 만드는 사람이 따로 있다.",
    profile: { 포지션: "이벤트 MC", 팬포인트: "비공개", 광고축: "예능 · 팬 이벤트" },
    shorts: [{ title: "Coming Soon", metric: "공개 예정" }]
  },
  {
    name: "류태오", publicName: "류태오", slug: "ryu-taeo",
    gender: "male",
    type: "스포츠", tier: "candidate", status: "secret",
    role: "스포츠 챌린지",
    artistDescription: "밝은 미소와 애슬레틱 체형의 스포츠 챌린지 캐릭터. 글로벌 응원 캠페인 특화.",
    summary: "스포츠 챌린지 응원 캐릭터",
    fandom: "응원 캠페인형", business: "스포츠, 에너지 드링크, 챌린지",
    tags: ["스포츠", "챌린지", "응원"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/ryu-taeo/cover.jpg", thumb: "./assets/characters/ryu-taeo/thumb.jpg" },
    intro: "공개 예정 라인입니다.", concept: "포기하지 않는 에너지가 전염된다.",
    profile: { 포지션: "스포츠 챌린지", 팬포인트: "비공개", 광고축: "스포츠 · 에너지 드링크" },
    shorts: [{ title: "Coming Soon", metric: "공개 예정" }]
  },
  {
    name: "서유안", publicName: "서유안", slug: "seo-yuan",
    gender: "female",
    type: "모델", tier: "sub", status: "public",
    role: "내추럴 모델",
    artistDescription: "데뷔를 앞두고 있어요. 꾸민 듯 안 꾸민 듯, 가장 편안한 저로 인사드릴게요.",
    summary: "곧 화면에서 만나요. 자연스럽게, 편안하게.",
    fandom: "호감·선망형", business: "스킨케어, 리빙, 뷰티",
    tags: ["내추럴", "우아함", "뷰티"],
    colorAccent: "#b8f0d0",
    images: { cover: "./assets/characters/seo-yuan/cover.jpg", thumb: "./assets/characters/seo-yuan/thumb.jpg" },
    intro: "투명한 피부와 단아한 롱헤어, 미니멀한 화이트 룩이 트레이드마크. 스킨케어와 홈리빙 광고에서 신뢰감 있는 무드를 만들어낸다.",
    concept: "꾸민 듯 안 꾸민 듯, 그 자체로 완성된 사람.",
    profile: { 포지션: "내추럴 럭셔리 모델", 팬포인트: "호감형 우아함", 광고축: "스킨케어 · 홈리빙 · 뷰티" },
    shorts: [{ title: "스킨케어 무드컷", metric: "공개 중" }]
  }
];

const characterFrontAssets = {
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
    gallery: [
      ["Angle profile", "./assets/characters/han-seoyul/reference/angle-profile-01.png"],
      ["Backstage emotion", "./assets/characters/han-seoyul/reference/backstage-emotion-closeup-01.png"],
      ["Backstage in-ear", "./assets/characters/han-seoyul/reference/backstage-in-ear-01.png"],
      ["Cover mid", "./assets/characters/han-seoyul/reference/cover-mid-01.png"],
      ["Mirror rehearsal", "./assets/characters/han-seoyul/reference/dance-rehearsal-mirror-01.png"],
      ["Fan service", "./assets/characters/han-seoyul/reference/fanservice-selfie-01.png"],
      ["Focused rehearsal", "./assets/characters/han-seoyul/reference/focused-rehearsal-notes-01.png"],
      ["Full body angle", "./assets/characters/han-seoyul/reference/full-body-angle-walk-01.png"],
      ["Full body 01", "./assets/characters/han-seoyul/reference/full-body-reference-01.png"],
      ["Full body 02", "./assets/characters/han-seoyul/reference/full-body-reference-02.png"],
      ["Performance mic 01", "./assets/characters/han-seoyul/reference/performance-mic-01.png"],
      ["Performance mic 02", "./assets/characters/han-seoyul/reference/performance-mic-02.png"],
      ["Performance mic 03", "./assets/characters/han-seoyul/reference/performance-mic-03.png"],
      ["Pout expression", "./assets/characters/han-seoyul/reference/pout-expression-01.png"],
      ["Recording booth", "./assets/characters/han-seoyul/reference/recording-booth-headphone-01.png"],
      ["Vocal practice", "./assets/characters/han-seoyul/reference/rehearsal-vocal-practice-01.png"],
      ["Stage motion", "./assets/characters/han-seoyul/reference/stage-motion-hair-01.png"],
      ["Thumb close-up 01", "./assets/characters/han-seoyul/reference/thumb-closeup-01.png"],
      ["Thumb close-up 02", "./assets/characters/han-seoyul/reference/thumb-closeup-02.png"]
    ]
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
      ["Surprised bite", "./assets/characters/park-doa/reference-final/12_mukbang-surprised-bite-01.png"]
    ]
  }
};

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

/* ── 상태 메타 ──────────────────────────────── */
const statusMeta = {
  public:    { label: "공개 활동 중",  summaryLabel: "공개 중",   className: "is-public"    },
  debut:     { label: "데뷔 예정",     summaryLabel: "곧 공개",   className: "is-debut"     },
  secret:    { label: "Coming Soon",   summaryLabel: "공개 예정", className: "is-secret"    },
  candidate: { label: "Coming Soon",   summaryLabel: "공개 예정", className: "is-secret"    }
};

/* ── 숏폼 데이터 (로컬 fallback) ────────────── */
const shortformsLocal = [
  { title: "메인 비주얼 티저",   artist: "윤세린", metric: "조회 12.4만", tone: "데뷔 전 첫 컷, 차갑게 가볼게요.",                  image: "./assets/characters/yoon-serin/thumb.png" },
  { title: "콘셉트 퍼포먼스",    artist: "윤세린", metric: "조회 11.8만", tone: "이번 콘셉트, 끝까지 봐주세요.",                  image: "./assets/characters/yoon-serin/cover.png" },
  { title: "센터 무드 스냅",     artist: "한서율", metric: "조회 9.7만",  tone: "오늘도 무대 가요! 응원해주세요🎀",              image: "./assets/characters/han-seoyul/thumb.png" },
  { title: "하이틴 센터 포맷",   artist: "한서율", metric: "조회 10.1만", tone: "이 무대, 다 같이 즐겨봐요!",                     image: "./assets/characters/han-seoyul/cover.png" },
  { title: "친근 리액션 포맷",   artist: "박도아", metric: "조회 15.3만", tone: "오늘도 평범한 일상! 같이 봐줄래?",              image: "./assets/characters/park-doa/thumb.png"   },
  { title: "먹방 리액션 티저",   artist: "박도아", metric: "저장 3.7천",  tone: "이거 진짜 맛있어요... 다음 영상 기대해요😋",     image: "./assets/characters/park-doa/cover.png"   },
  { title: "에디토리얼 컷 무드", artist: "최서진", metric: "조회 6.2만",  tone: "이번 화보에서 가장 좋아하는 컷이에요.",         image: "./assets/characters/choi-seojin/thumb.png"},
  { title: "브랜드 무드 필름",   artist: "최서진", metric: "완주율 68%",  tone: "조용히 보내드리는 한 컷.",                       image: "./assets/characters/choi-seojin/cover.png"}
];

/* ── 비즈니스 패키지 ─────────────────────────── */
const businessPackages = [
  { name: "숏폼 캠페인", target: "뷰티 / 패션 / 커머스", summary: "메인 아티스트 중심의 숏폼 광고와 SNS 노출용 콘텐츠 협업입니다.", deliverables: ["숏폼 3종", "썸네일 3종", "브랜드 컷 1세트"] },
  { name: "프리미엄 에디토리얼", target: "주얼리 / 럭셔리 / 에디토리얼", summary: "프리미엄 라인 중심의 화보형 콘텐츠와 브랜드 무드 연출입니다.", deliverables: ["에디토리얼 컷", "브랜드 티저", "룩북형 이미지"] },
  { name: "캐릭터 브랜딩", target: "브랜드 콜라보 / IP 협업", summary: "캐릭터 설정과 세계관, 반복 노출 구조까지 함께 설계하는 장기 협업입니다.", deliverables: ["캐릭터 협업안", "콘텐츠 콘셉트", "운영 제안"] }
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

/* ── API 어댑터 ─────────────────────────────────
   백엔드 응답 → 프론트 구조로 변환
   실제 API 필드명 확정 후 Codex와 맞춤
   ─────────────────────────────────────────── */
function adaptArtist(api) {
  const local = characters.find(c => c.slug === api.slug) || {};
  return {
    ...local,
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
      cover: api.coverImage  || api.cover_image  || local.images?.cover,
      thumb: api.thumbImage  || api.thumb_image  || local.images?.thumb
    },
    gallery:           local.gallery || [],
    profile:           api.profile || local.profile || {},
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
    image:  api.thumbnailUrl || api.thumbnail_url || local.image
  };
}

/* ── 렌더링: 메인 아티스트 (mainArtists 배열 제거됨) */
function renderMainArtists() {
  const root = document.getElementById("mainArtistGrid");
  if (!root) return;

  const list = _artists.filter(a =>
    (a.tier === "main" || a.tier === "premium") && a.status === "public"
  );

  root.innerHTML = list.map(a => `
    <article class="artist-card clickable-card" data-href="./character-detail.html?slug=${a.slug}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      <div class="artist-media artist-media-${a.slug}">
        <img class="artist-media-image artist-media-image-${a.slug}"
          src="${a.images.thumb || a.images.cover}" alt="${a.publicName}"
          onerror="this.style.display='none'" />
        ${likeButtonHTML(a.slug)}
        <div class="artist-media-copy">
          <span class="artist-role">${a.role}</span>
          <strong>${a.name}</strong>
        </div>
      </div>
      <div class="artist-body">
        <p>${a.artistDescription}</p>
        <div class="tag-list">${a.tags.map(t => `<span>${t}</span>`).join("")}</div>
        <a class="text-link" href="./character-detail.html?slug=${a.slug}">상세 보기</a>
      </div>
    </article>
  `).join("");
}

/* ── 렌더링: 데뷔 예정 라인 (6캐릭 서브) ─────── */
function renderDebutLine() {
  const root = document.getElementById("debutLineGrid");
  if (!root) return;

  const list = _artists.filter(a => a.tier === "sub" && a.status === "public");
  if (!list.length) { root.closest("section")?.setAttribute("hidden", ""); return; }

  root.innerHTML = list.map(a => {
    const isMale = a.gender === "male";
    // 무대 스포트라이트 배경: 여성=보라, 남성=남색
    const silhouetteClass = isMale ? "silhouette-male" : "silhouette-female";

    return `
    <article class="debut-card clickable-card" data-href="./character-detail.html?slug=${a.slug}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      <div class="debut-card-media ${silhouetteClass}">
        <div class="debut-silhouette">
          <span>COMING<br>SOON</span>
          <small>곧 무대에 오릅니다</small>
        </div>
        <div class="debut-gender-badge">${isMale ? "♂" : "♀"}</div>
      </div>
      <div class="debut-card-body">
        <span class="debut-card-type eyebrow">${a.type}</span>
        <strong>${a.publicName}</strong>
        <p>${a.summary}</p>
        <a class="text-link" href="./character-detail.html?slug=${a.slug}">프로필 보기</a>
      </div>
    </article>`;
  }).join("");
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
          <p>${item.tone}</p>
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
          <p>${item.tone}</p>
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
        <p>${a.summary}</p>
        <a class="text-link ${a.status === "secret" ? "is-dimmed" : ""}" href="./character-detail.html?slug=${a.slug}">프로필 보기</a>
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

function renderCharacterCatalog(filter = "all", tagFilter = "") {
  const root = document.getElementById("characterCatalog");
  if (!root) return;

  const tierLabel = { main: "메인", premium: "프리미엄", sub: "서브", experiment: "실험" };

  let list = filter === "all" ? _artists : _artists.filter(a => a.type === filter || a.tier === filter);
  if (tagFilter) list = list.filter(a => a.tags.includes(tagFilter));

  root.innerHTML = list.map(a => `
    <article class="catalog-card ${statusMeta[a.status].className} clickable-card"
      data-href="./character-detail.html?slug=${a.slug}"
      data-secret="${a.status === "secret"}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      ${renderCatalogMedia(a)}
      <div class="catalog-body">
        <h3 class="catalog-name">${a.publicName}</h3>
        <div class="catalog-meta">
          <span>${statusMeta[a.status].label}</span>
          <span>${tierLabel[a.tier] || a.tier}</span>
        </div>
        <p class="catalog-summary">${a.summary}</p>
        <dl class="catalog-details">
          <div><dt>팬 포인트</dt><dd>${a.fandom}</dd></div>
          <div><dt>광고 적합</dt><dd>${a.business}</dd></div>
        </dl>
        <div class="tag-list">${a.tags.map(t => `<span>${t}</span>`).join("")}</div>
        <a class="text-link ${a.status === "secret" ? "is-dimmed" : ""}" href="./character-detail.html?slug=${a.slug}">상세 페이지</a>
      </div>
    </article>`).join("");

  const note = document.getElementById("activeFilterNote");
  if (note) note.innerHTML = tagFilter
    ? `<span>현재 태그 필터: <strong>${tagFilter}</strong></span><a href="./characters.html" class="text-link">필터 해제</a>`
    : "";
}

function bindCharacterFilters() {
  const filterRoot = document.getElementById("characterFilters");
  if (!filterRoot) return;
  const btns = [...filterRoot.querySelectorAll("[data-filter]")];
  const activeTag = new URLSearchParams(window.location.search).get("tag") || "";
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderCharacterCatalog(btn.dataset.filter, activeTag);
    });
  });
  if (activeTag) renderCharacterCatalog("all", activeTag);
}

/* ── 렌더링: 캐릭터 상세 ─────────────────────── */
function renderCharacterDetail() {
  const hero = document.getElementById("detailHero");
  if (!hero) return;

  const slug   = new URLSearchParams(window.location.search).get("slug");
  const artist = getCharacterBySlug(slug) || _artists[0];
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
      <span class="detail-tier-tag">${tierLabel[artist.tier] || artist.tier}</span>`;
  }

  const gallery = document.getElementById("detailGallery");
  if (gallery) {
    const galleryItems = artist.gallery?.length
      ? artist.gallery
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
    cta.innerHTML = artist.status === "secret"
      ? `<div class="detail-cta-card is-secret"><strong>공개 전 시크릿 라인입니다</strong><p>숏폼 반응 전략에 따라 공개 순서를 조정합니다.</p></div>`
      : `<div class="detail-cta-card">
           <div class="detail-cta-info">
             <strong>${artist.publicName}을 응원하세요</strong>
             <p>후원은 캐릭터 외형 업그레이드, 신규 콘텐츠 해금, 팬 전용 이벤트로 이어집니다.</p>
           </div>
           <div class="detail-cta-actions">
             <button class="cta-btn cta-btn-support" disabled>
               <span class="cta-btn-icon">💜</span>
               <span class="cta-btn-label"><strong>후원하기</strong><small>준비 중</small></span>
             </button>
             <button class="cta-btn cta-btn-chat" disabled>
               <span class="cta-btn-icon">💬</span>
               <span class="cta-btn-label"><strong>캐릭터챗</strong><small>준비 중</small></span>
             </button>
           </div>
         </div>`;
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
  const cards = [...document.querySelectorAll(".clickable-card")];
  cards.forEach(card => {
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    const go = () => {
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
    };
    card.addEventListener("click", e => { if (e.target.closest("a, button")) return; go(); });
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
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
      img.loading = "lazy";
      img.style.cssText = "width:100%;height:100%;object-fit:cover;object-position:center top;display:block;transition:transform 260ms ease;";
      img.onerror = () => { cell.style.display = "none"; };
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
    lb.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function close() {
    lb.classList.remove("is-open");
    document.body.style.overflow = "";
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

async function init() {
  // 🔥 인증 UI는 API 호출 전에 먼저 초기화 (await에 막히지 않게)
  createAuthModal();
  bindAuthHeaderEvents();
  updateAuthUI();

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
        _artists = adapted;
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

  // 부스트 상태는 백그라운드 로드 — 렌더링 안 막음 (캠페인 미등록 / 백엔드 늦음 대응)
  loadBoostState().then(() => {
    // 데이터 도착하면 좋아요 버튼들 갱신
    document.querySelectorAll(".like-btn[data-like-slug]").forEach(btn => {
      const slug = btn.dataset.likeSlug;
      const countEl = btn.querySelector(".like-count");
      if (countEl) countEl.textContent = formatLikeCount(getLikesCount(slug));
    });
  }).catch(err => {
    console.warn("[Lumina] 부스트 상태 로드 실패 (정상 진행):", err);
  });

  renderMainArtists();
  renderDebutLine();
  renderShortforms();
  renderShortformHub();
  renderBusinessPackages();
  renderRoster();
  renderCharacterCatalog();
  bindCharacterFilters();
  renderCharacterDetail();
  bindCardNavigation();
  bindLikeButtons();
  initScrollReveal();
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