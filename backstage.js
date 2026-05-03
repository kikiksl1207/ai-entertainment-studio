const BACKSTAGE_API_BASE = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
const BACKSTAGE_BASE_HAS_API_PREFIX = /\/api\/v1$/.test(BACKSTAGE_API_BASE);
const BACKSTAGE_AUTH_KEY = "lumina_backstage_auth";

const loginView = document.getElementById("backstageLoginView");
const dashboardView = document.getElementById("backstageDashboardView");
const loginForm = document.getElementById("backstageLoginForm");
const emailInput = document.getElementById("backstageEmail");
const passwordInput = document.getElementById("backstagePassword");
const loginButton = document.getElementById("backstageLoginButton");
const googleButton = document.getElementById("backstageGoogleButton");
const loginStatus = document.getElementById("backstageLoginStatus");
const operatorEmail = document.getElementById("backstageOperatorEmail");
const logoutButton = document.getElementById("backstageLogoutButton");
const refreshButton = document.getElementById("backstageRefreshButton");
const todayLabel = document.getElementById("backstageToday");
const metricGrid = document.getElementById("backstageMetricGrid");
const alertStrip = document.getElementById("backstageAlertStrip");
const detailPanel = document.getElementById("backstageDetailPanel");
const detailType = document.getElementById("detailType");
const detailTitle = document.getElementById("detailTitle");
const detailList = document.getElementById("detailList");
const detailMemo = document.getElementById("detailMemo");
const detailCloseButton = document.getElementById("detailCloseButton");
const confirmModal = document.getElementById("backstageConfirmModal");
const confirmType = document.getElementById("confirmType");
const confirmTitle = document.getElementById("confirmTitle");
const confirmMessage = document.getElementById("confirmMessage");
const confirmPayload = document.getElementById("confirmPayload");
const confirmCancelButton = document.getElementById("confirmCancelButton");
const confirmRunButton = document.getElementById("confirmRunButton");

let selectedDetail = null;
const sectionState = {
  users: { cursor: null, hasMore: false, rows: [] },
  settlement: { cursor: null, hasMore: false, rows: [] },
  logs: { cursor: null, hasMore: false, rows: [] }
};
const GOOGLE_CLIENT_ID = "213795475154-votjkhv4cvgg49cvajast3clenhoj5db.apps.googleusercontent.com";
let googleSdkPromise = null;
let googleTokenClient = null;

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

const tableMeta = {
  overviewQueueRows: { type: "대시보드", labels: ["ID", "유형", "대상", "상태", "권장 액션"] },
  riskRows: { type: "위험 항목", labels: ["ID", "분류", "사유", "위험도", "권장 액션"] },
  userRows: { type: "유저 관리", labels: ["유저", "이메일", "상태", "루미나", "최근 접속", "권장 액션"] },
  creatorRows: { type: "크리에이터", labels: ["신청자", "유형", "상태", "모니터링", "접수일", "권장 액션"] },
  moderationRows: { type: "콘텐츠 검수", labels: ["콘텐츠", "작성자", "탐지 유형", "상태", "권장 액션"] },
  settlementRows: { type: "정산 관리", labels: ["대상", "정산 이벤트", "예정액", "보류금", "상태", "권장 액션"] },
  logRows: { type: "운영 로그", labels: ["시간", "관리자", "액션", "대상", "메모"] }
};

const sectionLoaders = {
  users: loadUsersSection,
  creators: loadCreatorsSection,
  moderation: loadModerationSection,
  settlement: loadSettlementSection,
  logs: loadAuditSection
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
  googleButton.disabled = isLoading;
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

function loadGoogleSDK() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (googleSdkPromise) return googleSdkPromise;

  googleSdkPromise = new Promise((resolve, reject) => {
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
    script.onerror = () => reject(new Error("Google SDK 로드 실패"));
    document.head.appendChild(script);
  });
  return googleSdkPromise;
}

function initGoogleAuth() {
  if (googleTokenClient) return true;
  if (!window.google?.accounts?.oauth2) return false;

  googleTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: "openid email profile",
    callback: handleGoogleTokenResponse,
    error_callback: (error) => {
      if (error?.type === "popup_closed" || error?.type === "popup_failed_to_open") return;
      setStatus("Google 로그인 창을 열지 못했어요. 잠시 후 다시 시도해 주세요.", "error");
    }
  });
  return true;
}

async function handleGoogleTokenResponse(tokenResponse) {
  if (!tokenResponse?.access_token) {
    setStatus("Google access token을 받지 못했어요.", "error");
    setLoading(false);
    return;
  }

  try {
    const data = await backstageFetch(publicApiPath("/auth/social/login"), {
      method: "POST",
      body: {
        provider: "google",
        token: tokenResponse.access_token
      }
    });
    const auth = extractAuthPayload(data);
    if (!auth.accessToken) throw new Error("Google 로그인 응답에서 토큰을 찾지 못했어요.");
    setBackstageAuth(auth);
    await verifyAdminAccess();
    setStatus("Google 운영자 권한이 확인됐어요.", "success");
    showDashboard();
  } catch (error) {
    setBackstageAuth(null);
    const message = error.status === 403
      ? "Google 계정은 로그인됐지만 관리자 권한이 아직 없어요."
      : "Google 운영자 로그인에 실패했어요. 권한 부여 상태를 확인해 주세요.";
    setStatus(message, "error");
  } finally {
    setLoading(false);
  }
}

async function handleGoogleLogin() {
  setLoading(true);
  setStatus("Google 로그인 창을 준비하고 있어요.");
  try {
    await loadGoogleSDK();
    if (!initGoogleAuth()) throw new Error("Google SDK 초기화 실패");
    googleTokenClient.requestAccessToken();
  } catch {
    setLoading(false);
    setStatus("Google 로그인 준비에 실패했어요. 브라우저 팝업 차단 여부를 확인해 주세요.", "error");
  }
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
  const meta = tableMeta[targetId] || { type: "상세", labels: [] };
  target.innerHTML = rows.map((row) => {
    const cells = row.map((cell, index) => {
      const content = index === statusIndex ? statusBadge(cell) : cell;
      if (index === row.length - 1) {
        const payload = encodeURIComponent(JSON.stringify({ tableId: targetId, type: meta.type, labels: meta.labels, row }));
        return `<td><button class="row-action" type="button" data-detail="${payload}">${content}</button></td>`;
      }
      return `<td>${content}</td>`;
    }).join("");
    return `<tr data-table-id="${targetId}">${cells}</tr>`;
  }).join("");
}

function normalizePage(data) {
  if (Array.isArray(data)) return { items: data, hasMore: false, nextCursor: null };
  return {
    items: data?.items || [],
    hasMore: Boolean(data?.hasMore),
    nextCursor: data?.nextCursor || null
  };
}

function setLoadMore(sectionId, hasMore) {
  const button = document.querySelector(`[data-load-more="${sectionId}"]`);
  if (!button) return;
  button.classList.toggle("is-hidden", !hasMore);
  button.disabled = false;
}

function renderLoadingRow(targetId, label = "데이터를 불러오는 중입니다.") {
  const target = document.getElementById(targetId);
  if (!target) return;
  const colSpan = tableMeta[targetId]?.labels?.length || 5;
  target.innerHTML = `<tr><td colspan="${colSpan}">${label}</td></tr>`;
}

function renderFallbackNote(targetId, label = "API 응답을 불러오지 못해 샘플 데이터를 유지합니다.") {
  console.warn(`Backstage ${targetId}: ${label}`);
}

function renderDetailPanel(detail) {
  if (!detailPanel || !detail) return;
  selectedDetail = detail;
  detailType.textContent = detail.type || "Detail";
  detailTitle.textContent = detail.row?.[2] || detail.row?.[0] || "상세 정보";
  detailList.innerHTML = detail.row.map((value, index) => {
    const label = detail.labels?.[index] || `항목 ${index + 1}`;
    return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  }).join("");
  detailMemo.value = "";
  updateDetailActions(detail);
}

function updateDetailActions(detail) {
  const dangerButton = document.querySelector('[data-detail-action="danger"]');
  const holdButton = document.querySelector('[data-detail-action="hold"]');
  if (!dangerButton || !holdButton) return;

  const tableId = detail.tableId;
  const status = detail.row?.[detail.labels?.findIndex((label) => label === "상태")] || "";
  const actionLabel = detail.row?.[detail.row.length - 1] || "위험 액션";

  holdButton.textContent = tableId === "creatorRows" ? "보류/보완 요청" : "보류";
  holdButton.disabled = tableId === "logRows";
  dangerButton.textContent = actionLabel === "복구" || status === "숨김" || status === "정지" ? "복구 실행" : actionLabel;
  dangerButton.disabled = tableId === "logRows" || tableId === "settlementRows" && !["환불 검토", "확인"].includes(actionLabel);
}

function selectDetailButton(button) {
  if (!button?.dataset?.detail) return;
  document.querySelectorAll("tr.is-selected").forEach((row) => row.classList.remove("is-selected"));
  button.closest("tr")?.classList.add("is-selected");
  try {
    renderDetailPanel(JSON.parse(decodeURIComponent(button.dataset.detail)));
  } catch {
    renderDetailPanel({ type: "Detail", labels: ["상태"], row: ["상세 정보를 불러오지 못했습니다."] });
  }
}

function buildActionPreview(action) {
  const detail = selectedDetail;
  if (!detail) return null;
  const memo = detailMemo.value.trim();
  const row = detail.row || [];
  const target = row[0] || "-";
  const currentAction = row[row.length - 1] || action;

  const base = {
    menu: detail.type,
    target,
    requestedAction: action === "danger" ? currentAction : action,
    note: memo || "운영 메모 미입력"
  };

  if (detail.tableId === "userRows") {
    base.apiHint = currentAction.includes("복구")
      ? "POST /admin/api/v1/users/:userId/restore"
      : currentAction.includes("세션")
        ? "POST /admin/api/v1/users/:userId/revoke-sessions"
        : "POST /admin/api/v1/users/:userId/suspend";
    base.warning = currentAction.includes("세션")
      ? "계정 상태는 유지하고 활성 refresh session만 revoke합니다. audit log 기록 대상입니다."
      : "정지/삭제 계열 액션은 세션 revoke와 audit log 기록 대상입니다.";
  } else if (detail.tableId === "creatorRows") {
    base.apiHint = "PATCH /admin/api/v1/debut/applications/:applicationId";
    base.warning = "7일 모니터링 전용 API는 아직 준비중입니다. 데뷔 신청 상태 변경 중심으로 처리합니다.";
  } else if (detail.tableId === "moderationRows" || detail.tableId === "riskRows") {
    base.apiHint = currentAction.includes("복구") ? "POST /admin/api/v1/community/posts/:postId/restore" : "POST /admin/api/v1/community/posts/:postId/hide";
    base.warning = "숨김/복구는 audit log 기록 대상입니다. 사유 입력 후 실행해야 합니다.";
  } else if (detail.tableId === "settlementRows") {
    base.apiHint = "POST /admin/api/v1/payment-orders/:orderId/refunds 또는 PATCH /admin/api/v1/refund-transactions/:refundId";
    base.warning = "크리에이터 정산 지급 API는 아직 준비중입니다. 현재는 결제/환불 운영만 연결 대상입니다.";
  } else {
    base.apiHint = "읽기 전용 또는 준비중";
    base.warning = "이 항목은 현재 실행 API 연결 대상이 아닙니다.";
  }
  return base;
}

function openConfirmModal(action) {
  const preview = buildActionPreview(action);
  if (!preview || !confirmModal) return;
  confirmType.textContent = preview.menu || "Confirm";
  confirmTitle.textContent = action === "memo" ? "운영 메모 저장 확인" : action === "hold" ? "보류 처리 확인" : "위험 액션 확인";
  confirmMessage.textContent = preview.warning;
  confirmPayload.textContent = JSON.stringify(preview, null, 2);
  confirmRunButton.textContent = "API 연결 전 구조 확인";
  confirmRunButton.disabled = true;
  confirmModal.classList.remove("is-hidden");
}

function closeConfirmModal() {
  confirmModal?.classList.add("is-hidden");
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

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

function krw(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? `${number.toLocaleString("ko-KR")}원` : String(value || "-");
}

async function loadUsersSection() {
  sectionState.users = { cursor: null, hasMore: false, rows: [] };
  renderLoadingRow("userRows");
  await loadUsersPage(false);
}

async function loadUsersPage(append = true) {
  const state = sectionState.users;
  const query = new URLSearchParams({ take: "20" });
  if (append && state.cursor) query.set("cursor", state.cursor);
  try {
    const page = normalizePage(await backstageFetch(adminApiPath(`/users?${query}`), { auth: true }));
    const rows = page.items.map((user) => [
      user.displayName || user.nickname || user.id?.slice?.(0, 8) || "-",
      user.email || "-",
      user.status || "-",
      formatCount(user.wallet?.balanceLumina || user.walletBalanceLumina || 0) + "L",
      formatDate(user.lastLoginAt || user.updatedAt || user.createdAt),
      user.status === "suspended" ? "복구 요청" : "세션 종료"
    ]);
    state.rows = append ? state.rows.concat(rows) : rows;
    state.cursor = page.nextCursor;
    state.hasMore = page.hasMore;
    setLoadMore("users", page.hasMore);
    if (state.rows.length) renderRows("userRows", state.rows, 2);
    else renderLoadingRow("userRows", "표시할 유저가 없습니다.");
  } catch {
    renderBackstageTables();
    setLoadMore("users", false);
    renderFallbackNote("userRows");
  }
}

async function loadCreatorsSection() {
  renderLoadingRow("creatorRows");
  try {
    const applications = await backstageFetch(adminApiPath("/debut/applications?take=20"), { auth: true });
    const rows = (Array.isArray(applications) ? applications : applications?.items || []).map((item) => [
      item.displayName || item.applicantName || item.contactEmail || item.id?.slice?.(0, 8) || "-",
      item.participationType || item.applicationType || "-",
      item.status || "-",
      item.monitoringStatus || "확인 필요",
      formatDate(item.createdAt),
      item.status === "approved" ? "권한 보기" : "보기"
    ]);
    if (rows.length) renderRows("creatorRows", rows, 2);
    else renderLoadingRow("creatorRows", "표시할 신청 내역이 없습니다.");
  } catch {
    renderBackstageTables();
    renderFallbackNote("creatorRows");
  }
}

async function loadModerationSection() {
  renderLoadingRow("moderationRows");
  try {
    const posts = await backstageFetch(adminApiPath("/community/posts?status=published&minReports=1&sort=reports&take=20"), { auth: true });
    const rows = (Array.isArray(posts) ? posts : posts?.items || posts?.posts || []).map((post) => [
      post.id?.slice?.(0, 8) || "-",
      post.authorUser?.email || post.artist?.name || post.artist?.displayName || "-",
      `신고 ${formatCount(post.reportCount)}건`,
      post.status || "-",
      post.status === "hidden" ? "복구" : "숨김"
    ]);
    if (rows.length) renderRows("moderationRows", rows, 3);
    else renderLoadingRow("moderationRows", "검수 대기 콘텐츠가 없습니다.");
  } catch {
    renderBackstageTables();
    renderFallbackNote("moderationRows");
  }
}

async function loadSettlementSection() {
  sectionState.settlement = { cursor: null, hasMore: false, rows: [] };
  renderLoadingRow("settlementRows");
  await loadSettlementPage(false);
}

async function loadSettlementPage(append = true) {
  const state = sectionState.settlement;
  const query = new URLSearchParams({ take: "20" });
  if (append && state.cursor) query.set("cursor", state.cursor);
  try {
    const page = normalizePage(await backstageFetch(adminApiPath(`/payment-orders?${query}`), { auth: true }));
    const rows = page.items.map((order) => [
      order.user?.email || order.userId?.slice?.(0, 8) || "-",
      order.orderNo || order.id?.slice?.(0, 8) || "-",
      krw(order.amount),
      krw(order.refundedAmount || 0),
      order.status || "-",
      order.status === "paid" ? "환불 검토" : "확인"
    ]);
    state.rows = append ? state.rows.concat(rows) : rows;
    state.cursor = page.nextCursor;
    state.hasMore = page.hasMore;
    setLoadMore("settlement", page.hasMore);
    if (state.rows.length) renderRows("settlementRows", state.rows, 4);
    else renderLoadingRow("settlementRows", "표시할 결제/정산 항목이 없습니다.");
  } catch {
    renderBackstageTables();
    setLoadMore("settlement", false);
    renderFallbackNote("settlementRows");
  }
}

async function loadAuditSection() {
  sectionState.logs = { cursor: null, hasMore: false, rows: [] };
  renderLoadingRow("logRows");
  await loadAuditPage(false);
}

async function loadAuditPage(append = true) {
  const state = sectionState.logs;
  const query = new URLSearchParams({ take: "20" });
  if (append && state.cursor) query.set("cursor", state.cursor);
  try {
    const page = normalizePage(await backstageFetch(adminApiPath(`/audit-events?${query}`), { auth: true }));
    const rows = page.items.map((item) => [
      new Date(item.createdAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
      item.actorUser?.email || item.actorUserId?.slice?.(0, 8) || "system",
      item.action || "-",
      item.targetType || "-",
      item.reason || item.metadata?.reason || item.targetId?.slice?.(0, 8) || "-"
    ]);
    state.rows = append ? state.rows.concat(rows) : rows;
    state.cursor = page.nextCursor;
    state.hasMore = page.hasMore;
    setLoadMore("logs", page.hasMore);
    if (state.rows.length) renderRows("logRows", state.rows, -1);
    else renderLoadingRow("logRows", "표시할 운영 로그가 없습니다.");
  } catch {
    renderBackstageTables();
    setLoadMore("logs", false);
    renderFallbackNote("logRows");
  }
}

function loadSection(sectionId) {
  if (sectionId === "overview") {
    renderBackstageTables();
    loadBackstageSummary();
    return;
  }
  sectionLoaders[sectionId]?.();
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
    loadSection(link.getAttribute("href")?.replace("#", ""));
  });
});

document.addEventListener("click", (event) => {
  const detailButton = event.target.closest("[data-detail]");
  if (detailButton) selectDetailButton(detailButton);
});

detailCloseButton.addEventListener("click", () => {
  document.querySelectorAll("tr.is-selected").forEach((row) => row.classList.remove("is-selected"));
  renderDetailPanel({
    type: "Detail",
    labels: ["상태"],
    row: ["테이블의 행을 선택하면 상세 정보와 처리 버튼이 표시됩니다."]
  });
});

document.querySelectorAll("[data-detail-action]").forEach((button) => {
  button.addEventListener("click", () => openConfirmModal(button.dataset.detailAction));
});

confirmCancelButton.addEventListener("click", closeConfirmModal);
confirmModal.addEventListener("click", (event) => {
  if (event.target === confirmModal) closeConfirmModal();
});

document.querySelectorAll("[data-load-more]").forEach((button) => {
  button.addEventListener("click", async () => {
    const sectionId = button.dataset.loadMore;
    button.disabled = true;
    if (sectionId === "users") await loadUsersPage(true);
    if (sectionId === "settlement") await loadSettlementPage(true);
    if (sectionId === "logs") await loadAuditPage(true);
  });
});

loginForm.addEventListener("submit", handleLogin);
googleButton.addEventListener("click", handleGoogleLogin);
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


