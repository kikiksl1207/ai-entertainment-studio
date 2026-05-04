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
let pendingActionPreview = null;
const sectionState = {
  admins: { rows: [], auditRows: [] },
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
  "예상치": "is-hold",
  "확정전": "is-hold",
  "매출없음": "is-review",
  "완료": "is-paid",
  "공개": "is-approved",
  "정상": "is-approved",
  "보완필요": "is-hold",
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
    ["a01057662701", "a01057662701@gmail.com", "Google", "300L", "0원", "0 / 0", "0", "2 / 0", "오늘", "공개", "상세"],
    ["serinist_01", "user01@example.com", "Email", "1,240L", "38,000원", "0 / 1", "0", "6 / 1", "어제", "공개", "세션 종료"],
    ["watch_user", "watch@example.com", "Google", "0L", "0원", "2 / 3", "1", "0 / 0", "3일 전", "정지", "복구 요청"],
    ["lumi_fan_04", "fan04@example.com", "Kakao", "820L", "12,000원", "0 / 0", "0", "4 / 0", "오늘", "공개", "상세"],
    ["stagepick_05", "pick05@example.com", "Google", "150L", "5,500원", "0 / 0", "0", "3 / 0", "2일 전", "공개", "상세"],
    ["yuna_viewer", "viewer@example.com", "Email", "90L", "0원", "0 / 0", "0", "1 / 0", "5일 전", "공개", "상세"],
    ["vote_love", "vote@example.com", "Naver", "430L", "9,900원", "0 / 0", "0", "5 / 1", "오늘", "공개", "상세"],
    ["photo_user", "photo@example.com", "Google", "12L", "0원", "0 / 0", "0", "2 / 0", "6일 전", "공개", "상세"],
    ["chat_fan_09", "chat09@example.com", "Kakao", "2,100L", "66,000원", "0 / 0", "0", "7 / 2", "어제", "공개", "상세"],
    ["quiet_user", "quiet@example.com", "Email", "0L", "0원", "0 / 0", "0", "0 / 0", "8일 전", "공개", "상세"]
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
    ["creator_cha", "cha_creator", "18", "2,840L", "28,400원", "6,000원", "17,920원", "예상치", "확정 전"],
    ["creator_yoon", "yoon_creator", "9", "1,600L", "16,000원", "3,100원", "10,320원", "예상치", "확정 전"],
    ["creator_park", "park_creator", "0", "0L", "0원", "0원", "0원", "매출없음", "확정 전"]
  ],
  aiSettlement: [
    ["윤세린", "에밀리", "64,000원", "18,000원", "46,000원", "128,000원", "12,000원", "116,000원", "성과 보기"],
    ["최서진", "클라우드", "38,000원", "22,000원", "32,000원", "92,000원", "9,000원", "83,000원", "성과 보기"],
    ["권태준", "이미지탭", "0원", "0원", "신규 공개 반응", "0원", "0원", "0원", "성과 보기"]
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
  userRows: { type: "유저 관리", labels: ["유저", "이메일", "로그인", "루미나", "결제", "신고", "제재", "팔로우", "최근 접속", "상태", "권장 액션"] },
  userRiskRows: { type: "신고/제재 유저", labels: ["유저", "사유", "누적", "상태", "최근 조치", "권장 액션"] },
  creatorRows: { type: "유저 크리에이터", labels: ["본명/활동명", "로그인유형", "마지막 접속", "연락처", "정산계좌", "상태", "권장 액션"] },
  aiCreatorRows: { type: "AI 아티스트", labels: ["아티스트", "분류", "만든 관리자", "프로필", "이미지", "상태", "권장 액션"] },
  aiAssetRows: { type: "AI 아티스트 에셋", labels: ["아티스트", "커버", "썸네일", "포토갤러리", "숏폼", "업로드 규칙", "권장 액션"] },
  aiPostRows: { type: "AI 아티스트 콘텐츠", labels: ["아티스트", "피드 글", "프로필 문구", "채팅", "프리미엄", "권장 액션"] },
  moderationRows: { type: "크리에이터 콘텐츠", labels: ["콘텐츠", "작성자", "관리 사유", "상태", "권장 액션"] },
  contentAnomalyRows: { type: "이상 패턴", labels: ["콘텐츠", "작성자", "탐지 신호", "위험도", "권장 액션"] },
  reportCancelRows: { type: "취소/철회 신고", labels: ["신고", "대상", "신고자", "상태", "사유", "권장 액션"] },
  settlementRows: { type: "유저 크리에이터 정산", labels: ["아티스트", "제작자", "이벤트", "루미나", "총매출", "차감", "정산금", "상태", "권장 액션"] },
  aiSettlementRows: { type: "AI 아티스트 성과", labels: ["아티스트", "제작자", "프리미엄챗", "유료 좋아요", "기타 성과", "총액", "차감", "정산금", "권장 액션"] },
  logRows: { type: "운영 로그", labels: ["시간", "관리자", "액션", "대상", "메모"] }
};

const sectionLoaders = {
  admins: loadAdminsSection,
  users: loadUsersSection,
  creators: loadCreatorsSection,
  "ai-content": loadAiContentSection,
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
      const label = meta.labels?.[index] || "";
      const isSettlementAmount = label === "정산금";
      const content = index === statusIndex
        ? statusBadge(cell)
        : isSettlementAmount
          ? `<strong class="settlement-amount">${cell}</strong>`
          : cell;
      if (index === row.length - 1) {
        const payload = encodeURIComponent(JSON.stringify({ tableId: targetId, type: meta.type, labels: meta.labels, row }));
        return `<td><button class="row-action" type="button" data-detail="${payload}">${content}</button></td>`;
      }
      return `<td${isSettlementAmount ? ' class="settlement-cell"' : ""}>${content}</td>`;
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

function readSectionSearch(sectionId) {
  const input = document.querySelector(`#${sectionId} .search-box input`);
  return input?.value?.trim?.() || "";
}

function currentSettlementPeriod() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function financialValue(financials, keys) {
  for (const key of keys) {
    const value = Number(financials?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function settlementDeductions(financials = {}) {
  const explicit = [
    financialValue(financials, ["vatKrw", "vatAmountKrw", "salesVatKrw"]),
    financialValue(financials, ["pgFeeKrw", "paymentGatewayFeeKrw"]),
    financialValue(financials, ["pgFeeVatKrw", "paymentGatewayFeeVatKrw"]),
    financialValue(financials, ["aiCostKrw", "aiOperationCostKrw"]),
    financialValue(financials, ["directCostKrw", "operationCostKrw"]),
    financialValue(financials, ["riskReserveKrw"])
  ].reduce((sum, value) => sum + value, 0);
  if (explicit > 0) return explicit;

  const gross = financialValue(financials, ["grossRevenueKrw"]);
  const net = financialValue(financials, ["netRevenueKrw"]);
  return Math.max(0, gross - net);
}

function creatorNames(creators = []) {
  if (!Array.isArray(creators) || !creators.length) return "-";
  return creators.map((creator) => (
    creator.displayName ||
    creator.profileName ||
    creator.name ||
    creator.maskedEmail ||
    creator.emailMasked ||
    creator.email ||
    creator.id?.slice?.(0, 8) ||
    "-"
  )).join(", ");
}

function localizeSettlementStatus(status) {
  const statusMap = {
    estimated: "예상치",
    no_revenue: "매출없음",
    confirmed: "완료",
    paid: "지급완료",
    hold: "보류"
  };
  return statusMap[status] || localizeWorkflowStatus(status);
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
  detailPanel.classList.remove("is-hidden");
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
    "성과 보기": ["AI 아티스트 성과", "캐릭터별 총액, 차감, 정산금, 제작자, 내부 보너스 산정 기준을 봅니다.", "GET /admin/api/v1/ai-artists/performance"]
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

function getActionProfile(detail, action = "memo") {
  const tableId = detail?.tableId || "quickAction";
  const row = detail?.row || [];
  const labels = detail?.labels || [];
  const status = row[labels.findIndex((label) => label === "상태")] || "";
  const rowAction = row[row.length - 1] || "";
  const actionName = action === "danger" ? rowAction || "실행" : action === "hold" ? "보류/확인" : "메모 저장";

  const profile = {
    group: "백스테이지 운영",
    targetType: "backstage",
    actionName,
    endpoint: "읽기 전용 또는 준비중",
    method: "GET",
    warning: "이 항목은 현재 실행 API 연결 대상이 아닙니다.",
    memoLabel: "메모 저장",
    holdLabel: "보류",
    dangerLabel: "실행 API 연결 대기",
    showHold: false,
    showDanger: false,
    dangerDisabled: true
  };

  if (tableId === "userRows" || tableId === "userRiskRows") {
    const wantsRestore = rowAction.includes("복구") || status === "정지";
    const wantsSession = rowAction.includes("세션");
    return {
      ...profile,
      group: "유저 운영 액션",
      targetType: "user",
      endpoint: wantsRestore
        ? "POST /admin/api/v1/users/:userId/restore"
        : wantsSession
          ? "POST /admin/api/v1/users/:userId/revoke-sessions"
          : "POST /admin/api/v1/users/:userId/suspend",
      method: "POST",
      warning: "세션 종료, 정지, 복구는 운영 로그와 사유가 반드시 필요합니다. 차모 API 확정 전 실제 실행은 잠가둡니다.",
      holdLabel: tableId === "userRiskRows" ? "보류/재확인 메모" : "상태 확인 메모",
      dangerLabel: wantsRestore ? "복구 요청" : wantsSession ? "세션 종료" : "정지 검토",
      showHold: true,
      showDanger: true
    };
  }

  if (tableId === "creatorRows") {
    return {
      ...profile,
      group: "데뷔 신청 운영",
      targetType: "debutApplication",
      endpoint: action === "danger" ? "GET /admin/api/v1/debut/applications/:applicationId" : "PATCH /admin/api/v1/debut/applications/:applicationId/status",
      method: action === "danger" ? "GET" : "PATCH",
      warning: "데뷔 신청 상세, 보완 요청, 승인/반려는 신청서 권리 확인과 연락처 권한을 함께 봐야 합니다.",
      holdLabel: "보완 요청 메모",
      dangerLabel: "신청 상세 보기",
      showHold: true,
      showDanger: true
    };
  }

  if (["moderationRows", "contentAnomalyRows", "reportCancelRows", "riskRows"].includes(tableId)) {
    const isReport = tableId === "reportCancelRows";
    const restore = rowAction.includes("복구") || status === "숨김";
    return {
      ...profile,
      group: "크리에이터 콘텐츠 조치",
      targetType: isReport ? "report" : "creatorContent",
      endpoint: isReport
        ? "POST /admin/api/v1/community/reports/:reportId/archive"
        : restore
          ? "POST /admin/api/v1/community/posts/:postId/restore"
          : "POST /admin/api/v1/community/posts/:postId/hide",
      method: "POST",
      warning: "콘텐츠 숨김/복구/신고 보관은 사유와 대상 ID가 확정된 뒤 실행합니다. 전체 글 열람이 아니라 집중 관리 대상만 다룹니다.",
      holdLabel: "보류/재확인 메모",
      dangerLabel: isReport ? "신고 보관" : restore ? "복구 실행" : "숨김/제재 검토",
      showHold: true,
      showDanger: true
    };
  }

  if (["aiCreatorRows", "aiAssetRows", "aiPostRows"].includes(tableId)) {
    const isAsset = tableId === "aiAssetRows";
    const isPost = tableId === "aiPostRows";
    return {
      ...profile,
      group: "AI 아티스트 운영 액션",
      targetType: "aiArtist",
      endpoint: isAsset
        ? "POST /admin/api/v1/artists/:artistId/assets/upload-intents"
        : isPost
          ? "POST/PATCH /admin/api/v1/artists/:artistId/content"
          : "PATCH /admin/api/v1/artists/:artistId",
      method: isPost || isAsset ? "POST" : "PATCH",
      warning: "AI 아티스트 프로필, 공식 글, 에셋 슬롯은 캐릭터 기준이 깨지지 않게 운영자 지정값으로 저장해야 합니다.",
      holdLabel: isAsset ? "슬롯 수정 메모" : isPost ? "문구 수정 메모" : "프로필 수정 메모",
      dangerLabel: isAsset ? "에셋 업로드" : isPost ? "글 작성" : "공개 상태 변경",
      showHold: true,
      showDanger: true
    };
  }

  if (tableId === "settlementRows") {
    return {
      ...profile,
      group: "정산 preview 확인",
      targetType: "settlementPreview",
      endpoint: "GET /admin/api/v1/backstage/operations/settlement-preview",
      method: "GET",
      warning: "이 정산값은 예상치/확정 전입니다. 확정/지급 mutation API가 없어 현재는 상세 확인과 운영 메모만 가능합니다.",
      dangerLabel: "정산 상세",
      showDanger: true
    };
  }

  return profile;
}

function updateDetailActions(detail) {
  const memoButton = document.querySelector('[data-detail-action="memo"]');
  const dangerButton = document.querySelector('[data-detail-action="danger"]');
  const holdButton = document.querySelector('[data-detail-action="hold"]');
  if (!memoButton || !dangerButton || !holdButton) return;

  const profile = getActionProfile(detail);
  const setButton = (button, { label, show = true, disabled = false }) => {
    button.textContent = label;
    button.classList.toggle("is-hidden", !show);
    button.disabled = disabled;
  };

  setButton(memoButton, { label: profile.memoLabel, show: true, disabled: false });
  setButton(holdButton, { label: profile.holdLabel, show: profile.showHold, disabled: false });
  setButton(dangerButton, { label: profile.dangerLabel, show: profile.showDanger, disabled: profile.dangerDisabled });
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
  const profile = getActionProfile(detail, action);
  const isLocalOnly = action === "memo" || action === "hold";

  const base = {
    menu: detail.type,
    actionGroup: profile.group,
    targetType: profile.targetType,
    target,
    requestedAction: action === "danger" ? currentAction : action,
    method: profile.method,
    apiHint: profile.endpoint,
    status: isLocalOnly ? "프론트 임시 처리 가능" : "차모 API 확정 대기",
    bodyPreview: {
      targetType: profile.targetType,
      target,
      action: action === "danger" ? currentAction : action,
      reason: memo || "운영 메모 미입력",
      note: memo || "운영 메모 미입력"
    },
    note: memo || "운영 메모 미입력",
    warning: isLocalOnly
      ? "현재는 프론트에서 운영 메모 흐름만 확인합니다. 실제 저장 API가 확정되면 같은 payload로 연결합니다."
      : profile.warning,
    canRunLocally: isLocalOnly
  };
  return base;
}

function openConfirmModal(action) {
  const preview = buildActionPreview(action);
  if (!preview || !confirmModal) return;
  pendingActionPreview = preview;
  confirmType.textContent = preview.menu || "Confirm";
  confirmTitle.textContent = action === "memo" ? "운영 메모 저장 확인" : action === "hold" ? "보류/재확인 확인" : "실행 API 연결 대기";
  confirmMessage.textContent = preview.warning;
  confirmPayload.textContent = JSON.stringify(preview, null, 2);
  confirmRunButton.textContent = preview.canRunLocally ? "프론트 메모 처리" : "차모 API 확정 대기";
  confirmRunButton.disabled = !preview.canRunLocally;
  confirmModal.classList.remove("is-hidden");
}

function closeConfirmModal() {
  pendingActionPreview = null;
  confirmModal?.classList.add("is-hidden");
}

function runPreparedAction() {
  if (!pendingActionPreview?.canRunLocally) return;
  const help = document.querySelector(".detail-help");
  if (help) {
    help.textContent = `${pendingActionPreview.actionGroup} 메모 흐름을 프론트에서 확인했어요. 실제 저장은 차모 API 확정 후 연결합니다.`;
  }
  closeConfirmModal();
}

function renderBackstageTables() {
  renderRows("adminRows", backstageRows.admins, 2);
  renderRows("adminRequestRows", backstageRows.adminRequests, 3);
  renderRows("overviewQueueRows", backstageRows.overviewQueue, 3);
  renderRows("riskRows", backstageRows.risk, 3);
  renderRows("userRows", backstageRows.users, 9);
  renderRows("userRiskRows", backstageRows.userRisks, 3);
  renderRows("creatorRows", backstageRows.creators, 5);
  renderRows("aiCreatorRows", backstageRows.aiCreators, 5);
  renderRows("aiAssetRows", backstageRows.aiAssets, -1);
  renderRows("aiPostRows", backstageRows.aiPosts, -1);
  renderRows("moderationRows", backstageRows.moderation, 3);
  renderRows("contentAnomalyRows", backstageRows.contentAnomalies, 3);
  renderRows("reportCancelRows", backstageRows.reportCancels, 3);
  renderRows("settlementRows", backstageRows.settlement, 7);
  renderRows("aiSettlementRows", backstageRows.aiSettlement, -1);
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

function localizeAdminRole(roleName) {
  const roleMap = {
    super_admin: "최상 관리자",
    settlement_admin: "회계 관리자",
    finance_admin: "회계 관리자",
    partnership_admin: "영업/섭외 관리자",
    partner_admin: "영업/섭외 관리자",
    cs_admin: "CS 관리자",
    support_admin: "CS 관리자",
    ai_artist_admin: "AI 아티스트 관리자",
    artist_admin: "AI 아티스트 관리자",
    content_admin: "AI 아티스트 관리자"
  };
  return roleMap[roleName] || roleName || "-";
}

function localizeAdminStatus(status) {
  const statusMap = {
    active: "승인",
    suspended: "정지",
    revoked: "철회"
  };
  return statusMap[status] || status || "-";
}

function summarizePermissions(permissions) {
  const values = Array.isArray(permissions) ? permissions : [];
  if (values.includes("*")) return "전체 권한";
  const joined = values.join(" ");
  if (/payments|refunds|settlement|payout/.test(joined)) return "결제/환불/정산";
  if (/debut|creator|contact|partner/.test(joined)) return "데뷔 신청/연락처";
  if (/users|community|reports|sanction|audit/.test(joined)) return "유저/신고/제재";
  if (/artists|assets|shortforms|premium|chat/.test(joined)) return "AI 콘텐츠/슬롯/공식 글";
  return values.length ? `${values.length}개 권한` : "권한 확인 필요";
}

function formatAuditAction(action) {
  const actionMap = {
    "admin_user.create": "운영자 추가",
    "admin_user.update": "역할 변경",
    "payment_refund.create": "환불 접수",
    "payment_refund.update": "환불 상태 변경",
    "asset.upload_intent.create": "업로드 요청",
    "asset.upload.confirm": "업로드 확인",
    "artist.create": "AI 아티스트 추가",
    "artist.update": "AI 아티스트 수정"
  };
  return actionMap[action] || action || "-";
}

function localizeWorkflowStatus(status) {
  const statusMap = {
    pending: "접수",
    submitted: "접수",
    review: "검수중",
    reviewing: "검수중",
    approved: "승인",
    rejected: "보류",
    active: "공개",
    published: "공개",
    draft: "준비중",
    archived: "보류",
    healthy: "정상",
    needs_action: "보완필요",
    missing: "누락"
  };
  return statusMap[status] || status || "-";
}

function countLabel(count, unit = "개") {
  const number = Number(count || 0);
  return number > 0 ? `${number.toLocaleString("ko-KR")}${unit}` : "필요";
}

function slotStatus(slot, primaryOnly = false) {
  if (!slot) return "필요";
  if (primaryOnly) return slot.primaryAssetId || slot.primaryUrl ? "완료" : "필요";
  return countLabel(slot.count, "장");
}

function profileStatus(profiles = {}, key) {
  return profiles[key] ? "완료" : "누락";
}

function missingSummary(missing = []) {
  if (!Array.isArray(missing) || missing.length === 0) return "슬롯 정상";
  const labelMap = {
    public_profile: "공개 프로필",
    visual_profile: "비주얼 프로필",
    content_profile: "콘텐츠 프로필",
    cover_asset: "커버",
    thumbnail_asset: "썸네일",
    gallery_assets: "갤러리",
    shortforms: "숏폼",
    chat_persona: "채팅"
  };
  return missing.slice(0, 3).map((item) => labelMap[item] || item).join(", ");
}

async function loadAdminsSection() {
  sectionState.admins = { rows: [], auditRows: [] };
  renderLoadingRow("adminRows");
  renderLoadingRow("adminRequestRows");

  try {
    const [adminUsers, adminRoles, adminEvents] = await Promise.all([
      backstageFetch(adminApiPath("/admin-users"), { auth: true }),
      backstageFetch(adminApiPath("/admin-roles"), { auth: true }).catch(() => []),
      backstageFetch(adminApiPath("/audit-events?take=10&targetType=admin_user"), { auth: true }).catch(() => [])
    ]);
    const roles = normalizePage(adminRoles).items;
    const rows = normalizePage(adminUsers).items.map((adminUser) => {
      const roleName = adminUser.role?.name || adminUser.roleName || adminUser.adminRole;
      const status = localizeAdminStatus(adminUser.status);
      return [
        adminUser.user?.email || adminUser.email || adminUser.userId?.slice?.(0, 8) || "-",
        localizeAdminRole(roleName),
        status,
        formatDate(adminUser.lastAccessAt || adminUser.lastLoginAt || adminUser.user?.lastLoginAt || adminUser.updatedAt || adminUser.createdAt),
        summarizePermissions(adminUser.role?.permissions || adminUser.permissions),
        status === "승인" ? "권한 보기" : "복구 확인"
      ];
    });
    const auditRows = normalizePage(adminEvents).items.map((event) => [
      event.id?.slice?.(0, 8) || "-",
      formatAuditAction(event.action),
      event.targetType || "admin_user",
      "완료",
      event.actorUser?.email || event.actorUserId?.slice?.(0, 8) || "system",
      "상세"
    ]);
    const roleRows = roles.map((role, index) => [
      `ROLE-${String(index + 1).padStart(2, "0")}`,
      "권한 기준",
      localizeAdminRole(role.name),
      "완료",
      summarizePermissions(role.permissions),
      "상세"
    ]);

    sectionState.admins.rows = rows;
    sectionState.admins.auditRows = auditRows.length ? auditRows : roleRows;
    if (rows.length) renderRows("adminRows", rows, 2);
    else renderLoadingRow("adminRows", "등록된 운영자가 없습니다.");
    if (sectionState.admins.auditRows.length) renderRows("adminRequestRows", sectionState.admins.auditRows, 3);
    else renderLoadingRow("adminRequestRows", "최근 운영자 권한 이력이 없습니다.");
  } catch {
    renderBackstageTables();
    renderFallbackNote("adminRows");
    renderFallbackNote("adminRequestRows");
  }
}

async function loadUsersSection() {
  sectionState.users = { cursor: null, hasMore: false, rows: [], riskRows: [] };
  renderLoadingRow("userRows");
  renderLoadingRow("userRiskRows");
  await loadUsersPage(false);
}

async function loadUsersPage(append = true) {
  const state = sectionState.users;
  const search = readSectionSearch("users");
  const query = new URLSearchParams({ take: "20" });
  if (search) query.set(search.includes("@") ? "email" : "query", search);
  if (append && state.cursor) query.set("cursor", state.cursor);
  try {
    const page = normalizePage(await backstageFetch(adminApiPath(`/backstage/operations/users-overview?${query}`), { auth: true }));
    const rows = page.items.map((user) => [
      user.displayName || user.publicHandle || user.nickname || user.userId?.slice?.(0, 8) || user.id?.slice?.(0, 8) || "-",
      user.email || "-",
      user.loginType || user.loginTypes?.join(", ") || user.socialProvider || user.loginProvider || user.provider || "Email",
      `${formatCount(user.walletBalanceLumina || user.wallet?.balanceLumina || 0)}L`,
      krw(user.paidAmountKrw || 0),
      `${formatCount(user.openReportCount || 0)} / ${formatCount(user.reportCount || 0)}`,
      formatCount(user.sanctionCount || 0),
      `${formatCount(user.followingArtistCount || 0)} / ${formatCount(user.followerCount || 0)}`,
      formatDate(user.lastSeenAt || user.lastLoginAt || user.updatedAt || user.createdAt),
      localizeWorkflowStatus(user.status),
      user.status === "suspended" ? "복구 요청" : "세션 종료"
    ]);
    const riskRows = page.items
      .filter((user) => Number(user.openReportCount || 0) > 0 || Number(user.reportCount || 0) > 0 || Number(user.sanctionCount || 0) > 0 || user.recentAction)
      .map((user) => [
        user.displayName || user.publicHandle || user.email || user.userId?.slice?.(0, 8) || "-",
        user.latestReportReason || user.recentAction || "운영 확인",
        `${formatCount(user.openReportCount || 0)} / ${formatCount(user.reportCount || 0)}`,
        localizeWorkflowStatus(user.status),
        user.recentAction || (Number(user.sanctionCount || 0) > 0 ? `제재 ${formatCount(user.sanctionCount)}회` : "확인 필요"),
        Number(user.openReportCount || 0) > 0 ? "신고 보기" : "상세"
      ]);
    state.rows = append ? state.rows.concat(rows) : rows;
    state.riskRows = append ? (state.riskRows || []).concat(riskRows) : riskRows;
    state.cursor = page.nextCursor;
    state.hasMore = page.hasMore;
    setLoadMore("users", page.hasMore);
    if (state.rows.length) renderRows("userRows", state.rows, 9);
    else renderLoadingRow("userRows", "표시할 유저가 없습니다.");
    if (state.riskRows?.length) renderRows("userRiskRows", state.riskRows, 3);
    else renderLoadingRow("userRiskRows", "신고/제재 유저가 없습니다.");
  } catch {
    renderBackstageTables();
    setLoadMore("users", false);
    renderFallbackNote("userRows");
    renderFallbackNote("userRiskRows");
  }
}

async function loadCreatorsSection() {
  renderLoadingRow("creatorRows");
  renderLoadingRow("aiCreatorRows");
  try {
    const data = await backstageFetch(adminApiPath("/backstage/operations/creators?take=20"), { auth: true });
    const applicationsPage = normalizePage(data?.applications || data);
    const rows = applicationsPage.items.map((item) => [
      `${item.realName || item.applicantName || "-"} / ${item.stageName || item.displayName || "-"}`,
      item.loginType || item.loginProvider || item.provider || item.applicationChannel || "-",
      formatDate(item.lastLoginAt || item.updatedAt || item.createdAt),
      item.contactAccessAllowed ? item.contactEmail || item.contactPhone || "-" : item.contactMasked || "권한 제한",
      item.payoutAccessAllowed ? item.payoutAccount || "-" : item.payoutAccountMasked || "권한 제한",
      item.inactive30Days ? "장기미접속" : localizeWorkflowStatus(item.status),
      item.needsFollowUp ? "확인 요청" : item.status === "approved" ? "권한 보기" : "신청 보기"
    ]);
    const aiRows = (data?.aiArtists || []).map((artist) => [
      artist.displayName || artist.name || artist.slug || "-",
      artist.category || artist.type || artist.publicProfile?.characterType || "-",
      artist.createdBy?.email || artist.createdByName || artist.operatorName || "-",
      artist.missing?.includes("public_profile") || artist.missing?.includes("visual_profile") || artist.missing?.includes("content_profile") ? "누락" : "완료",
      artist.missing?.includes("cover_asset") || artist.missing?.includes("thumbnail_asset") || artist.missing?.includes("gallery_assets") ? missingSummary(artist.missing) : "완료",
      localizeWorkflowStatus(artist.status),
      "콘텐츠 관리"
    ]);
    if (rows.length) renderRows("creatorRows", rows, 5);
    else renderLoadingRow("creatorRows", "표시할 신청 내역이 없습니다.");
    if (aiRows.length) renderRows("aiCreatorRows", aiRows, 5);
    else renderLoadingRow("aiCreatorRows", "표시할 AI 아티스트가 없습니다.");
  } catch {
    renderRows("creatorRows", backstageRows.creators, 5);
    renderRows("aiCreatorRows", backstageRows.aiCreators, 5);
    renderFallbackNote("creatorRows");
    renderFallbackNote("aiCreatorRows");
  }
}

async function loadAiContentSection() {
  renderLoadingRow("aiAssetRows");
  renderLoadingRow("aiPostRows");
  try {
    const page = normalizePage(await backstageFetch(adminApiPath("/backstage/operations/ai-content-health?take=20"), { auth: true }));
    const assetRows = page.items.map((artist) => [
      artist.displayName || artist.name || artist.slug || "-",
      slotStatus(artist.slots?.cover, true),
      slotStatus(artist.slots?.thumbnail, true),
      slotStatus(artist.slots?.gallery),
      countLabel(artist.counts?.shortforms || artist.shortformsCount, "개"),
      artist.missing?.length ? missingSummary(artist.missing) : "운영자 슬롯 선택 우선",
      artist.missing?.length ? "업로드" : "상세"
    ]);
    const postRows = page.items.map((artist) => [
      artist.displayName || artist.name || artist.slug || "-",
      profileStatus(artist.profiles, "contentProfile"),
      profileStatus(artist.profiles, "publicProfile"),
      artist.missing?.includes("chat_persona") ? "필요" : "준비중",
      artist.counts?.premiumVideos ? countLabel(artist.counts.premiumVideos, "개") : "준비중",
      "작성"
    ]);
    if (assetRows.length) renderRows("aiAssetRows", assetRows, -1);
    else renderLoadingRow("aiAssetRows", "표시할 AI 에셋 상태가 없습니다.");
    if (postRows.length) renderRows("aiPostRows", postRows, -1);
    else renderLoadingRow("aiPostRows", "표시할 AI 콘텐츠 상태가 없습니다.");
  } catch {
    renderRows("aiAssetRows", backstageRows.aiAssets, -1);
    renderRows("aiPostRows", backstageRows.aiPosts, -1);
    renderFallbackNote("aiAssetRows");
    renderFallbackNote("aiPostRows");
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
  const query = new URLSearchParams({ period: currentSettlementPeriod(), take: "20" });
  if (append && state.cursor) query.set("cursor", state.cursor);
  try {
    const data = await backstageFetch(adminApiPath(`/backstage/operations/settlement-preview?${query}`), { auth: true });
    const page = normalizePage(data);
    const notice = document.getElementById("settlementNotice");
    if (notice) {
      notice.textContent = data?.notice || "정산 데이터는 예상치/확정 전입니다. 실제 지급 확정 전 환불, 차지백, 세무, 운영 확인이 필요합니다.";
    }
    const rows = page.items.map((item) => {
      const financials = item.financials || {};
      return [
        item.artist?.displayName || item.artist?.name || item.artist?.slug || "-",
        creatorNames(item.creators),
        formatCount(item.eventCount || 0),
        `${formatCount(item.grossLumina || 0)}L`,
        krw(financials.grossRevenueKrw || 0),
        krw(settlementDeductions(financials)),
        krw(financials.creatorShareKrw || 0),
        localizeSettlementStatus(item.status),
        "확정 전"
      ];
    });
    state.rows = append ? state.rows.concat(rows) : rows;
    state.cursor = page.nextCursor;
    state.hasMore = page.hasMore;
    setLoadMore("settlement", page.hasMore);
    if (state.rows.length) renderRows("settlementRows", state.rows, 7);
    else renderLoadingRow("settlementRows", "표시할 정산 예상치가 없습니다.");
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
    if (section?.id === "users") {
      loadUsersSection();
      return;
    }
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
  if (section?.id === "users") {
    loadUsersSection();
    return;
  }
  if (section) applyTableSearch(section, input.value);
});

detailCloseButton.addEventListener("click", () => {
  document.querySelectorAll("tr.is-selected").forEach((row) => row.classList.remove("is-selected"));
  detailPanel.classList.add("is-hidden");
  selectedDetail = null;
});

document.querySelectorAll("[data-detail-action]").forEach((button) => {
  button.addEventListener("click", () => openConfirmModal(button.dataset.detailAction));
});

confirmCancelButton.addEventListener("click", closeConfirmModal);
confirmRunButton.addEventListener("click", runPreparedAction);
confirmModal.addEventListener("click", (event) => {
  if (event.target === confirmModal) closeConfirmModal();
});

detailPanel.addEventListener("click", (event) => {
  if (event.target !== detailPanel) return;
  document.querySelectorAll("tr.is-selected").forEach((row) => row.classList.remove("is-selected"));
  detailPanel.classList.add("is-hidden");
  selectedDetail = null;
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


