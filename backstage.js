const BACKSTAGE_API_BASE = window.LUMINA_API_BASE || "https://api.lumina-stage.com";
const BACKSTAGE_AUTH_KEY = "lumina_backstage_auth";

const loginView = document.getElementById("backstageLoginView");
const dashboardView = document.getElementById("backstageDashboardView");
const loginForm = document.getElementById("backstageLoginForm");
const emailInput = document.getElementById("backstageEmail");
const passwordInput = document.getElementById("backstagePassword");
const loginButton = document.getElementById("backstageLoginButton");
const loginStatus = document.getElementById("backstageLoginStatus");
const operatorEmail = document.getElementById("backstageOperatorEmail");
const logoutButton = document.getElementById("backstageLogoutButton");

function getBackstageAuth() {
  try {
    const raw = localStorage.getItem(BACKSTAGE_AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setBackstageAuth(auth) {
  if (!auth) localStorage.removeItem(BACKSTAGE_AUTH_KEY);
  else localStorage.setItem(BACKSTAGE_AUTH_KEY, JSON.stringify(auth));
}

function setStatus(message, type = "info") {
  loginStatus.textContent = message || "";
  loginStatus.classList.toggle("is-error", type === "error");
  loginStatus.classList.toggle("is-success", type === "success");
}

function setLoading(isLoading) {
  loginButton.disabled = isLoading;
  loginButton.textContent = isLoading ? "확인 중..." : "백스테이지 입장";
}

async function backstageFetch(path, options = {}) {
  const auth = getBackstageAuth();
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.auth && auth?.accessToken) {
    headers.Authorization = `Bearer ${auth.accessToken}`;
  }

  const response = await fetch(BACKSTAGE_API_BASE + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error?.message || `요청 실패 (${response.status})`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

function extractAuthPayload(data) {
  return {
    accessToken: data?.accessToken || data?.tokens?.accessToken || data?.access_token,
    refreshToken: data?.refreshToken || data?.tokens?.refreshToken || data?.refresh_token,
    user: data?.user || null
  };
}

async function verifyAdminAccess() {
  await backstageFetch("/admin/api/v1/audit-events?take=1", { auth: true });
}

function showLogin() {
  dashboardView.classList.add("is-hidden");
  loginView.classList.remove("is-hidden");
}

function showDashboard() {
  const auth = getBackstageAuth();
  operatorEmail.textContent = auth?.user?.email || emailInput.value || "운영자";
  loginView.classList.add("is-hidden");
  dashboardView.classList.remove("is-hidden");
}

async function handleLogin(event) {
  event.preventDefault();
  setLoading(true);
  setStatus("운영자 권한을 확인하고 있어요.");

  try {
    const data = await backstageFetch("/api/v1/auth/login", {
      method: "POST",
      body: {
        email: emailInput.value.trim(),
        password: passwordInput.value
      }
    });
    const auth = extractAuthPayload(data);
    if (!auth.accessToken) throw new Error("로그인 응답에서 토큰을 찾지 못했어요.");
    setBackstageAuth(auth);

    await verifyAdminAccess();
    setStatus("백스테이지 입장 권한이 확인됐어요.", "success");
    showDashboard();
  } catch (error) {
    setBackstageAuth(null);
    const message = error.status === 401
      ? "이메일 또는 비밀번호를 확인해 주세요."
      : error.status === 403
        ? "관리자 권한이 없는 계정이에요."
        : "로그인 확인에 실패했어요. 잠시 후 다시 시도해 주세요.";
    setStatus(message, "error");
  } finally {
    setLoading(false);
  }
}

async function bootstrapBackstage() {
  const auth = getBackstageAuth();
  if (!auth?.accessToken) {
    showLogin();
    return;
  }

  setStatus("저장된 세션을 확인하고 있어요.");
  try {
    await verifyAdminAccess();
    showDashboard();
  } catch {
    setBackstageAuth(null);
    setStatus("운영자 세션이 만료됐어요. 다시 로그인해 주세요.", "error");
    showLogin();
  }
}

loginForm.addEventListener("submit", handleLogin);
logoutButton.addEventListener("click", () => {
  setBackstageAuth(null);
  passwordInput.value = "";
  setStatus("로그아웃했어요.");
  showLogin();
});

bootstrapBackstage();
