const BACKSTAGE_API_BASE = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
const BACKSTAGE_BASE_HAS_API_PREFIX = /\/api\/v1$/.test(BACKSTAGE_API_BASE);
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
const refreshButton = document.getElementById("backstageRefreshButton");
const todayLabel = document.getElementById("backstageToday");
const metricGrid = document.getElementById("backstageMetricGrid");
const alertStrip = document.getElementById("backstageAlertStrip");

const statusClassMap = {
  "접수": "is-pending",
  "대기": "is-pending",
  "검수중": "is-review",
  "승인": "is-approved",
  "보류": "is-hold",
  "숨김": "is-blocked",
  "정지": "is-blocked",
  "지급대기": "is-hold",
  "지급완료": "is-paid"
};

const backstageRows = {
  overviewQueue: [
    ["DQ-1042", "데뷔 신청", "신규 크리에이터", "접수", "보기"],
    ["MD-3381", "콘텐츠 신고", "피드 댓글", "검수중", "숨김"],
    ["PY-2204", "충전 주문", "루미나 5,500L", "대기", "확인"],
    ["ST-0911", "정산", "팬레터 매출", "지급대기", "지급 완료"]
  ],
  risk: [
    ["RK-221", "외부 연락", "오픈채팅 유도 의심", "높음", "차단"],
    ["RK-219", "신고 누적", "댓글 신고 3회", "중간", "검수"],
    ["RK-208", "정산 보류", "본인인증 필요", "중간", "보류"]
  ],
  users: [
    ["a01057662701", "a01057662701@gmail.com", "active", "300L", "오늘", "상세"],
    ["serinist_01", "user01@example.com", "active", "1,240L", "어제", "세션 종료"],
    ["watch_user", "watch@example.com", "suspended", "0L", "3일 전", "복구 요청"]
  ],
  creators: [
    ["하윤아", "모델", "접수", "7일 모니터링", "2026-05-03", "승인"],
    ["권태준", "배우", "보류", "자료 보완", "2026-05-03", "보류"],
    ["차도현", "아티스트", "승인", "normal", "2026-05-02", "권한 보기"]
  ],
  moderation: [
    ["피드 #882", "artist_yuna", "외부 연락 패턴", "검수중", "숨김"],
    ["댓글 #1204", "user_102", "공격적 표현", "보류", "수정 요청"],
    ["공지 #77", "creator_09", "정상", "승인", "복구"]
  ],
  settlement: [
    ["creator_cha", "유료 응원 42건", "28,400원", "3,000원", "지급대기", "지급 완료"],
    ["creator_yoon", "팬레터 8건", "16,000원", "2,000원", "지급대기", "지급 완료"],
    ["creator_park", "프리미엄 챗 11건", "9,300원", "0원", "지급완료", "영수증"]
  ],
  logs: [
    ["10:12", "operator", "콘텐츠 숨김", "피드 #882", "외부 연락 유도"],
    ["09:40", "operator", "신청 보류", "권태준", "이미지팩 최종 확인 전"],
    ["09:12", "system", "로그인 성공", "Backstage", "관리자 세션 확인"]
  ]
};

const kpiLabelMap = {
  today_users: "오늘 가입자",
  today_payment_orders: "충전 주문",
  moderation_queue: "신고/검수 대기",
  debut_queue: "데뷔 신청"
};

const alertTitleMap = {
  moderation_queue: "콘텐츠 검수 대기",
  debut_queue: "데뷔 신청 검토",
  payment_pending: "결제 확인 대기"
};

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
  loginButton.textContent = isLoading ? "권한 확인 중..." : "백스테이지 입장";
}

async function backstageFetch(path, options = {}) {
  const auth = getBackstageAuth();
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.auth && auth?.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;

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

function publicApiPath(path) {
  return BACKSTAGE_BASE_HAS_API_PREFIX ? path : `/api/v1${path}`;
}

function adminApiPath(path) {
  return BACKSTAGE_BASE_HAS_API_PREFIX ? `/admin/api/v1${path}` : `/api/v1/admin/api/v1${path}`;
}
async function verifyAdminAccess() {
  await backstageFetch(adminApiPath("/audit-events?take=1"), { auth: true });
}

function statusBadge(value) {
  const label = value === "active" ? "승인" : value === "suspended" ? "정지" : value;
  const className = statusClassMap[label] || "is-review";
  return `<span class="status-badge ${className}">${label}</span>`;
}

function renderRows(targetId, rows, statusIndex) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = rows.map((row) => {
    const cells = row.map((cell, index) => {
      const content = index === statusIndex ? statusBadge(cell) : cell;
      if (index === row.length - 1) return `<td><button class="row-action" type="button">${content}</button></td>`;
      return `<td>${content}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
}

function renderBackstageTables() {
  renderRows("overviewQueueRows", backstageRows.overviewQueue, 3);
  renderRows("riskRows", backstageRows.risk, 3);
  renderRows("userRows", backstageRows.users, 2);
  renderRows("creatorRows", backstageRows.creators, 2);
  renderRows("moderationRows", backstageRows.moderation, 3);
  renderRows("settlementRows", backstageRows.settlement, 4);
  renderRows("logRows", backstageRows.logs, -1);
}

function formatCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("ko-KR") : String(value || 0);
}

function renderSummaryKpis(kpis = []) {
  if (!metricGrid || !Array.isArray(kpis) || kpis.length === 0) return;
  metricGrid.innerHTML = kpis.map((item) => {
    const label = kpiLabelMap[item.key] || item.label || "운영 지표";
    const helper = item.key === "today_users"
      ? "오늘 신규 가입"
      : item.key === "today_payment_orders"
        ? "오늘 생성된 주문"
        : item.key === "moderation_queue"
          ? "submitted/reviewing 합산"
          : item.key === "debut_queue"
            ? "submitted/reviewing 합산"
            : item.tone || "운영 확인";
    return `<article><span>${label}</span><strong>${formatCount(item.value)}</strong><small>${helper}</small></article>`;
  }).join("");
}

function renderSummaryAlerts(alerts = []) {
  if (!alertStrip || !Array.isArray(alerts) || alerts.length === 0) return;
  const openAlerts = alerts.filter((item) => Number(item.count || 0) > 0);
  if (openAlerts.length === 0) {
    alertStrip.innerHTML = "<strong>우선 확인</strong><span>현재 즉시 처리해야 할 주요 대기 건은 없습니다.</span>";
    return;
  }
  const text = openAlerts
    .map((item) => `${alertTitleMap[item.key] || item.title || "운영 항목"} ${formatCount(item.count)}건`)
    .join(", ");
  alertStrip.innerHTML = `<strong>우선 확인</strong><span>${text}이 있습니다.</span>`;
}

function renderBackstageSummary(summary) {
  if (!summary) return;
  renderSummaryKpis(summary.kpis);
  renderSummaryAlerts(summary.alerts);

  const debutRows = (summary.tables?.recentDebutApplications || []).map((item) => [
    item.id?.slice?.(0, 8) || "-",
    "데뷔 신청",
    item.displayName || item.applicantName || item.contactEmail || "-",
    item.status || "접수",
    "보기"
  ]);
  const riskRows = (summary.tables?.highRiskPosts || []).map((item) => [
    item.id?.slice?.(0, 8) || "-",
    item.postType || "피드",
    `신고 ${formatCount(item.reportCount)}건`,
    item.status === "hidden" ? "숨김" : "검수중",
    item.status === "hidden" ? "복구" : "숨김"
  ]);
  const logRows = (summary.tables?.recentAuditEvents || []).map((item) => [
    new Date(item.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    item.actorUser?.email || "system",
    item.action || "-",
    item.targetType || "-",
    item.reason || item.metadata?.reason || "-"
  ]);

  if (debutRows.length) renderRows("overviewQueueRows", debutRows, 3);
  if (riskRows.length) renderRows("riskRows", riskRows, 3);
  if (logRows.length) renderRows("logRows", logRows, -1);
}

async function loadBackstageSummary() {
  try {
    const summary = await backstageFetch(adminApiPath("/backstage/summary"), { auth: true });
    renderBackstageSummary(summary);
  } catch (error) {
    console.warn("Backstage summary fallback:", error);
  }
}

function updateTodayLabel() {
  const formatter = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  todayLabel.textContent = formatter.format(new Date());
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
  renderBackstageTables();
  updateTodayLabel();
  loadBackstageSummary();
}

async function handleLogin(event) {
  event.preventDefault();
  setLoading(true);
  setStatus("운영자 권한을 확인하고 있어요.");
  try {
    const data = await backstageFetch(publicApiPath("/auth/login"), { method: "POST", body: { email: emailInput.value.trim(), password: passwordInput.value } });
    const auth = extractAuthPayload(data);
    if (!auth.accessToken) throw new Error("로그인 응답에서 토큰을 찾지 못했어요.");
    setBackstageAuth(auth);
    await verifyAdminAccess();
    setStatus("백스테이지 입장 권한이 확인됐어요.", "success");
    showDashboard();
  } catch (error) {
    setBackstageAuth(null);
    const message = error.status === 401 ? "이메일 또는 비밀번호를 확인해 주세요." : error.status === 403 ? "관리자 권한이 없는 계정이에요." : "로그인 확인에 실패했어요. 잠시 후 다시 시도해 주세요.";
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

document.querySelectorAll(".sidebar-nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".sidebar-nav a").forEach((item) => item.classList.remove("is-active"));
    link.classList.add("is-active");
  });
});

loginForm.addEventListener("submit", handleLogin);
logoutButton.addEventListener("click", () => {
  setBackstageAuth(null);
  passwordInput.value = "";
  setStatus("로그아웃됐어요.");
  showLogin();
});
refreshButton.addEventListener("click", () => {
  renderBackstageTables();
  updateTodayLabel();
  loadBackstageSummary();
});

bootstrapBackstage();


