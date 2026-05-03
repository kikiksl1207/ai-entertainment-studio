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
  "확인중": "is-review",
  "승인": "is-approved",
  "보류": "is-hold",
  "숨김": "is-blocked",
  "정지": "is-blocked",
  "주의": "is-hold",
  "장기미접속": "is-hold",
  "권한제한": "is-hold",
  "철회": "is-hold",
  "지급대기": "is-hold",
  "지급완료": "is-paid",
  "완료": "is-paid",
  "누락": "is-hold",
  "필요": "is-hold",
  "준비중": "is-review"
};

const backstageRows = {
  admins: [
    ["a01057662701@gmail.com", "최상 관리자", "승인", "오늘", "전체 권한", "권한 보기"],
    ["settlement@lumina-stage.com", "회계 관리자", "준비중", "-", "결제/환불/정산", "초대 확인"],
    ["partner@lumina-stage.com", "영업/섭외 관리자", "준비중", "-", "데뷔 신청/연락처", "초대 확인"],
    ["cs@lumina-stage.com", "CS 관리자", "준비중", "-", "유저/신고/제재", "초대 확인"],
    ["artistops@lumina-stage.com", "AI 아티스트 관리자", "준비중", "-", "AI 콘텐츠/슬롯/공식 글", "초대 확인"]
  ],
  adminRequests: [
    ["AUD-001", "운영자 추가", "최상 관리자", "완료", "super_admin 직접 처리", "상세"],
    ["AUD-002", "역할 변경", "회계 관리자", "준비중", "정산계좌 열람 권한", "상세"],
    ["AUD-003", "역할 변경", "AI 아티스트 관리자", "준비중", "AI 콘텐츠 업로드/공식 글 권한", "상세"]
  ],
  overviewQueue: [
    ["DQ-1042", "데뷔 신청", "신규 크리에이터", "접수", "보기"],
    ["MD-3381", "콘텐츠 신고", "피드 댓글", "확인중", "숨김"],
    ["PY-2204", "충전 주문", "루미나 5,500L", "대기", "확인"],
    ["ST-0911", "정산", "팬레터 매출", "지급대기", "지급 완료"]
  ],
  risk: [
    ["RK-221", "외부 연락", "오픈채팅 유도 의심", "높음", "차단"],
    ["RK-219", "신고 누적", "댓글 신고 3회", "중간", "확인"],
    ["RK-208", "정산 보류", "본인인증 필요", "중간", "보류"]
  ],
  users: [
    ["a01057662701", "a01057662701@gmail.com", "2026-05-03", "Google", "300L", "오늘", "상세"],
    ["serinist_01", "user01@example.com", "2026-05-02", "Email", "1,240L", "어제", "세션 종료"],
    ["watch_user", "watch@example.com", "2026-05-01", "Google", "0L", "3일 전", "복구 요청"],
    ["lumi_fan_04", "fan04@example.com", "2026-04-30", "Kakao", "820L", "오늘", "상세"],
    ["stagepick_05", "pick05@example.com", "2026-04-29", "Google", "150L", "2일 전", "상세"],
    ["yuna_viewer", "viewer@example.com", "2026-04-28", "Email", "90L", "5일 전", "상세"],
    ["vote_love", "vote@example.com", "2026-04-27", "Naver", "430L", "오늘", "상세"],
    ["photo_user", "photo@example.com", "2026-04-26", "Google", "12L", "6일 전", "상세"],
    ["chat_fan_09", "chat09@example.com", "2026-04-25", "Kakao", "2,100L", "어제", "상세"],
    ["quiet_user", "quiet@example.com", "2026-04-24", "Email", "0L", "8일 전", "상세"]
  ],
  userRisks: [
    ["watch_user", "외부 결제 유도", "3회", "정지", "세션 종료", "상세"],
    ["fast_like_22", "비정상 좋아요 패턴", "2회", "확인중", "알림 발송", "상세"],
    ["spam_reply", "반복 댓글", "5회", "주의", "댓글 제한", "상세"],
    ["charge_abuse", "결제 취소 반복", "2회", "확인중", "결제 확인", "상세"],
    ["dm_linker", "외부 링크 유도", "1회", "주의", "수정 안내", "상세"],
    ["refund_watch", "환불 악용 의심", "2회", "확인중", "정산 보류", "상세"],
    ["report_noise", "허위 신고 반복", "4회", "주의", "신고 제한", "상세"],
    ["fan_badword", "공격 표현", "3회", "정지", "숨김 처리", "상세"],
    ["bot_like", "자동화 의심", "6회", "정지", "세션 종료", "상세"],
    ["policy_watch", "정책 경고 누적", "2회", "주의", "재안내", "상세"]
  ],
  creators: [
    ["김민서 / Min Stage", "Google", "오늘", "영업/최상만", "회계/최상만", "승인", "상세"],
    ["박하린 / Harin", "Kakao", "어제", "영업/최상만", "회계/최상만", "접수", "신청 보기"],
    ["이도윤 / Doyun", "Email", "35일 전", "영업/최상만", "회계/최상만", "장기미접속", "확인 요청"],
    ["정세아 / Sea", "Google", "12일 전", "영업/최상만", "회계/최상만", "프로필 누락", "알림 발송"],
    ["최유진 / Yujin", "Naver", "오늘", "영업/최상만", "회계/최상만", "승인", "상세"],
    ["한지호 / Jiho", "Kakao", "41일 전", "영업/최상만", "회계/최상만", "장기미접속", "확인 요청"],
    ["문리아 / Ria", "Google", "4일 전", "영업/최상만", "회계/최상만", "커버 누락", "알림 발송"],
    ["오서준 / Seojun", "Email", "18일 전", "영업/최상만", "회계/최상만", "승인", "상세"],
    ["배나윤 / Nayun", "Kakao", "29일 전", "영업/최상만", "회계/최상만", "확인중", "상세"],
    ["신유라 / Yura", "Google", "62일 전", "영업/최상만", "회계/최상만", "장기미접속", "확인 요청"]
  ],
  aiCreators: [
    ["윤세린", "아티스트", "에밀리", "완료", "완료", "공개", "콘텐츠 관리"],
    ["하윤아", "모델", "이미지탭", "완료", "포토 24장", "공개", "콘텐츠 관리"],
    ["권태준", "배우", "이미지탭", "완료", "포토 20장", "공개", "콘텐츠 관리"],
    ["서하민", "엔터테이너", "클라우드", "누락", "필요", "비공개", "업로드 요청"]
  ],
  aiAssets: [
    ["하윤아", "완료", "완료", "24장", "필요", "슬롯 선택: cover/thumb/gallery/shortform", "업로드"],
    ["권태준", "완료", "완료", "20장", "필요", "영상은 숏폼 후보, 이미지는 갤러리 후보", "업로드"],
    ["서하민", "필요", "필요", "필요", "필요", "자동분류보다 운영자 슬롯 지정 우선", "업로드"]
  ],
  aiPosts: [
    ["윤세린", "작성 가능", "핵심 프로필 완료", "준비중", "준비중", "작성"],
    ["최서진", "작성 필요", "핵심 프로필 완료", "준비중", "준비중", "작성"],
    ["권태준", "작성 필요", "핵심 프로필 확인", "준비중", "준비중", "작성"]
  ],
  moderation: [
    ["피드 #882", "creator_yuna", "신규 7일 집중 관리", "확인중", "상세"],
    ["댓글 #1204", "creator_min", "최근 신고 누적", "보류", "수정 요청"],
    ["공지 #77", "creator_09", "정상화 확인", "승인", "해제"]
  ],
  contentAnomalies: [
    ["피드 #912", "creator_doyun", "외부 연락처 패턴", "높음", "숨김"],
    ["피드 #909", "creator_ria", "반복 홍보 문구", "중간", "수정 요청"],
    ["댓글 #1304", "creator_min", "공격 표현", "중간", "확인"]
  ],
  reportCancels: [
    ["RP-774", "피드 #882", "user_102", "철회", "오신고", "보관"],
    ["RP-771", "댓글 #1204", "serinist_01", "취소", "작성자 수정 완료", "보관"],
    ["RP-768", "피드 #870", "watch_user", "철회", "중복 신고", "보관"]
  ],
  settlement: [
    ["creator_cha", "18,000원", "4,200원", "6,200원", "수수료 3,000원", "25,400원", "지급대기", "지급 완료"],
    ["creator_yoon", "9,000원", "2,100원", "4,900원", "수수료 2,000원", "14,000원", "지급대기", "지급 완료"],
    ["creator_park", "6,300원", "1,000원", "2,000원", "0원", "9,300원", "지급완료", "영수증"]
  ],
  aiSettlement: [
    ["윤세린", "에밀리", "64,000원", "18,000원", "46,000원", "AI 원가 12,000원", "검토", "성과 보기"],
    ["최서진", "클라우드", "38,000원", "22,000원", "32,000원", "이미지팩 9,000원", "검토", "성과 보기"],
    ["권태준", "이미지탭", "0원", "0원", "신규 공개 반응", "초기 등록", "확인중", "성과 보기"]
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
  moderation_queue: "신고/확인 필요",
  debut_queue: "데뷔 신청"
};

const alertTitleMap = {
  moderation_queue: "콘텐츠 확인 필요",
  debut_queue: "데뷔 신청 검토",
  payment_pending: "결제 확인 대기"
};

const tableMeta = {
  adminRows: { type: "운영자 관리", labels: ["계정", "역할", "상태", "최근 접속", "권한", "권장 액션"] },
  adminRequestRows: { type: "운영자 권한 이력", labels: ["이력", "대상", "권한", "상태", "메모", "권장 액션"] },
  overviewQueueRows: { type: "대시보드", labels: ["ID", "유형", "대상", "상태", "권장 액션"] },
  riskRows: { type: "위험 항목", labels: ["ID", "분류", "사유", "위험도", "권장 액션"] },
  userRows: { type: "유저 관리", labels: ["유저", "이메일", "가입일", "로그인유형", "루미나", "최근 접속", "권장 액션"] },
  userRiskRows: { type: "신고/제재 유저", labels: ["유저", "사유", "누적", "상태", "최근 조치", "권장 액션"] },
  creatorRows: { type: "유저 크리에이터", labels: ["본명/활동명", "로그인유형", "마지막 접속", "연락처", "정산계좌", "상태", "권장 액션"] },
  aiCreatorRows: { type: "AI 아티스트", labels: ["아티스트", "분류", "만든 관리자", "프로필", "이미지", "상태", "권장 액션"] },
  aiAssetRows: { type: "AI 아티스트 에셋", labels: ["아티스트", "커버", "썸네일", "포토갤러리", "숏폼", "업로드 규칙", "권장 액션"] },
  aiPostRows: { type: "AI 아티스트 콘텐츠", labels: ["아티스트", "피드 글", "프로필 문구", "채팅", "프리미엄", "권장 액션"] },
  moderationRows: { type: "크리에이터 콘텐츠", labels: ["콘텐츠", "작성자", "관리 사유", "상태", "권장 액션"] },
  contentAnomalyRows: { type: "이상 패턴", labels: ["콘텐츠", "작성자", "탐지 신호", "위험도", "권장 액션"] },
  reportCancelRows: { type: "취소/철회 신고", labels: ["신고", "대상", "신고자", "상태", "사유", "권장 액션"] },
  settlementRows: { type: "유저 크리에이터 정산", labels: ["대상", "프리미엄챗", "유료 좋아요", "기타 매출", "차감", "정산금", "상태", "권장 액션"] },
  aiSettlementRows: { type: "AI 아티스트 성과", labels: ["아티스트", "제작자", "프리미엄챗", "유료 좋아요", "기타 성과", "차감/원가", "내부 보너스", "권장 액션"] },
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

function openQuickAction(button) {
  const label = button.textContent.trim();
  const section = button.closest(".section-block");
  const sectionTitle = section?.querySelector(".section-title h2")?.textContent?.trim() || "백스테이지";
  const cardTitle = button.closest(".table-card")?.querySelector("h3")?.textContent?.trim() || sectionTitle;

  const actionMap = {
    "운영자 추가": ["운영자 계정 초대", "역할은 최상 관리자, 회계 관리자, 영업/섭외 관리자, CS 관리자, AI 아티스트 관리자 중 하나로 선택합니다.", "POST /admin/api/v1/admin-users/invitations"],
    "이력 보기": ["권한 변경 이력", "MVP에서는 super_admin 직접 변경과 audit log 중심으로 관리합니다. 2인 승인/요청함은 운영자가 늘어난 뒤 추가합니다.", "GET /admin/api/v1/audit-events?action=admin"],
    "전체 보기": ["목록 전체 보기", "현재 표의 필터를 초기화하고 전체 더미 데이터를 다시 보여줍니다.", "GET list endpoint with cursor"],
    "위험만 보기": ["위험 항목 필터", "신고, 정지, 높은 위험도 항목만 남겨서 봅니다.", "GET list endpoint with risk filter"],
    "데뷔 신청 보기": ["데뷔 신청 목록", "신청서에 기재한 활동명, 소개, 연락 가능 시간, 자료 링크, 권리 확인 내용을 모두 보여줄 자리입니다.", "GET /admin/api/v1/debut/applications"],
    "AI 아티스트 추가": ["AI 아티스트 추가", "캐릭터 기본 정보, 만든 관리자, 공개 상태, 초기 프로필/에셋 체크리스트를 등록합니다.", "POST /admin/api/v1/artists"],
    "업로드 추가": ["AI 에셋 업로드", "아티스트와 슬롯을 먼저 선택합니다. cover/thumb은 자동 판단하지 않고 운영자가 지정합니다.", "POST /admin/api/v1/artists/:artistId/assets/upload-intents"],
    "글 작성": ["AI 아티스트 글 작성", "아티스트를 선택하고 피드/프로필/공지/프리미엄 글 유형을 골라 작성합니다.", "POST /admin/api/v1/artists/:artistId/content"],
    "대상 설정": ["집중 관리 대상 설정", "신규 7일 모니터링, 신고 누적, 장기 미접속 등 관리 사유를 붙입니다.", "POST /admin/api/v1/creator-content/watchlist"],
    "패턴 보기": ["이상 패턴 확인", "연락처 유도, 반복 홍보, 공격 표현 등 탐지 신호를 확인합니다.", "GET /admin/api/v1/creator-content/anomalies"],
    "신고 이력": ["취소/철회 신고 이력", "접수, 취소, 철회, 중복 신고를 따로 보관하고 확인합니다.", "GET /admin/api/v1/community/reports?status=cancelled,withdrawn"],
    "정산 보기": ["정산 상세", "프리미엄챗, 유료 좋아요, 기타 매출, 차감, 정산금을 항목별로 봅니다.", "GET /admin/api/v1/settlements"],
    "성과 보기": ["AI 아티스트 성과", "제작자, 매출 항목, 원가, 내부 보너스 산정 기준을 봅니다.", "GET /admin/api/v1/ai-artists/performance"]
  };
  const [title, description, apiHint] = actionMap[label] || [label, `${cardTitle} 기능의 더미 연결입니다.`, "API 연결 대기"];

  renderDetailPanel({
    tableId: "quickAction",
    type: sectionTitle,
    labels: ["기능", "위치", "상태", "연결 예정", "메모"],
    row: [title, cardTitle, "더미 동작", apiHint, description]
  });
}

function applyTableSearch(section, term) {
  const keyword = term.trim().toLowerCase();
  section.querySelectorAll("tbody tr").forEach((row) => {
    row.classList.toggle("is-filtered-hidden", Boolean(keyword) && !row.textContent.toLowerCase().includes(keyword));
  });
  renderDetailPanel({
    tableId: "quickAction",
    type: "검색",
    labels: ["검색어", "대상", "상태"],
    row: [term || "전체", section.querySelector(".section-title h2")?.textContent?.trim() || "현재 탭", keyword ? "필터 적용" : "필터 초기화"]
  });
}

function applyOverviewFilter(button) {
  const label = button.textContent.trim();
  button.closest(".filter-row")?.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.remove("is-active"));
  button.classList.add("is-active");
  const overview = document.getElementById("overview");
  const cards = overview?.querySelectorAll(".table-card") || [];
  cards.forEach((card, index) => {
    const hide = label === "확인" && index === 1 || label === "위험" && index === 0;
    card.classList.toggle("is-filtered-hidden", hide);
  });
  renderDetailPanel({
    tableId: "quickAction",
    type: "대시보드 필터",
    labels: ["필터", "표시 상태", "메모"],
    row: [label, label === "전체" ? "업무/위험 모두 표시" : `${label} 항목만 표시`, "더미 데이터 기준으로 카드 표시를 전환했습니다."]
  });
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
  } else if (detail.tableId === "adminRows" || detail.tableId === "adminRequestRows") {
    base.apiHint = "POST/PATCH /admin/api/v1/admin-users 또는 admin roles";
    base.warning = "최상 관리자만 운영자 권한을 변경합니다. 회계는 정산계좌, 영업/섭외는 연락처, AI 아티스트 관리자는 AI 콘텐츠만 열람합니다.";
  } else if (detail.tableId === "creatorRows") {
    base.apiHint = "GET /admin/api/v1/creators 및 GET /admin/api/v1/debut/applications/:applicationId";
    base.warning = "연락처는 섭외/최상 관리자만, 정산계좌는 회계/최상 관리자만 볼 수 있어야 합니다.";
  } else if (detail.tableId === "aiCreatorRows") {
    base.apiHint = "PATCH /admin/api/v1/artists/:artistId 및 artist profile/assets";
    base.warning = "AI 아티스트 공개 상태, 프로필, 에셋 누락 상태를 함께 갱신해야 합니다.";
  } else if (detail.tableId === "aiAssetRows") {
    base.apiHint = "POST /admin/api/v1/artists/:artistId/assets/upload-intents";
    base.warning = "커버, 썸네일, 포토갤러리, 숏폼 업로드 구분과 노출 위치를 함께 저장해야 합니다.";
  } else if (detail.tableId === "aiPostRows") {
    base.apiHint = "POST/PATCH /admin/api/v1/artists/:artistId/content";
    base.warning = "AI 아티스트 공식 글과 프리미엄/채팅 설정은 유저 콘텐츠 확인과 분리해서 처리합니다.";
  } else if (detail.tableId === "userRiskRows") {
    base.apiHint = "GET /admin/api/v1/community/reports 및 POST /admin/api/v1/users/:userId/suspend";
    base.warning = "유저 제재는 사유와 누적 신고 맥락을 남기고 실행해야 합니다.";
  } else if (detail.tableId === "moderationRows" || detail.tableId === "contentAnomalyRows" || detail.tableId === "reportCancelRows" || detail.tableId === "riskRows") {
    base.apiHint = currentAction.includes("복구") ? "POST /admin/api/v1/community/posts/:postId/restore" : "POST /admin/api/v1/community/posts/:postId/hide";
    base.warning = "집중 관리 대상, 이상 패턴, 취소/철회 신고만 접근하고 모든 글 일괄 열람은 피해야 합니다.";
  } else if (detail.tableId === "settlementRows") {
    base.apiHint = "POST /admin/api/v1/payment-orders/:orderId/refunds 또는 PATCH /admin/api/v1/refund-transactions/:refundId";
    base.warning = "크리에이터 정산 지급 API는 아직 준비중입니다. 현재는 결제/환불 운영만 연결 대상입니다.";
  } else if (detail.tableId === "aiSettlementRows") {
    base.apiHint = "GET /admin/api/v1/ai-artists/performance 및 internal bonus rules";
    base.warning = "AI 아티스트 성과는 내부 운영 보너스 기준으로, 유저 크리에이터 정산과 분리해야 합니다.";
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
  renderRows("adminRows", backstageRows.admins, 2);
  renderRows("adminRequestRows", backstageRows.adminRequests, 3);
  renderRows("overviewQueueRows", backstageRows.overviewQueue, 3);
  renderRows("riskRows", backstageRows.risk, 3);
  renderRows("userRows", backstageRows.users, -1);
  renderRows("userRiskRows", backstageRows.userRisks, 3);
  renderRows("creatorRows", backstageRows.creators, 5);
  renderRows("aiCreatorRows", backstageRows.aiCreators, 5);
  renderRows("aiAssetRows", backstageRows.aiAssets, -1);
  renderRows("aiPostRows", backstageRows.aiPosts, -1);
  renderRows("moderationRows", backstageRows.moderation, 3);
  renderRows("contentAnomalyRows", backstageRows.contentAnomalies, 3);
  renderRows("reportCancelRows", backstageRows.reportCancels, 3);
  renderRows("settlementRows", backstageRows.settlement, 6);
  renderRows("aiSettlementRows", backstageRows.aiSettlement, 6);
  renderRows("logRows", backstageRows.logs, -1);
}

function setActiveSection(sectionId = "overview") {
  const targetId = document.getElementById(sectionId) ? sectionId : "overview";
  document.querySelector(".dashboard-main")?.setAttribute("data-active-section", targetId);
  document.querySelectorAll(".section-block").forEach((section) => {
    section.classList.toggle("is-active", section.id === targetId);
  });
  document.querySelectorAll(".sidebar-nav a").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${targetId}`);
  });
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
          ? "확인 필요 항목"
          : item.key === "debut_queue"
            ? "접수/확인 필요 항목"
            : item.tone || "운영 확인";
    return `<article><span>${label}</span><strong>${formatCount(item.value)}</strong><small>${helper}</small></article>`;
  }).join("");
}

function renderSummaryAlerts(alerts = []) {
  if (!alertStrip || !Array.isArray(alerts) || alerts.length === 0) return;
  const openAlerts = alerts.filter((item) => Number(item.count || 0) > 0);
  if (openAlerts.length === 0) {
    alertStrip.innerHTML = "<strong>우선 확인</strong><span>현재 즉시 처리해야 할 주요 확인 항목은 없습니다.</span>";
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
    item.status === "hidden" ? "숨김" : "확인중",
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
  const query = new URLSearchParams({ take: "10" });
  if (append && state.cursor) query.set("cursor", state.cursor);
  try {
    const page = normalizePage(await backstageFetch(adminApiPath(`/users?${query}`), { auth: true }));
    const rows = page.items.map((user) => [
      user.displayName || user.nickname || user.id?.slice?.(0, 8) || "-",
      user.email || "-",
      formatDate(user.createdAt),
      user.socialProvider || user.loginProvider || user.provider || "Email",
      formatCount(user.wallet?.balanceLumina || user.walletBalanceLumina || 0) + "L",
      formatDate(user.lastLoginAt || user.updatedAt || user.createdAt),
      user.status === "suspended" ? "복구 요청" : "세션 종료"
    ]);
    state.rows = append ? state.rows.concat(rows) : rows;
    state.cursor = page.nextCursor;
    state.hasMore = page.hasMore;
    setLoadMore("users", page.hasMore);
    if (state.rows.length) renderRows("userRows", state.rows, -1);
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
    const applications = await backstageFetch(adminApiPath("/debut/applications?take=10"), { auth: true });
    const rows = (Array.isArray(applications) ? applications : applications?.items || []).map((item) => [
      `${item.applicantName || "-"} / ${item.displayName || "-"}`,
      item.loginProvider || item.provider || item.applicationChannel || "-",
      formatDate(item.lastLoginAt || item.updatedAt || item.createdAt),
      "권한 필요",
      "권한 필요",
      item.status || "-",
      item.status === "approved" ? "권한 보기" : "신청 보기"
    ]);
    if (rows.length) renderRows("creatorRows", rows, 5);
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
    else renderLoadingRow("moderationRows", "확인 필요한 콘텐츠가 없습니다.");
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
  setActiveSection("overview");
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
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const sectionId = link.getAttribute("href")?.replace("#", "") || "overview";
    setActiveSection(sectionId);
    loadSection(sectionId);
  });
});

document.addEventListener("click", (event) => {
  const detailButton = event.target.closest("[data-detail]");
  if (detailButton) {
    selectDetailButton(detailButton);
    return;
  }

  const quickButton = event.target.closest(".text-action");
  if (quickButton && quickButton.id !== "detailCloseButton") {
    openQuickAction(quickButton);
    return;
  }

  const searchButton = event.target.closest(".search-box .secondary-action");
  if (searchButton) {
    const section = searchButton.closest(".section-block");
    const input = searchButton.closest(".search-box")?.querySelector("input");
    if (section && input) applyTableSearch(section, input.value);
    return;
  }

  const filterButton = event.target.closest(".filter-chip");
  if (filterButton) applyOverviewFilter(filterButton);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const input = event.target.closest(".search-box input");
  if (!input) return;
  event.preventDefault();
  const section = input.closest(".section-block");
  if (section) applyTableSearch(section, input.value);
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


