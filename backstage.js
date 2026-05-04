const BACKSTAGE_API_BASE = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
const BACKSTAGE_BASE_HAS_API_PREFIX = /\/api\/v1$/.test(BACKSTAGE_API_BASE);
const BACKSTAGE_AUTH_KEY = "lumina_backstage_auth";
const BACKSTAGE_SECTION_KEY = "lumina_backstage_active_section";
const BACKSTAGE_DRAFT_KEY = "lumina_backstage_detail_drafts";

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
const detailForm = document.getElementById("detailForm");
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
  "검토중": "is-review",
  "확인중": "is-review",
  "제작중": "is-review",
  "승인": "is-approved",
  "통과": "is-approved",
  "조치완료": "is-approved",
  "전달완료": "is-approved",
  "보류": "is-hold",
  "재검토": "is-hold",
  "보관": "is-hold",
  "숨김": "is-blocked",
  "정지": "is-blocked",
  "차단": "is-blocked",
  "반려": "is-blocked",
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
    ["serinist_01", "user01@example.com", "Email", "1,240L", "38,000원", "0 / 1", "0", "6 / 1", "어제", "공개", "7일 정지"],
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
    ["watch_user", "외부 결제 유도", "3회", "정지", "30일 정지", "상세"],
    ["fast_like_22", "비정상 좋아요 패턴", "2회", "확인중", "알림 발송", "상세"],
    ["spam_reply", "반복 댓글", "5회", "주의", "댓글 제한", "상세"],
    ["charge_abuse", "결제 취소 반복", "2회", "확인중", "결제 확인", "상세"],
    ["dm_linker", "외부 링크 유도", "1회", "주의", "수정 안내", "상세"],
    ["refund_watch", "환불 악용 의심", "2회", "확인중", "정산 보류", "상세"],
    ["report_noise", "허위 신고 반복", "4회", "주의", "신고 제한", "상세"],
    ["fan_badword", "공격 표현", "3회", "정지", "숨김 처리", "상세"],
    ["bot_like", "자동화 의심", "6회", "정지", "삭제 후보", "상세"],
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
  creatorImageRequests: [
    ["프로필 이미지", "Min Stage", "김민서", "100L", "0/3회", "접수", "대기", "0장", "상세"],
    ["피드 이미지", "Harin", "박하린", "100L", "1/3회", "제작중", "확인중", "2장", "결과 반영"],
    ["숏폼 썸네일", "Doyun", "이도윤", "100L", "3/3회", "보완필요", "재검토", "1장", "보류"]
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
  moderationReports: [
    ["MR-001", "유저", "serinist_01", "외부 연락 유도", "접수", "오픈채팅 패턴", "검토"],
    ["MR-002", "댓글", "watch_user", "괴롭힘/공격 표현", "검토중", "반복 표현", "조치"],
    ["MR-003", "아티스트", "fan_04", "권리 침해", "보관", "중복 신고", "상세"]
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
  studioSettlement: [
    {
      row: ["studio_lumi", "스튜디오 운영자", "2명", "5,000L", "100,000원", "50,000원", "50,000원", "예상치", "캐릭터별 보기"],
      children: [
        ["A캐릭터", "18", "2,000L", "40,000원", "20,000원", "20,000원"],
        ["B캐릭터", "13", "3,000L", "60,000원", "30,000원", "30,000원"]
      ]
    }
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
  creatorImageRequestRows: { type: "이미지 제작 요청", labels: ["요청", "아티스트", "요청자", "차감", "재조정", "상태", "검수", "결과", "권장 액션"] },
  aiCreatorRows: { type: "AI 아티스트", labels: ["아티스트", "분류", "만든 관리자", "프로필", "이미지", "상태", "권장 액션"] },
  aiAssetRows: { type: "AI 아티스트 에셋", labels: ["아티스트", "커버", "썸네일", "포토갤러리", "숏폼", "업로드 규칙", "권장 액션"] },
  aiPostRows: { type: "AI 아티스트 콘텐츠", labels: ["아티스트", "피드 글", "프로필 문구", "채팅", "프리미엄", "권장 액션"] },
  moderationRows: { type: "크리에이터 콘텐츠", labels: ["콘텐츠", "작성자", "관리 사유", "상태", "권장 액션"] },
  moderationReportRows: { type: "범용 신고 큐", labels: ["신고", "대상", "신고자", "사유", "상태", "메모", "권장 액션"] },
  contentAnomalyRows: { type: "이상 패턴", labels: ["콘텐츠", "작성자", "탐지 신호", "위험도", "권장 액션"] },
  reportCancelRows: { type: "취소/철회 신고", labels: ["신고", "대상", "신고자", "상태", "사유", "권장 액션"] },
  studioSettlementRows: { type: "스튜디오 운영자 정산", labels: ["운영자", "정산 유형", "캐릭터", "루미나", "총매출", "차감", "정산금", "상태", "권장 액션"] },
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

function getSavedSection() {
  try {
    const sectionId = localStorage.getItem(BACKSTAGE_SECTION_KEY) || "overview";
    return document.getElementById(sectionId) ? sectionId : "overview";
  } catch {
    return "overview";
  }
}

function getCurrentSection() {
  return document.querySelector(".dashboard-main")?.getAttribute("data-active-section") || getSavedSection();
}

function saveActiveSection(sectionId) {
  try {
    localStorage.setItem(BACKSTAGE_SECTION_KEY, sectionId);
  } catch {
    // Ignore storage failures; navigation still works without persistence.
  }
}

function readDetailDrafts() {
  try {
    return JSON.parse(localStorage.getItem(BACKSTAGE_DRAFT_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeDetailDrafts(drafts) {
  try {
    localStorage.setItem(BACKSTAGE_DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    // Draft persistence is a convenience feature; ignore storage failures.
  }
}

function detailDraftKey(detail) {
  const row = detail?.row || [];
  return [detail?.tableId || "quickAction", row[0] || "new", row[1] || ""].join(":");
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
  target.innerHTML = rows.map((entry, rowIndex) => {
    const row = Array.isArray(entry) ? entry : entry.row || [];
    const children = Array.isArray(entry) ? [] : entry.children || [];
    const rowMeta = Array.isArray(entry) ? {} : entry.meta || {};
    const cells = row.map((cell, index) => {
      const label = meta.labels?.[index] || "";
      const isSettlementAmount = label === "정산금";
      const childToggle = children.length && (targetId === "settlementRows" || targetId === "studioSettlementRows") && index === 0
        ? `<button class="row-toggle" type="button" data-settlement-toggle="${targetId}-${rowIndex}" aria-expanded="false">펼침</button>`
        : "";
      const content = index === statusIndex
        ? statusBadge(cell)
        : isSettlementAmount
          ? `<strong class="settlement-amount">${cell}</strong>`
          : cell;
      if (index === row.length - 1) {
        const payload = encodeURIComponent(JSON.stringify({ tableId: targetId, type: meta.type, labels: meta.labels, row, meta: rowMeta }));
        return `<td><button class="row-action" type="button" data-detail="${payload}">${content}</button></td>`;
      }
      return `<td${isSettlementAmount ? ' class="settlement-cell"' : ""}>${childToggle}${content}</td>`;
    }).join("");
    const childRows = children.length
      ? `<tr class="settlement-child-row is-hidden" data-settlement-child="${targetId}-${rowIndex}"><td colspan="${row.length}">${renderSettlementChildren(children)}</td></tr>`
      : "";
    return `<tr data-table-id="${targetId}">${cells}</tr>${childRows}`;
  }).join("");
}

function renderSettlementChildren(children = []) {
  const rows = children.map((child) => `
    <tr>
      <td>${child[0] || "-"}</td>
      <td>${child[1] || "0"}</td>
      <td>${child[2] || "0L"}</td>
      <td>${child[3] || "0원"}</td>
      <td>${child[4] || "0원"}</td>
      <td class="settlement-cell"><strong class="settlement-amount">${child[5] || "0원"}</strong></td>
    </tr>
  `).join("");
  return `
    <div class="settlement-breakdown">
      <strong>캐릭터별 정산 내역</strong>
      <table>
        <thead><tr><th>캐릭터</th><th>이벤트</th><th>루미나</th><th>총매출</th><th>차감</th><th>정산금</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
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

function won(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
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

function settlementMath(financials = {}, fallback = {}) {
  const gross = won(financialValue(financials, ["grossRevenueKrw"]) || fallback.grossRevenueKrw || 0);
  const explicit = won(financialValue(financials, ["creatorShareKrw", "settlementKrw"]) || fallback.settlementKrw || 0);
  if (explicit > 0) {
    return {
      gross,
      deductions: won(Math.max(0, gross - explicit)),
      settlement: explicit
    };
  }
  const deductions = won(settlementDeductions(financials) || fallback.deductionsKrw || 0);
  return {
    gross,
    deductions,
    settlement: won(Math.max(0, gross - deductions))
  };
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

function settlementChildrenFromItem(item = {}) {
  const source = item.artists || item.artistSettlements || item.artistBreakdown || item.children || item.items || [];
  if (!Array.isArray(source)) return [];
  return source.map((child) => {
    const financials = child.financials || {};
    const math = settlementMath(financials, child);
    return [
      child.artist?.displayName || child.artist?.name || child.displayName || child.name || child.slug || "-",
      formatCount(child.eventCount || 0),
      `${formatCount(child.grossLumina || 0)}L`,
      krw(math.gross),
      krw(math.deductions),
      krw(math.settlement)
    ];
  });
}

function isStudioSettlementItem(item = {}) {
  const typeText = [
    item.type,
    item.creatorType,
    item.accountType,
    item.settlementType,
    item.creator?.type,
    item.creator?.creatorType
  ].filter(Boolean).join(" ").toLowerCase();
  return /studio|partner_studio|studio_operator|스튜디오/.test(typeText) || settlementChildrenFromItem(item).length > 0;
}

function settlementRowFromItem(item = {}, studio = false) {
  const financials = item.financials || item.totals || {};
  const math = settlementMath(financials, item);
  const actorName = studio
    ? item.partner?.displayName || item.partner?.publicHandle || item.partner?.email || item.creator?.displayName || item.creator?.name || creatorNames(item.creators) || item.operator?.displayName || "-"
    : item.artist?.displayName || item.artist?.name || item.artist?.slug || "-";
  return [
    actorName,
    studio ? "스튜디오 운영자" : creatorNames(item.creators),
    studio ? `${settlementChildrenFromItem(item).length || item.operatedArtistCount || item.artistCount || 0}명` : formatCount(item.eventCount || 0),
    `${formatCount(item.grossLumina || item.totals?.grossLumina || 0)}L`,
    krw(math.gross),
    krw(math.deductions),
    krw(math.settlement),
    localizeSettlementStatus(item.payoutStatus || item.status),
    studio ? "캐릭터별 보기" : "확정 전"
  ];
}

function settlementKeyFromItem(item = {}, studio = false) {
  return firstValue(
    item.settlementId,
    item.partnerSettlementId,
    item.payoutId,
    item.id,
    item.settlementKey,
    studio
      ? `studio:${firstValue(item.partner?.id, item.partnerUserId, item.creator?.id, item.creatorUserId, item.partner?.email, "unknown")}:${firstValue(item.period, currentSettlementPeriod())}`
      : `creator:${firstValue(item.artist?.id, item.artistId, item.artist?.slug, "unknown")}:${firstValue(item.creatorUserId, item.creators?.[0]?.id, "unknown")}:${firstValue(item.period, currentSettlementPeriod())}`
  );
}

function settlementMetaFromItem(item = {}, studio = false) {
  const financials = item.financials || item.totals || {};
  const math = settlementMath(financials, item);
  return {
    settlementKey: settlementKeyFromItem(item, studio),
    settlementType: studio ? "studio_operator" : "user_creator",
    period: firstValue(item.period, currentSettlementPeriod()),
    artistId: firstValue(item.artist?.id, item.artistId),
    artistName: firstValue(item.artist?.displayName, item.artist?.name, item.artist?.slug),
    creatorUserId: firstValue(item.creatorUserId, item.creators?.[0]?.id),
    partnerUserId: firstValue(item.partner?.id, item.partnerUserId, item.creator?.id),
    grossRevenueKrw: math.gross,
    deductionsKrw: math.deductions,
    settlementKrw: math.settlement,
    identityVerification: item.identityVerification || item.verification || item.kyc || {},
    payoutAccount: item.payoutAccount || item.bankAccount || {},
    payoutException: item.payoutException || item.exceptionApproval || {},
    payoutEligibility: item.payoutEligibility || item.eligibility || {}
  };
}

function settlementEntryFromItem(item = {}, studio = false) {
  return {
    row: settlementRowFromItem(item, studio),
    children: settlementChildrenFromItem(item),
    meta: settlementMetaFromItem(item, studio)
  };
}

function localizeCreatorImageType(type) {
  const typeMap = {
    profile_image: "프로필 이미지",
    content_image: "콘텐츠 이미지",
    feed_image: "피드 이미지",
    shortform_thumbnail: "숏폼 썸네일",
    concept_reference: "콘셉트 레퍼런스"
  };
  return typeMap[type] || type || "-";
}

function localizeCreatorImageStatus(status) {
  const statusMap = {
    submitted: "접수",
    reviewing: "확인중",
    generating: "제작중",
    needs_more_info: "보완필요",
    delivered: "전달완료",
    approved: "승인",
    rejected: "반려",
    archived: "보관"
  };
  return statusMap[status] || localizeWorkflowStatus(status);
}

function localizeModerationStatus(status) {
  const statusMap = {
    pending: "대기",
    cleared: "통과",
    blocked: "차단",
    needs_review: "재검토"
  };
  return statusMap[status] || localizeWorkflowStatus(status);
}

function localizeReportStatus(status) {
  const statusMap = {
    submitted: "접수",
    reviewing: "검토중",
    resolved: "조치완료",
    dismissed: "반려",
    archived: "보관"
  };
  return statusMap[status] || localizeWorkflowStatus(status);
}

function localizeReportReason(reason) {
  const reasonMap = {
    sexual_content: "선정적 콘텐츠",
    harassment: "괴롭힘/공격 표현",
    hate: "혐오 표현",
    impersonation: "사칭",
    spam: "스팸/반복 홍보",
    external_contact: "외부 연락 유도",
    external_payment: "외부 결제 유도",
    rights_violation: "권리 침해",
    other: "기타"
  };
  return reasonMap[reason] || reason || "-";
}

function localizeReportTarget(targetType) {
  const targetMap = {
    feed_post: "피드 글",
    community_post: "피드 글",
    reply: "댓글",
    community_reply: "댓글",
    user: "유저",
    artist: "아티스트"
  };
  return targetMap[targetType] || targetType || "-";
}

function reportReporter(report = {}) {
  return report.reporter?.profile?.displayName ||
    report.reporter?.profile?.publicHandle ||
    report.reporter?.email ||
    report.reporterUserId?.slice?.(0, 8) ||
    "-";
}

function creatorImageCostLabel(request = {}) {
  const metadata = request.metadata || {};
  const lumina = metadata.costLumina || metadata.priceLumina || metadata.luminaCost || 100;
  return `${formatCount(lumina)}L`;
}

function creatorImageRevisionLabel(request = {}) {
  const metadata = request.metadata || {};
  const used = metadata.revisionsUsed ?? metadata.revisionUsed ?? metadata.revisionCount ?? 0;
  const limit = metadata.revisionLimit ?? metadata.maxRevisions ?? 3;
  return `${formatCount(used)}/${formatCount(limit)}회`;
}

function creatorImageRequester(request = {}) {
  return request.requester?.profile?.displayName ||
    request.requester?.profile?.publicHandle ||
    request.requester?.email ||
    request.requesterUserId?.slice?.(0, 8) ||
    "-";
}

function localizeSettlementStatus(status) {
  const statusMap = {
    estimated: "예상치",
    no_revenue: "매출없음",
    ready: "지급대기",
    confirmed: "완료",
    paid: "지급완료",
    hold: "보류",
    recheck: "재확인",
    cancelled: "취소"
  };
  return statusMap[status] || localizeWorkflowStatus(status);
}

function localizePayoutCheck(value, fallback = "확인 필요") {
  const text = String(value ?? "").toLowerCase();
  if (["verified", "approved", "matched", "ready", "true", "yes"].includes(text)) return "확인 완료";
  if (["pending", "reviewing", "needs_review"].includes(text)) return "확인중";
  if (["rejected", "blocked", "mismatch", "false", "no"].includes(text)) return "불일치/차단";
  return value ? String(value) : fallback;
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
  renderDetailForm(detail);
  detailMemo.value = "";
  updateDetailActions(detail);
}

function openQuickAction(button) {
  const label = button.textContent.trim();
  const section = button.closest(".section-block");
  const sectionTitle = section?.querySelector(".section-title h2")?.textContent?.trim() || "백스테이지";
  const cardTitle = button.closest(".table-card")?.querySelector("h3")?.textContent?.trim() || sectionTitle;

  const actionMap = {
    "운영자 추가": ["운영자 계정 초대", "역할은 최상 관리자, 회계 관리자, 영업/섭외 관리자, CS 관리자, AI 아티스트 관리자 중 하나로 선택합니다.", "POST /admin/api/v1/admin-users"],
    "이력 보기": ["권한 변경 이력", "MVP에서는 super_admin 직접 변경과 audit log 중심으로 관리합니다. 2인 승인/요청함은 운영자가 늘어난 뒤 추가합니다.", "GET /admin/api/v1/audit-events?action=admin"],
    "전체 보기": ["목록 전체 보기", "현재 표의 필터를 초기화하고 전체 더미 데이터를 다시 보여줍니다.", "GET list endpoint with cursor"],
    "위험만 보기": ["위험 항목 필터", "신고, 정지, 높은 위험도 항목만 남겨서 봅니다.", "GET list endpoint with risk filter"],
    "데뷔 신청 보기": ["데뷔 신청 목록", "신청서에 기재한 활동명, 소개, 연락 가능 시간, 자료 링크, 권리 확인 내용을 모두 보여줄 자리입니다.", "GET /admin/api/v1/debut/applications"],
    "요청 보기": ["이미지 제작 요청", "유저 아티스트가 요청한 프로필/피드/숏폼 썸네일 제작 큐를 봅니다. 1차 정책은 100L, 재조정 3회, 최종 1장 기준입니다.", "GET /admin/api/v1/creator-image-requests"],
    "AI 아티스트 추가": ["AI 아티스트 추가", "캐릭터 기본 정보, 만든 관리자, 공개 상태, 초기 프로필/에셋 체크리스트를 등록합니다.", "POST /admin/api/v1/artists"],
    "업로드 추가": ["AI 에셋 업로드", "아티스트와 슬롯을 먼저 선택합니다. cover/thumb은 자동 판단하지 않고 운영자가 지정합니다.", "POST /admin/api/v1/artists/:artistId/assets/upload-intents"],
    "글 작성": ["AI 아티스트 글 작성", "아티스트를 선택하고 피드/프로필/공지/프리미엄 글 유형을 골라 작성합니다.", "POST /admin/api/v1/artists/:artistId/content"],
    "대상 설정": ["집중 관리 대상 설정", "신규 7일 모니터링, 신고 누적, 장기 미접속 등 관리 사유를 붙입니다.", "POST /admin/api/v1/creator-content/watchlist"],
    "신고 큐 보기": ["범용 신고 큐", "유저, 댓글, 피드 글, 아티스트 신고를 한 표에서 확인합니다.", "GET /admin/api/v1/moderation/reports"],
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

function applySectionFilter(button) {
  const section = button.closest(".section-block");
  if (!section) return;
  const term = button.dataset.sectionFilter || button.textContent.trim();
  section.querySelectorAll(".section-filter-row .filter-chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip === button);
  });
  const keyword = term === "전체" ? "" : term.toLowerCase();
  section.querySelectorAll("tbody tr").forEach((row) => {
    if (row.classList.contains("settlement-child-row")) return;
    row.classList.toggle("is-filtered-hidden", Boolean(keyword) && !row.textContent.toLowerCase().includes(keyword));
  });
}

function handleInlineAction(button) {
  const action = button.dataset.inlineAction;
  const help = document.querySelector(".detail-help");
  if (action === "tone-preview") {
    const source = detailForm?.querySelector('[name="body"]')?.value?.trim();
    if (help) {
      help.textContent = source
        ? `톤앤매너 변환 미리보기는 API 연결 전입니다. 현재 원문 ${source.length}자를 기준으로 캐릭터 말투 변환 요청 payload를 만들 수 있어요.`
        : "원문을 입력하면 톤앤매너 변환 미리보기 payload를 확인할 수 있어요.";
    }
    return;
  }
  if (action === "auto-schedule" && help) {
    help.textContent = "자동 작성은 3시간 간격, 하루 최대 4회, 6시간 이상 미작성 경고 기준으로 차모 API 확정 후 연결합니다.";
  }
}

function detailInput(label, name, value = "", type = "text", wide = false) {
  return `<label class="${wide ? "is-wide" : ""}"><span>${label}</span><input type="${type}" name="${name}" value="${value}"></label>`;
}

function detailFile(label, name, hint = "") {
  return `<label><span>${label}</span><input type="file" name="${name}" accept="image/*">${hint ? `<small>${hint}</small>` : ""}</label>`;
}

function detailSelect(label, name, options, selected = "", wide = false) {
  const items = options.map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const text = typeof option === "string" ? option : option.label;
    return `<option value="${value}"${value === selected ? " selected" : ""}>${text}</option>`;
  }).join("");
  return `<label class="${wide ? "is-wide" : ""}"><span>${label}</span><select name="${name}">${items}</select></label>`;
}

function detailTextarea(label, name, value = "", wide = true) {
  return `<label class="${wide ? "is-wide" : ""}"><span>${label}</span><textarea name="${name}">${value}</textarea></label>`;
}

function detailToggleGroup(label, name, options = []) {
  const items = options.map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const text = typeof option === "string" ? option : option.label;
    const checked = typeof option === "object" && option.checked ? " checked" : "";
    return `<label class="toggle-item"><input type="checkbox" name="${name}" value="${value}"${checked}><span>${text}</span></label>`;
  }).join("");
  return `<fieldset class="toggle-group is-wide"><legend>${label}</legend><div>${items}</div></fieldset>`;
}

function restoreDetailDraft(key) {
  const draft = readDetailDrafts()[key];
  if (!draft || !detailForm) return;
  detailForm.querySelectorAll("input, select, textarea").forEach((field) => {
    if (!field.name || draft[field.name] === undefined) return;
    if (field.type === "checkbox") {
      field.checked = Array.isArray(draft[field.name]) ? draft[field.name].includes(field.value) : Boolean(draft[field.name]);
      return;
    }
    if (field.type === "file") return;
    field.value = draft[field.name];
  });
}

function saveDetailDraft() {
  if (!detailForm || detailForm.classList.contains("is-hidden")) return;
  const key = detailForm.dataset.draftKey;
  if (!key) return;
  const drafts = readDetailDrafts();
  drafts[key] = collectDetailFormData() || {};
  writeDetailDrafts(drafts);
}

function renderDetailForm(detail) {
  if (!detailForm) return;
  detailForm.classList.add("is-hidden");
  detailForm.innerHTML = "";
  detailForm.dataset.draftKey = "";

  const row = detail?.row || [];
  const quickTitle = row[0] || "";
  const tableId = detail?.tableId;
  let html = "";

  if (quickTitle === "AI 아티스트 추가" || tableId === "aiCreatorRows") {
    html = `
      <h3>AI 아티스트 기본 정보</h3>
      <div class="detail-form-grid">
        ${detailInput("아티스트명", "displayName", tableId === "aiCreatorRows" ? row[0] || "" : "")}
        ${detailInput("Slug", "slug", detail?.meta?.slug || "")}
        ${tableId === "aiCreatorRows" ? detailInput("Artist ID", "artistId", detail?.meta?.artistId || "") : ""}
        ${detailSelect("카테고리", "category", [
          { value: "artist", label: "아티스트" },
          { value: "model", label: "모델" },
          { value: "actor", label: "배우" },
          { value: "entertainer", label: "엔터테이너" },
          { value: "sports", label: "스포츠" }
        ], detail?.meta?.category || "artist")}
        ${detailSelect("공개 상태", "status", [
          { value: "draft", label: "비공개/작성중" },
          { value: "debut_pending", label: "데뷔 예정" },
          { value: "public", label: "공개" }
        ], detail?.meta?.status || "draft")}
        ${detailInput("만든 관리자", "createdBy", getBackstageAuth()?.user?.email || getBackstageAuth()?.user?.displayName || "현재 로그인 운영자")}
        ${detailInput("대표 컬러", "brandColor", "")}
        ${detailInput("생년월일", "birthDate", "", "date")}
        ${detailInput("출신지", "hometown", "")}
        ${detailInput("신체", "height", "", "text")}
        ${detailInput("혈액형", "bloodType", "")}
        ${detailInput("포지션", "position", "")}
        ${detailInput("데뷔", "debut", "Lumina Stage 신규 후보")}
        ${detailInput("캐릭터타입", "characterType", "")}
        ${detailInput("팬덤명", "fandomName", "")}
        ${detailInput("팬포인트", "fanPoint", "", "text", true)}
        ${detailInput("시그니처", "signature", "", "text", true)}
        ${detailInput("광고축", "adAxis", "", "text", true)}
        ${detailInput("MBTI", "mbti", "")}
        ${detailInput("취미", "hobby", "")}
        ${detailInput("좋아하는 선물", "favoriteGift", "", "text", true)}
        ${detailFile("전신샷 업로드", "coverImage", "사이트 커버/전신샷 슬롯")}
        ${detailFile("프로필 메인샷 업로드", "thumbImage", "아티스트 카드/썸네일 슬롯")}
      </div>
      <p class="detail-form-note">핵심 프로필은 사이트 반영을 쉽게 하기 위해 개별 필드로 저장합니다. 만든 관리자는 로그인 계정 기준으로 자동 연결합니다.</p>
    `;
  } else if (quickTitle === "운영자 계정 초대" || tableId === "adminRows" || tableId === "adminRequestRows") {
    html = `
      <h3>운영자 계정/권한</h3>
      <div class="detail-form-grid">
        ${detailInput("이메일", "email", tableId === "adminRows" ? row[0] || "" : "", "email")}
        ${detailInput("이름/표시명", "displayName", "")}
        ${detailSelect("상태", "status", [
          { value: "invited", label: "초대중" },
          { value: "active", label: "승인" },
          { value: "disabled", label: "비활성" }
        ], tableId === "adminRows" && row[2] === "승인" ? "active" : "invited")}
        ${detailInput("최근 접속", "lastSeenAt", tableId === "adminRows" ? row[3] || "-" : "-", "text")}
        ${detailToggleGroup("권한", "roles", [
          { value: "super_admin", label: "최상 관리자", checked: row.join(" ").includes("최상") },
          { value: "commerce_admin", label: "회계 관리자", checked: row.join(" ").includes("회계") || row.join(" ").includes("정산") },
          { value: "partner_admin", label: "영업/섭외 관리자", checked: row.join(" ").includes("영업") || row.join(" ").includes("섭외") },
          { value: "cs_admin", label: "CS 관리자", checked: row.join(" ").includes("CS") || row.join(" ").includes("신고") },
          { value: "artist_ops_admin", label: "AI 아티스트 관리자", checked: row.join(" ").includes("AI") }
        ])}
        ${detailTextarea("인수인계/권한 변경 메모", "handoffNote", "담당자 퇴사, 권한 변경 사유, 인수인계 범위를 남깁니다.")}
      </div>
      <p class="detail-form-note">운영자 권한은 드롭다운이 아니라 토글로 관리합니다. 저장 시 선택된 첫 권한이 실제 운영자 역할로 반영됩니다.</p>
    `;
  } else if (quickTitle === "AI 에셋 업로드" || tableId === "aiAssetRows") {
    html = `
      <h3>이미지/영상 슬롯 지정</h3>
      <div class="detail-form-grid">
        ${detailInput("아티스트", "artist", tableId === "aiAssetRows" ? row[0] || "" : "")}
        ${detailInput("Artist ID", "artistId", detail?.meta?.artistId || "")}
        ${detailInput("기존 Asset ID", "assetId", detail?.meta?.assetId || "", "text", true)}
        ${detailSelect("슬롯", "slot", [
          { value: "cover", label: "커버" },
          { value: "thumbnail", label: "썸네일" },
          { value: "gallery", label: "포토갤러리" },
          { value: "shortform", label: "숏폼" }
        ], "cover")}
        ${detailInput("파일/외부 URL", "assetUrl", "", "url", true)}
        ${detailInput("정렬 순서", "sortOrder", "", "number")}
        ${detailSelect("대표 사용", "isPrimary", [
          { value: "yes", label: "대표로 사용" },
          { value: "no", label: "후보로 보관" }
        ], "yes")}
        ${detailSelect("이미지 조치", "assetAction", [
          { value: "attach", label: "슬롯에 연결" },
          { value: "archive", label: "잘못 올라간 사진 숨김/보관" },
          { value: "delete_request", label: "삭제 요청" },
          { value: "reorder", label: "순서 변경" }
        ], "attach")}
        ${detailFile("이미지/영상 파일", "assetFile", "업로드는 서버 asset URL 방식으로 연결 예정")}
        ${detailTextarea("에셋 메모", "assetMemo", "cover/thumb/gallery/shortform 슬롯을 운영자가 직접 지정합니다. 잘못 올라간 사진은 숨김/보관 또는 삭제 요청으로 분리합니다.")}
      </div>
      <p class="detail-form-note">이미지 보는 공간은 로컬 복사가 아니라 서버 asset 목록/URL 조회로 구성합니다. 포토갤러리는 sortOrder와 slot을 함께 저장해야 합니다.</p>
    `;
  } else if (quickTitle === "AI 아티스트 글 작성" || tableId === "aiPostRows") {
    html = `
      <h3>AI 아티스트 공식 글</h3>
      <div class="detail-form-grid">
        ${detailInput("아티스트", "artist", tableId === "aiPostRows" ? row[0] || "" : "")}
        ${detailSelect("글 유형", "contentType", [
          { value: "feed", label: "피드" },
          { value: "profile_copy", label: "프로필 문구" },
          { value: "notice", label: "공지" },
          { value: "premium", label: "프리미엄" }
        ], "feed")}
        ${detailInput("피드 제목(선택)", "title", "", "text", true)}
        ${detailTextarea("원문", "body", "피드는 제목 없이 본문 중심으로 작성할 수 있습니다. 캐릭터 톤앤매너에 맞춰 다듬습니다.")}
        <div class="inline-actions is-wide">
          <button class="secondary-action" type="button" data-inline-action="tone-preview">톤앤매너 변환 미리보기</button>
          <button class="secondary-action" type="button" data-inline-action="auto-schedule">3시간 자동 작성 정책 확인</button>
          <span>6시간 이상 글 작성이 없으면 운영 표에 표시합니다.</span>
        </div>
      </div>
      <p class="detail-form-note">담당 관리자는 담당 캐릭터만, 최상 관리자는 전체 캐릭터를 봅니다. AI 변환/자동 작성 API는 차모 #124 확인 후 연결합니다.</p>
    `;
  } else if (tableId === "userRows" || tableId === "userRiskRows") {
    html = `
      <h3>유저 제재/상태 확인</h3>
      <div class="detail-form-grid">
        ${detailInput("유저", "user", row[0] || "")}
        ${detailInput("이메일", "email", tableId === "userRows" ? row[1] || "" : "")}
        ${detailSelect("조치", "action", [
          { value: "none", label: "확인만" },
          { value: "suspend_7", label: "7일 일시정지" },
          { value: "suspend_14", label: "14일 일시정지" },
          { value: "suspend_30", label: "30일 일시정지" },
          { value: "delete_candidate", label: "삭제 후보 등록" }
        ], row.join(" ").includes("정지") ? "suspend_7" : "none")}
        ${detailInput("30일 정지 누적", "thirtyDayStrikeCount", "", "number")}
        ${detailTextarea("처리 사유", "reason", "세션 종료는 기본 액션에서 제외합니다. 30일 정지 2회 누적 시 삭제 후보로 올립니다.")}
      </div>
      <p class="detail-form-note">실수 위험이 큰 세션 종료 대신 기간형 일시정지를 기본 제재로 둡니다.</p>
    `;
  } else if (quickTitle === "데뷔 신청 목록" || tableId === "creatorRows") {
    html = `
      <h3>데뷔 신청 확인</h3>
      <div class="detail-form-grid">
        ${detailInput("신청자/활동명", "applicant", tableId === "creatorRows" ? row[0] || "" : "")}
        ${detailSelect("처리 상태", "applicationStatus", [
          { value: "reviewing", label: "확인중" },
          { value: "needs_revision", label: "보완요청" },
          { value: "approved", label: "승인" },
          { value: "rejected", label: "반려" }
        ], "reviewing")}
        ${detailInput("연락 가능 시간", "contactWindow", "", "text")}
        ${detailInput("자료 링크", "portfolioUrl", "", "url")}
        ${detailTextarea("보완/확인 메모", "reviewMemo", "활동명, 소개, 연락 가능 시간, 자료 링크, 권리 확인 내용을 확인합니다.")}
      </div>
      <p class="detail-form-note">연락처와 정산계좌는 권한별 마스킹 상태를 유지해야 합니다.</p>
    `;
  } else if (quickTitle === "이미지 제작 요청" || tableId === "creatorImageRequestRows") {
    html = `
      <h3>유저 아티스트 이미지 제작</h3>
      <div class="detail-form-grid">
        ${detailInput("요청 유형", "requestType", tableId === "creatorImageRequestRows" ? row[0] || "" : "프로필 이미지")}
        ${detailInput("아티스트", "artist", tableId === "creatorImageRequestRows" ? row[1] || "" : "")}
        ${detailInput("요청자", "requester", tableId === "creatorImageRequestRows" ? row[2] || "" : "")}
        ${detailInput("차감", "costLumina", tableId === "creatorImageRequestRows" ? row[3] || "100L" : "100L")}
        ${detailInput("재조정", "revisionState", tableId === "creatorImageRequestRows" ? row[4] || "0/3회" : "0/3회")}
        ${detailSelect("처리 상태", "status", [
          { value: "reviewing", label: "확인중" },
          { value: "generating", label: "제작중" },
          { value: "needs_more_info", label: "보완필요" },
          { value: "delivered", label: "전달완료" },
          { value: "approved", label: "승인" },
          { value: "rejected", label: "반려" }
        ], "reviewing")}
        ${detailSelect("검수 상태", "moderationStatus", [
          { value: "pending", label: "대기" },
          { value: "cleared", label: "통과" },
          { value: "needs_review", label: "재검토" },
          { value: "blocked", label: "차단" }
        ], "pending")}
        ${detailInput("결과 assetId", "resultAssetIds", "", "text", true)}
        ${detailTextarea("운영 메모", "adminNote", "100L 차감, 재조정 3회, 최종 이미지 1장 기준입니다. 주민번호/계약서/신분증/외부 연락처는 저장하지 않습니다.")}
      </div>
      <p class="detail-form-note">생성 결과는 resultAssetIds로 붙이고, 공개 프로필/피드/숏폼 반영은 별도 운영 결정으로 분리합니다.</p>
    `;
  } else if (quickTitle === "범용 신고 큐" || tableId === "moderationReportRows") {
    html = `
      <h3>범용 신고 처리</h3>
      <div class="detail-form-grid">
        ${detailInput("신고 ID", "reportId", tableId === "moderationReportRows" ? row[0] || "" : "")}
        ${detailInput("대상", "targetType", tableId === "moderationReportRows" ? row[1] || "" : "")}
        ${detailInput("신고자", "reporter", tableId === "moderationReportRows" ? row[2] || "" : "")}
        ${detailInput("사유", "reason", tableId === "moderationReportRows" ? row[3] || "" : "")}
        ${detailSelect("처리 상태", "status", [
          { value: "reviewing", label: "검토중" },
          { value: "resolved", label: "조치완료" },
          { value: "dismissed", label: "반려" },
          { value: "archived", label: "보관" }
        ], "reviewing")}
        ${detailInput("대상 ID", "targetId", "", "text")}
        ${detailTextarea("처리 메모", "detail", "신고 내용, 확인 근거, 조치 여부를 500자 이내로 남깁니다.")}
      </div>
      <p class="detail-form-note">범용 신고는 피드 글뿐 아니라 댓글, 유저, 아티스트까지 포함합니다. 전체 글 열람 대신 신고 대상과 사유 중심으로 확인합니다.</p>
    `;
  } else if (tableId === "moderationRows" || tableId === "contentAnomalyRows" || tableId === "reportCancelRows") {
    html = `
      <h3>크리에이터 콘텐츠 조치</h3>
      <div class="detail-form-grid">
        ${detailInput("콘텐츠", "contentId", row[0] || "")}
        ${detailInput("작성자", "creator", row[1] || "")}
        ${detailSelect("조치", "action", [
          { value: "confirm_clear", label: "확인 후 목록에서 제외" },
          { value: "hide", label: "숨김 처리" },
          { value: "delete", label: "삭제 처리" },
          { value: "restore", label: "수정 내용 확인 후 재게재" }
        ], "confirm_clear")}
        ${detailSelect("관리 기준", "watchRule", [
          { value: "new_creator_7d", label: "신규 7일 집중관리" },
          { value: "anomaly", label: "이상패턴" },
          { value: "restore_request", label: "숨김 해제/재게재 요청" }
        ], tableId === "reportCancelRows" ? "restore_request" : "new_creator_7d")}
        ${detailTextarea("원문/수정내용 비교", "contentReview", "사용자가 삭제했는지, 숨김 해제 요청인지, 수정 후 재게재 요청인지 구분해서 확인합니다.")}
      </div>
      <p class="detail-form-note">수정요청은 기본 액션에서 제외합니다. 숨김 시 작성자에게 수정 안내만 보내고, 확인 처리한 항목은 이상패턴 목록에서 제거합니다.</p>
    `;
  } else if (tableId === "settlementRows" || tableId === "studioSettlementRows") {
    const isStudio = tableId === "studioSettlementRows";
    const settlementKey = firstValue(detail?.meta?.settlementKey, `${isStudio ? "studio" : "creator"}:${row[0] || "unknown"}:${currentSettlementPeriod()}`);
    const amountKrw = Number(detail?.meta?.settlementKrw || String(row[6] || "").replace(/[^\d]/g, "") || 0);
    const identity = detail?.meta?.identityVerification || {};
    const account = detail?.meta?.payoutAccount || {};
    const exception = detail?.meta?.payoutException || {};
    const eligibility = detail?.meta?.payoutEligibility || {};
    const blockingReasons = Array.isArray(eligibility.blockingReasons) ? eligibility.blockingReasons.join(", ") : "";
    html = `
      <h3>${isStudio ? "스튜디오 운영자 정산 처리" : "유저 크리에이터 정산 처리"}</h3>
      <div class="detail-form-grid">
        ${detailInput("정산 키", "settlementKey", settlementKey, "text", true)}
        ${detailInput("정산 기간", "period", detail?.meta?.period || currentSettlementPeriod())}
        ${detailInput(isStudio ? "스튜디오 운영자" : "아티스트", "settlementTarget", row[0] || "")}
        ${detailInput(isStudio ? "캐릭터 수" : "제작자", "settlementOwner", row[1] || "")}
        ${detailInput("총매출", "grossRevenueLabel", row[4] || "0원")}
        ${detailInput("차감", "deductionsLabel", row[5] || "0원")}
        ${detailInput("정산금", "amountKrw", amountKrw, "number")}
        ${detailSelect("처리 상태", "settlementStatus", [
          { value: "ready", label: "정산대기" },
          { value: "paid", label: "정산완료" },
          { value: "hold", label: "정산보류" },
          { value: "recheck", label: "재확인" },
          { value: "cancelled", label: "취소" }
        ], "ready")}
        ${detailInput("입금일", "paidAt", "", "date")}
        ${detailInput("입금/전표 메모", "payoutReference", "", "text", true)}
        ${detailInput("본인인증", "identityStatus", localizePayoutCheck(identity.status || identity.verified), "text")}
        ${detailInput("본인인증 이름", "verifiedNameMasked", firstValue(identity.verifiedNameMasked, identity.nameMasked, "-"), "text")}
        ${detailInput("계좌 상태", "payoutAccountStatus", localizePayoutCheck(account.status || account.holderMatchesIdentity), "text")}
        ${detailInput("예금주", "accountHolderMasked", firstValue(account.accountHolderMasked, account.holderMasked, "-"), "text")}
        ${detailInput("타인 명의 예외", "payoutExceptionStatus", localizePayoutCheck(exception.status, "없음"), "text")}
        ${detailInput("지급 가능 여부", "canMarkPaid", eligibility.canMarkPaid === false ? "불가" : "확인 필요", "text")}
        ${detailSelect("회계 수동 확인", "eligibilityOverrideConfirmed", [
          { value: "yes", label: "본인인증/계좌/예외 사유를 확인했습니다" },
          { value: "no", label: "아직 확인하지 않았습니다" }
        ], "yes", true)}
        ${detailTextarea("차단/재확인 사유", "blockingReasons", blockingReasons || "본인인증, 예금주 일치, 타인 명의 예외 승인 여부를 확인합니다.")}
      </div>
      <p class="detail-form-note">첫 정산 전에 한 번만 입력해 주세요. 정산금 지급과 세무 신고 처리를 위해 세무 서류용 주소가 필요합니다. 주소는 암호화되어 안전하게 보관되며, 정산과 세무 처리에만 사용됩니다.</p>
    `;
  }

  if (!html) return;
  detailForm.innerHTML = html;
  detailForm.dataset.draftKey = detailDraftKey(detail);
  restoreDetailDraft(detailForm.dataset.draftKey);
  detailForm.classList.remove("is-hidden");
}

function getActionProfile(detail, action = "memo") {
  const tableId = detail?.tableId || "quickAction";
  const row = detail?.row || [];
  const quickTitle = row[0] || "";
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

  if (quickTitle === "운영자 계정 초대") {
    return {
      ...profile,
      group: "운영자 권한 관리",
      targetType: "adminUser",
      endpoint: "POST /admin/api/v1/admin-users",
      method: "POST",
      warning: "운영자 추가는 기존 가입 유저 이메일 또는 userId 기준으로 권한을 부여합니다. 역할 토글 중 첫 번째 선택 권한으로 저장합니다.",
      holdLabel: "초대 보류",
      dangerLabel: "운영자 추가",
      showHold: true,
      showDanger: true,
      dangerDisabled: false
    };
  }

  if (tableId === "adminRows") {
    return {
      ...profile,
      group: "운영자 권한 관리",
      targetType: "adminUser",
      endpoint: "PATCH /admin/api/v1/admin-users/:adminUserId",
      method: "PATCH",
      warning: "권한 변경은 운영 로그에 남습니다. 담당자 퇴사/인수인계 사유를 메모로 남긴 뒤 저장하세요.",
      holdLabel: "권한 변경 보류",
      dangerLabel: "권한 저장",
      showHold: true,
      showDanger: true,
      dangerDisabled: false
    };
  }

  if (quickTitle === "AI 아티스트 추가") {
    return {
      ...profile,
      group: "AI 아티스트 운영 액션",
      targetType: "aiArtist",
      endpoint: "POST /admin/api/v1/artists",
      method: "POST",
      warning: "핵심 프로필 필드를 개별 값으로 저장합니다. 공개 상태와 만든 관리자를 확인한 뒤 생성하세요.",
      holdLabel: "생성 보류",
      dangerLabel: "AI 아티스트 생성",
      showHold: true,
      showDanger: true,
      dangerDisabled: false
    };
  }

  if (quickTitle === "AI 에셋 업로드") {
    return {
      ...profile,
      group: "AI 아티스트 운영 액션",
      targetType: "aiArtistAsset",
      endpoint: "POST /admin/api/v1/assets/upload-intents + POST /admin/api/v1/artists/:artistId/assets",
      method: "POST",
      warning: "파일을 업로드 intent로 등록한 뒤 artist asset 슬롯에 연결합니다. cover/thumb/gallery/shortform 슬롯을 반드시 확인하세요.",
      holdLabel: "업로드 보류",
      dangerLabel: "에셋 업로드/연결",
      showHold: true,
      showDanger: true,
      dangerDisabled: false
    };
  }

  if (tableId === "userRows" || tableId === "userRiskRows") {
    const wantsRestore = rowAction.includes("복구");
    const wantsDelete = rowAction.includes("삭제") || rowAction.includes("탈퇴");
    return {
      ...profile,
      group: "유저 운영 액션",
      targetType: "user",
      endpoint: wantsRestore
        ? "POST /admin/api/v1/users/:userId/restore"
        : wantsDelete
          ? "POST /admin/api/v1/users/:userId/delete"
          : "POST /admin/api/v1/users/:userId/suspend",
      method: "POST",
      warning: "세션 종료는 기본 액션에서 제외합니다. 7/14/30일 정지와 삭제 후보 등록은 운영 로그와 사유가 반드시 필요합니다.",
      holdLabel: tableId === "userRiskRows" ? "보류/재확인 메모" : "상태 확인 메모",
      dangerLabel: wantsRestore ? "복구 요청" : wantsDelete ? "삭제 후보" : "일시정지",
      showHold: true,
      showDanger: true,
      dangerDisabled: false
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

  if (tableId === "creatorImageRequestRows") {
    const isRejected = status === "반려" || rowAction.includes("반려");
    return {
      ...profile,
      group: "유저 아티스트 이미지 제작",
      targetType: "creatorImageRequest",
      endpoint: action === "danger" ? "PATCH /admin/api/v1/creator-image-requests/:requestId" : "GET /admin/api/v1/creator-image-requests/:requestId",
      method: action === "danger" ? "PATCH" : "GET",
      warning: "이미지 제작 요청은 100L 차감, 재조정 3회, 최종 이미지 1장 기준입니다. 결과 에셋 공개 반영은 별도 결정으로 분리합니다.",
      holdLabel: "보완/보류 메모",
      dangerLabel: isRejected ? "반려 처리" : "상태/결과 반영",
      showHold: true,
      showDanger: true
    };
  }

  if (["moderationRows", "moderationReportRows", "contentAnomalyRows", "reportCancelRows", "riskRows"].includes(tableId)) {
    const isReport = tableId === "reportCancelRows";
    const isGenericReport = tableId === "moderationReportRows";
    const restore = rowAction.includes("복구") || status === "숨김";
    return {
      ...profile,
      group: "크리에이터 콘텐츠 조치",
      targetType: isReport || isGenericReport ? "report" : "creatorContent",
      endpoint: isGenericReport
        ? "PATCH /admin/api/v1/community/reports/:reportId"
        : isReport
        ? "POST /admin/api/v1/community/reports/:reportId/archive"
        : restore
          ? "POST /admin/api/v1/community/posts/:postId/restore"
          : "POST /admin/api/v1/community/posts/:postId/hide",
      method: isGenericReport ? "PATCH" : "POST",
      warning: "콘텐츠 숨김/복구/신고 보관은 사유와 대상 ID가 확정된 뒤 실행합니다. 전체 글 열람이 아니라 집중 관리 대상만 다룹니다.",
      holdLabel: "보류/재확인 메모",
      dangerLabel: isGenericReport ? "신고 상태 변경" : isReport ? "신고 보관" : restore ? "복구 실행" : "숨김/제재 검토",
      showHold: true,
      showDanger: true,
      dangerDisabled: false
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
      showDanger: true,
      dangerDisabled: isPost
    };
  }

  if (tableId === "settlementRows" || tableId === "studioSettlementRows") {
    return {
      ...profile,
      group: "정산 수동 처리",
      targetType: tableId === "studioSettlementRows" ? "studioSettlement" : "creatorSettlement",
      endpoint: "POST /admin/api/v1/backstage/settlements/:settlementKey/status",
      method: "POST",
      warning: "자동 송금이 아니라 회계 담당자가 실제 입금/보류/재확인 결과를 기록하는 액션입니다. 차모 #131 정산 상태 API 기준으로 저장합니다.",
      holdLabel: "정산 보류",
      dangerLabel: "정산 상태 저장",
      showHold: true,
      showDanger: true,
      dangerDisabled: false
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

function collectDetailFormData() {
  if (!detailForm || detailForm.classList.contains("is-hidden")) return null;
  const data = {};
  detailForm.querySelectorAll("input, select, textarea").forEach((field) => {
    if (!field.name) return;
    if (field.type === "checkbox") {
      if (!Array.isArray(data[field.name])) data[field.name] = [];
      if (field.checked) data[field.name].push(field.value);
      return;
    }
    if (field.type === "file") {
      data[field.name] = Array.from(field.files || []).map((file) => file.name);
      return;
    }
    data[field.name] = field.value;
  });
  return data;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function firstRoleName(roles = []) {
  const values = Array.isArray(roles) ? roles : [roles].filter(Boolean);
  return values[0] || "content_admin";
}

function normalizeArtistStatus(status) {
  const statusMap = {
    public: "active",
    active: "active",
    draft: "draft",
    debut_pending: "planned",
    planned: "planned",
    archived: "archived"
  };
  return statusMap[status] || status || "draft";
}

function normalizeSlotUsage(slot) {
  const slotMap = {
    thumbnail: "thumb",
    shortform: "shortform",
    gallery: "gallery",
    cover: "cover"
  };
  return slotMap[slot] || slot || "cover";
}

function buildArtistProfilePayload(form = {}) {
  return {
    birthDate: form.birthDate,
    hometown: form.hometown,
    height: form.height,
    bloodType: form.bloodType,
    position: form.position,
    debut: form.debut,
    characterType: form.characterType,
    fandomName: form.fandomName,
    fanPoint: form.fanPoint,
    signature: form.signature,
    adAxis: form.adAxis,
    representativeColor: form.brandColor,
    mbti: form.mbti,
    hobby: form.hobby,
    favoriteGift: form.favoriteGift
  };
}

function buildActionRequest(detail, action) {
  const tableId = detail?.tableId || "quickAction";
  const row = detail?.row || [];
  const meta = detail?.meta || {};
  const form = collectDetailFormData() || {};
  const note = detailMemo.value.trim();
  const reason = firstValue(form.reason, form.reviewMemo, form.adminNote, form.detail, note, "백스테이지 운영 처리");
  const quickTitle = row[0] || "";

  if (quickTitle === "운영자 계정 초대") {
    return {
      method: "POST",
      path: adminApiPath("/admin-users"),
      body: {
        email: form.email,
        userId: form.userId,
        roleName: firstRoleName(form.roles),
        status: form.status === "invited" ? "active" : form.status || "active",
        note: reason
      }
    };
  }

  if (tableId === "adminRows") {
    if (!meta.adminUserId) return null;
    return {
      method: "PATCH",
      path: adminApiPath(`/admin-users/${meta.adminUserId}`),
      body: {
        roleName: firstRoleName(form.roles),
        status: form.status === "disabled" ? "suspended" : form.status || "active",
        note: reason
      }
    };
  }

  if (tableId === "userRows" || tableId === "userRiskRows") {
    const userId = firstValue(meta.userId, form.userId);
    if (!userId) return null;
    const selectedAction = form.action || "";
    const wantsRestore = row[row.length - 1]?.includes?.("복구") || selectedAction === "restore";
    const wantsDelete = selectedAction === "delete_candidate" || row[row.length - 1]?.includes?.("삭제");
    const suspendDays = selectedAction.includes("30") ? 30 : selectedAction.includes("14") ? 14 : 7;
    return {
      method: "POST",
      path: adminApiPath(`/users/${userId}/${wantsRestore ? "restore" : wantsDelete ? "delete" : "suspend"}`),
      body: {
        reason,
        note,
        durationDays: wantsRestore || wantsDelete ? undefined : suspendDays,
        deleteCandidate: wantsDelete || undefined
      }
    };
  }

  if (quickTitle === "AI 아티스트 추가") {
    return {
      method: "POST",
      path: adminApiPath("/artists"),
      body: {
        displayName: form.displayName,
        slug: form.slug,
        status: normalizeArtistStatus(form.status),
        sortOrder: Number(form.sortOrder || 0),
        publicProfile: buildArtistProfilePayload(form),
        visualProfile: {
          representativeColor: form.brandColor,
          coverSlot: form.coverImage?.[0],
          thumbSlot: form.thumbImage?.[0]
        },
        contentProfile: {
          createdBy: form.createdBy,
          category: form.category,
          operatingNote: reason
        }
      }
    };
  }

  if (tableId === "aiCreatorRows") {
    const artistId = firstValue(meta.artistId, form.artistId);
    if (!artistId) return null;
    return {
      method: "PATCH",
      path: adminApiPath(`/artists/${artistId}`),
      body: {
        displayName: firstValue(form.displayName, row[0]),
        status: normalizeArtistStatus(form.status || meta.status),
        publicProfile: buildArtistProfilePayload(form),
        visualProfile: {
          representativeColor: form.brandColor
        },
        contentProfile: {
          category: form.category,
          operatingNote: reason
        }
      }
    };
  }

  if (tableId === "aiAssetRows" || quickTitle === "AI 에셋 업로드") {
    const fileInput = detailForm?.querySelector('input[name="assetFile"]');
    const file = fileInput?.files?.[0] || null;
    const artistId = firstValue(meta.artistId, form.artistId);
    const assetId = firstValue(form.assetId, meta.assetId);
    if (form.assetAction === "archive" && assetId) {
      return {
        method: "POST",
        path: adminApiPath(`/assets/${assetId}/archive`),
        body: { reason, note, force: true }
      };
    }
    if (!artistId) return null;
    if (assetId) {
      return {
        method: "POST",
        path: adminApiPath(`/artists/${artistId}/assets`),
        body: {
          assetId,
          usageType: normalizeSlotUsage(form.slot),
          isPrimary: form.isPrimary !== "no",
          sortOrder: Number(form.sortOrder || 0),
          note: reason
        }
      };
    }
    if (file) {
      return {
        method: "UPLOAD_ASSET",
        path: adminApiPath("/assets/upload-intents"),
        file,
        artistId,
        body: {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSizeBytes: file.size,
          visibility: "public",
          metadata: { slot: normalizeSlotUsage(form.slot), note: reason }
        },
        linkBody: {
          usageType: normalizeSlotUsage(form.slot),
          isPrimary: form.isPrimary !== "no",
          sortOrder: Number(form.sortOrder || 0)
        }
      };
    }
    return null;
  }

  if (["moderationRows", "contentAnomalyRows"].includes(tableId)) {
    const postId = firstValue(meta.postId, form.postId, form.contentId);
    if (!postId) return null;
    const shouldRestore = form.action === "restore" || row[row.length - 1] === "복구";
    return {
      method: "POST",
      path: adminApiPath(`/community/posts/${postId}/${shouldRestore ? "restore" : "hide"}`),
      body: { reason, note, action: form.action || (shouldRestore ? "restore" : "hide") }
    };
  }

  if (tableId === "moderationReportRows") {
    const reportId = firstValue(meta.reportId, form.reportId);
    if (!reportId) return null;
    const actionMap = {
      resolved: "none",
      dismissed: "none",
      archived: "none",
      reviewing: "none",
      hide: "hide_post",
      restore: "restore_post"
    };
    return {
      method: "PATCH",
      path: adminApiPath(`/community/reports/${reportId}`),
      body: {
        status: form.status === "archived" ? "resolved" : form.status || "resolved",
        action: actionMap[form.action] || "none",
        reason,
        note,
        detail: firstValue(form.detail, note, reason),
        resolveMatchingReports: false
      }
    };
  }

  if (tableId === "reportCancelRows") {
    const postId = firstValue(meta.postId, form.targetId, form.contentId);
    if (!postId) return null;
    return {
      method: "POST",
      path: adminApiPath(`/community/posts/${postId}/restore`),
      body: { reason, note, action: "restore_request" }
    };
  }

  if (tableId === "settlementRows" || tableId === "studioSettlementRows") {
    const settlementKey = firstValue(meta.settlementKey, form.settlementKey);
    if (!settlementKey) return null;
    const status = action === "hold" ? "hold" : form.settlementStatus || "ready";
    return {
      method: "POST",
      path: adminApiPath(`/backstage/settlements/${encodeURIComponent(settlementKey)}/status`),
      body: {
        status,
        reason,
        note,
        paidAt: form.paidAt || undefined,
        paymentMethod: status === "paid" ? "bank_transfer" : undefined,
        payoutReference: firstValue(form.payoutReference, note),
        amountKrw: Number(form.amountKrw || meta.settlementKrw || 0),
        eligibilityOverrideConfirmed: status === "paid" ? form.eligibilityOverrideConfirmed === "yes" : undefined,
        period: form.period || meta.period || currentSettlementPeriod(),
        settlementType: meta.settlementType || (tableId === "studioSettlementRows" ? "studio_operator" : "user_creator")
      }
    };
  }

  return null;
}

function resolveExecutableEndpoint(endpoint = "", detail = null, action = "memo") {
  const mutation = action === "danger" ? buildActionRequest(detail, action) : null;
  if (mutation) return mutation;
  const match = String(endpoint).trim().match(/^(GET|POST|PATCH|DELETE)\s+(\/admin\/api\/v1\/\S+)$/);
  if (!match) return null;
  const [, method, fullPath] = match;
  if (method !== "GET" || fullPath.includes(":")) return null;
  return {
    method,
    path: adminApiPath(fullPath.replace(/^\/admin\/api\/v1/, "") || "/")
  };
}

function summarizeApiResult(data) {
  if (Array.isArray(data)) return `배열 ${data.length}건을 받았어요.`;
  if (data?.items) return `목록 ${data.items.length}건을 받았어요.${data.hasMore ? " 다음 페이지가 있어요." : ""}`;
  if (data && typeof data === "object") return `응답 키: ${Object.keys(data).slice(0, 8).join(", ") || "없음"}`;
  return "응답 본문 없이 성공했어요.";
}

async function runAssetUploadRequest(request) {
  const intent = await backstageFetch(request.path, {
    method: "POST",
    auth: true,
    body: request.body
  });
  const assetId = intent?.asset?.id || intent?.id;
  const upload = intent?.upload || {};
  if (!assetId) return intent;

  if (request.file && upload.url && upload.mode !== "metadata_only") {
    const response = await fetch(upload.url, {
      method: upload.method || "PUT",
      headers: upload.requiredHeaders || { "content-type": request.file.type || "application/octet-stream" },
      body: request.file
    });
    if (!response.ok) throw new Error(`파일 업로드 실패 (${response.status})`);
    await backstageFetch(adminApiPath(`/assets/${assetId}/confirm-upload`), {
      method: "POST",
      auth: true,
      body: { objectETag: response.headers.get("etag") || undefined }
    });
  }

  const link = await backstageFetch(adminApiPath(`/artists/${request.artistId}/assets`), {
    method: "POST",
    auth: true,
    body: {
      ...request.linkBody,
      assetId
    }
  });
  return { intent, link };
}

async function reloadCurrentSectionAfterAction() {
  const sectionId = getCurrentSection();
  await loadSection(sectionId);
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
  const apiRequest = resolveExecutableEndpoint(profile.endpoint, detail, action);
  const isMutation = apiRequest && apiRequest.method !== "GET";

  const base = {
    menu: detail.type,
    actionGroup: profile.group,
    targetType: profile.targetType,
    target,
    requestedAction: action === "danger" ? currentAction : action,
    method: profile.method,
    apiHint: profile.endpoint,
    status: isLocalOnly ? "프론트 임시 처리 가능" : apiRequest ? (isMutation ? "실행 API 연결 완료" : "조회 API 실행 가능") : "대상 ID 또는 필수값 확인 필요",
    bodyPreview: {
      targetType: profile.targetType,
      target,
      action: action === "danger" ? currentAction : action,
      form: collectDetailFormData(),
      reason: memo || "운영 메모 미입력",
      note: memo || "운영 메모 미입력"
    },
    note: memo || "운영 메모 미입력",
    warning: isLocalOnly
      ? "현재는 프론트에서 운영 메모 흐름만 확인합니다. 실제 저장 API가 확정되면 같은 payload로 연결합니다."
      : apiRequest
        ? (isMutation ? profile.warning : "조회성 API라 바로 실행할 수 있어요. 변경/제재/지급 같은 위험 액션은 별도 확정 전까지 잠가둡니다.")
      : profile.warning,
    canRunLocally: isLocalOnly,
    canRunApi: Boolean(apiRequest),
    apiRequest
  };
  return base;
}

function openConfirmModal(action) {
  const preview = buildActionPreview(action);
  if (!preview || !confirmModal) return;
  pendingActionPreview = preview;
  confirmType.textContent = preview.menu || "Confirm";
  const isMutation = preview.apiRequest && preview.apiRequest.method !== "GET";
  confirmTitle.textContent = action === "memo" ? "운영 메모 저장 확인" : action === "hold" ? "보류/재확인 확인" : preview.canRunApi ? (isMutation ? "실행 API 처리 확인" : "조회 API 실행 확인") : "실행 정보 확인 필요";
  confirmMessage.textContent = preview.warning;
  confirmPayload.textContent = JSON.stringify(preview, null, 2);
  confirmRunButton.textContent = preview.canRunLocally ? "프론트 메모 처리" : preview.canRunApi ? (isMutation ? "실행하기" : "조회 실행") : "필수값 확인 필요";
  confirmRunButton.disabled = !(preview.canRunLocally || preview.canRunApi);
  confirmModal.classList.remove("is-hidden");
}

function closeConfirmModal() {
  pendingActionPreview = null;
  confirmModal?.classList.add("is-hidden");
}

async function runPreparedAction() {
  if (!pendingActionPreview?.canRunLocally && !pendingActionPreview?.canRunApi) return;
  const help = document.querySelector(".detail-help");
  if (pendingActionPreview.canRunApi) {
    confirmRunButton.disabled = true;
    const request = pendingActionPreview.apiRequest;
    const isMutation = request.method !== "GET";
    confirmRunButton.textContent = isMutation ? "처리 중..." : "조회 중...";
    try {
      const data = request.method === "UPLOAD_ASSET"
        ? await runAssetUploadRequest(request)
        : await backstageFetch(request.path, {
          method: request.method,
          auth: true,
          body: request.method === "GET" ? undefined : request.body
        });
      const summary = summarizeApiResult(data);
      confirmMessage.textContent = `${isMutation ? "처리" : "조회"} 완료: ${summary}`;
      confirmPayload.textContent = JSON.stringify({ ...pendingActionPreview, resultSummary: summary, result: data }, null, 2);
      confirmRunButton.textContent = isMutation ? "처리 완료" : "조회 완료";
      if (help) help.textContent = `${pendingActionPreview.actionGroup} ${isMutation ? "실행" : "조회"} API를 실행했어요. 화면 반영이 필요한 목록은 새로고침으로 다시 불러올 수 있습니다.`;
      await reloadCurrentSectionAfterAction();
    } catch (error) {
      confirmMessage.textContent = error.message || "API 실행에 실패했어요.";
      confirmPayload.textContent = JSON.stringify({ ...pendingActionPreview, errorStatus: error.status, errorBody: error.body }, null, 2);
      confirmRunButton.textContent = isMutation ? "다시 실행" : "다시 조회";
      confirmRunButton.disabled = false;
    }
    return;
  }
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
  renderRows("creatorImageRequestRows", backstageRows.creatorImageRequests, 5);
  renderRows("aiCreatorRows", backstageRows.aiCreators, 5);
  renderRows("aiAssetRows", backstageRows.aiAssets, -1);
  renderRows("aiPostRows", backstageRows.aiPosts, -1);
  renderRows("moderationRows", backstageRows.moderation, 3);
  renderRows("moderationReportRows", backstageRows.moderationReports, 4);
  renderRows("contentAnomalyRows", backstageRows.contentAnomalies, 3);
  renderRows("reportCancelRows", backstageRows.reportCancels, 3);
  renderRows("studioSettlementRows", backstageRows.studioSettlement, 7);
  renderRows("settlementRows", backstageRows.settlement, 7);
  renderRows("aiSettlementRows", backstageRows.aiSettlement, -1);
  renderRows("logRows", backstageRows.logs, -1);
}

function setActiveSection(sectionId = "overview") {
  const allowedSection = canAccessBackstageSection(sectionId) ? sectionId : "overview";
  const targetId = document.getElementById(allowedSection) ? allowedSection : "overview";
  saveActiveSection(targetId);
  document.querySelector(".dashboard-main")?.setAttribute("data-active-section", targetId);
  document.querySelectorAll(".section-block").forEach((section) => {
    section.classList.toggle("is-active", section.id === targetId);
  });
  document.querySelectorAll(".sidebar-nav a").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${targetId}`);
  });
}

function currentAdminRoleName() {
  const user = getBackstageAuth()?.user || {};
  return user.adminUser?.role?.name || user.adminRole?.name || user.roleName || user.adminRoleName || user.role || null;
}

function currentAdminPermissions() {
  const user = getBackstageAuth()?.user || {};
  const permissions = user.adminUser?.role?.permissions || user.adminRole?.permissions || user.permissions || [];
  return Array.isArray(permissions) ? permissions : [];
}

function syncCurrentAdminContext(adminUsers = []) {
  const auth = getBackstageAuth();
  const email = auth?.user?.email;
  if (!auth || !email) return;
  const current = adminUsers.find((adminUser) => (adminUser.user?.email || adminUser.email) === email);
  if (!current) return;
  setBackstageAuth({
    ...auth,
    user: {
      ...auth.user,
      adminUser: current,
      roleName: current.role?.name || current.roleName || current.adminRole
    }
  });
  applyPermissionVisibility();
}

function canAccessBackstageSection(sectionId) {
  if (sectionId === "overview" || sectionId === "logs") return true;
  const role = currentAdminRoleName();
  const permissions = currentAdminPermissions();
  if (!role && permissions.length === 0) return true;
  if (role === "super_admin" || permissions.includes("*")) return true;
  const areaMap = {
    admins: ["super_admin"],
    users: ["cs_admin", "support_admin"],
    creators: ["partner_admin", "partnership_admin", "artist_ops_admin", "ai_artist_admin", "content_admin"],
    "ai-content": ["artist_ops_admin", "ai_artist_admin", "content_admin"],
    moderation: ["cs_admin", "support_admin", "content_admin"],
    settlement: ["commerce_admin", "settlement_admin", "finance_admin"]
  };
  const permissionMap = {
    users: ["users:read", "users:write", "community:read"],
    creators: ["debut:read", "creator:read", "artists:read"],
    "ai-content": ["artists:read", "assets:read", "shortforms:read"],
    moderation: ["community:read", "community:write", "reports:read"],
    settlement: ["payments:read", "settlement:read", "payout:read"]
  };
  return (areaMap[sectionId] || []).includes(role) || (permissionMap[sectionId] || []).some((permission) => permissions.includes(permission));
}

function applyPermissionVisibility() {
  document.querySelectorAll(".sidebar-nav a").forEach((link) => {
    const sectionId = link.getAttribute("href")?.replace("#", "") || "overview";
    link.classList.toggle("is-hidden", !canAccessBackstageSection(sectionId));
  });
  document.querySelectorAll(".section-block").forEach((section) => {
    section.classList.toggle("is-permission-hidden", !canAccessBackstageSection(section.id));
    section.classList.toggle("is-hidden", !canAccessBackstageSection(section.id));
  });
  const canManageAdmins = canAccessBackstageSection("admins");
  document.querySelectorAll('#admins .text-action, #adminRows .row-action').forEach((button) => {
    button.disabled = !canManageAdmins;
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
  const number = won(value);
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
    const adminItems = normalizePage(adminUsers).items;
    syncCurrentAdminContext(adminItems);
    const rows = adminItems.map((adminUser) => {
      const roleName = adminUser.role?.name || adminUser.roleName || adminUser.adminRole;
      const status = localizeAdminStatus(adminUser.status);
      return {
        row: [
          adminUser.user?.email || adminUser.email || adminUser.userId?.slice?.(0, 8) || "-",
          localizeAdminRole(roleName),
          status,
          formatDate(adminUser.lastAccessAt || adminUser.lastLoginAt || adminUser.user?.lastLoginAt || adminUser.updatedAt || adminUser.createdAt),
          summarizePermissions(adminUser.role?.permissions || adminUser.permissions),
          status === "승인" ? "권한 보기" : "복구 확인"
        ],
        meta: {
          adminUserId: adminUser.id,
          userId: adminUser.userId,
          roleName,
          permissions: adminUser.role?.permissions || adminUser.permissions || []
        }
      };
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
    const rows = page.items.map((user) => ({
      row: [
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
        user.status === "suspended" ? "복구 요청" : "7일 정지"
      ],
      meta: { userId: user.userId || user.id, status: user.status }
    }));
    const riskRows = page.items
      .filter((user) => Number(user.openReportCount || 0) > 0 || Number(user.reportCount || 0) > 0 || Number(user.sanctionCount || 0) > 0 || user.recentAction)
      .map((user) => ({
        row: [
          user.displayName || user.publicHandle || user.email || user.userId?.slice?.(0, 8) || "-",
          user.latestReportReason || user.recentAction || "운영 확인",
          `${formatCount(user.openReportCount || 0)} / ${formatCount(user.reportCount || 0)}`,
          localizeWorkflowStatus(user.status),
          user.recentAction || (Number(user.sanctionCount || 0) > 0 ? `제재 ${formatCount(user.sanctionCount)}회` : "확인 필요"),
          Number(user.openReportCount || 0) > 0 ? "신고 보기" : "상세"
        ],
        meta: { userId: user.userId || user.id, status: user.status }
      }));
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
  renderLoadingRow("creatorImageRequestRows");
  renderLoadingRow("aiCreatorRows");
  try {
    const [data, imageRequestsPage] = await Promise.all([
      backstageFetch(adminApiPath("/backstage/operations/creators?take=20"), { auth: true }),
      backstageFetch(adminApiPath("/creator-image-requests?take=20"), { auth: true }).catch(() => null)
    ]);
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
    const aiRows = (data?.aiArtists || []).map((artist) => ({
      row: [
        artist.displayName || artist.name || artist.slug || "-",
        artist.category || artist.type || artist.publicProfile?.characterType || "-",
        artist.createdBy?.email || artist.createdByName || artist.operatorName || "-",
        artist.missing?.includes("public_profile") || artist.missing?.includes("visual_profile") || artist.missing?.includes("content_profile") ? "누락" : "완료",
        artist.missing?.includes("cover_asset") || artist.missing?.includes("thumbnail_asset") || artist.missing?.includes("gallery_assets") ? missingSummary(artist.missing) : "완료",
        localizeWorkflowStatus(artist.status),
        "콘텐츠 관리"
      ],
      meta: {
        artistId: artist.id,
        slug: artist.slug,
        status: artist.status,
        category: artist.category || artist.type
      }
    }));
    const imageRequestRows = normalizePage(imageRequestsPage).items.map((request) => [
      localizeCreatorImageType(request.requestType),
      request.artist?.displayName || request.artist?.slug || request.artistId?.slice?.(0, 8) || "-",
      creatorImageRequester(request),
      creatorImageCostLabel(request),
      creatorImageRevisionLabel(request),
      localizeCreatorImageStatus(request.status),
      localizeModerationStatus(request.moderationStatus),
      countLabel(request.resultAssetIds?.length || 0, "장"),
      request.status === "delivered" || request.status === "approved" ? "결과 반영" : request.status === "rejected" ? "반려 확인" : "상세"
    ]);
    if (rows.length) renderRows("creatorRows", rows, 5);
    else renderLoadingRow("creatorRows", "표시할 신청 내역이 없습니다.");
    if (imageRequestRows.length) renderRows("creatorImageRequestRows", imageRequestRows, 5);
    else renderLoadingRow("creatorImageRequestRows", "표시할 이미지 제작 요청이 없습니다.");
    if (aiRows.length) renderRows("aiCreatorRows", aiRows, 5);
    else renderLoadingRow("aiCreatorRows", "표시할 AI 아티스트가 없습니다.");
  } catch {
    renderRows("creatorRows", backstageRows.creators, 5);
    renderRows("creatorImageRequestRows", backstageRows.creatorImageRequests, 5);
    renderRows("aiCreatorRows", backstageRows.aiCreators, 5);
    renderFallbackNote("creatorRows");
    renderFallbackNote("creatorImageRequestRows");
    renderFallbackNote("aiCreatorRows");
  }
}

async function loadAiContentSection() {
  renderLoadingRow("aiAssetRows");
  renderLoadingRow("aiPostRows");
  try {
    const page = normalizePage(await backstageFetch(adminApiPath("/backstage/operations/ai-content-health?take=20"), { auth: true }));
    const assetRows = page.items.map((artist) => ({
      row: [
        artist.displayName || artist.name || artist.slug || "-",
        slotStatus(artist.slots?.cover, true),
        slotStatus(artist.slots?.thumbnail, true),
        slotStatus(artist.slots?.gallery),
        countLabel(artist.counts?.shortforms || artist.shortformsCount, "개"),
        artist.missing?.length ? missingSummary(artist.missing) : "운영자 슬롯 선택 우선",
        artist.missing?.length ? "업로드" : "상세"
      ],
      meta: {
        artistId: artist.id,
        slug: artist.slug,
        status: artist.status,
        coverAssetId: artist.slots?.cover?.assetId,
        thumbAssetId: artist.slots?.thumbnail?.assetId
      }
    }));
    const postRows = page.items.map((artist) => ({
      row: [
        artist.displayName || artist.name || artist.slug || "-",
        profileStatus(artist.profiles, "contentProfile"),
        profileStatus(artist.profiles, "publicProfile"),
        artist.missing?.includes("chat_persona") ? "필요" : "준비중",
        artist.counts?.premiumVideos ? countLabel(artist.counts.premiumVideos, "개") : "준비중",
        "작성"
      ],
      meta: { artistId: artist.id, slug: artist.slug, status: artist.status }
    }));
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
  renderLoadingRow("moderationReportRows");
  try {
    const [posts, reportsPage] = await Promise.all([
      backstageFetch(adminApiPath("/community/posts?status=published&minReports=1&sort=reports&take=20"), { auth: true }).catch(() => null),
      backstageFetch(adminApiPath("/moderation/reports?take=20"), { auth: true }).catch(() => null)
    ]);
    const rows = (Array.isArray(posts) ? posts : posts?.items || posts?.posts || []).map((post) => ({
      row: [
        post.id?.slice?.(0, 8) || "-",
        post.authorUser?.email || post.artist?.name || post.artist?.displayName || "-",
        `신고 ${formatCount(post.reportCount)}건`,
        post.status || "-",
        post.status === "hidden" ? "복구" : "숨김"
      ],
      meta: { postId: post.id, authorUserId: post.authorUserId, status: post.status }
    }));
    const reportRows = normalizePage(reportsPage).items.map((report) => ({
      row: [
        report.id?.slice?.(0, 8) || "-",
        `${localizeReportTarget(report.targetType)} / ${report.targetId?.slice?.(0, 8) || "-"}`,
        reportReporter(report),
        localizeReportReason(report.reason),
        localizeReportStatus(report.status),
        report.detail || report.metadata?.adminNote || "-",
        report.status === "resolved" || report.status === "archived" ? "상세" : "검토"
      ],
      meta: { reportId: report.id, postId: report.postId, targetId: report.targetId, status: report.status }
    }));
    if (rows.length) renderRows("moderationRows", rows, 3);
    else renderLoadingRow("moderationRows", "확인 필요한 콘텐츠가 없습니다.");
    if (reportRows.length) renderRows("moderationReportRows", reportRows, 4);
    else renderLoadingRow("moderationReportRows", "접수된 범용 신고가 없습니다.");
  } catch {
    renderBackstageTables();
    renderFallbackNote("moderationRows");
    renderFallbackNote("moderationReportRows");
  }
}

async function loadSettlementSection() {
  sectionState.settlement = { cursor: null, hasMore: false, rows: [], studioRows: [] };
  renderLoadingRow("studioSettlementRows");
  renderLoadingRow("settlementRows");
  await loadSettlementPage(false);
}

async function loadSettlementPage(append = true) {
  const state = sectionState.settlement;
  const query = new URLSearchParams({ period: currentSettlementPeriod(), take: "20" });
  if (append && state.cursor) query.set("cursor", state.cursor);
  try {
    const partnerQuery = new URLSearchParams({ period: currentSettlementPeriod(), take: "20", settlementRateBps: "5000" });
    const [data, partnerData] = await Promise.all([
      backstageFetch(adminApiPath(`/backstage/operations/settlement-preview?${query}`), { auth: true }),
      append ? Promise.resolve(null) : backstageFetch(adminApiPath(`/backstage/operations/partner-settlement-preview?${partnerQuery}`), { auth: true }).catch(() => null)
    ]);
    const page = normalizePage(data);
    const notice = document.getElementById("settlementNotice");
    if (notice) {
      notice.textContent = data?.notice || "정산 데이터는 예상치/확정 전입니다. 실제 지급 확정 전 환불, 차지백, 세무, 운영 확인이 필요합니다.";
    }
    const partnerPage = partnerData ? normalizePage(partnerData) : { items: [] };
    const partnerRows = partnerPage.items.map((item) => settlementEntryFromItem(item, true));
    const studioRows = [];
    const rows = [];
    page.items.forEach((item) => {
      if (isStudioSettlementItem(item)) {
        studioRows.push(settlementEntryFromItem(item, true));
        return;
      }
      rows.push(settlementEntryFromItem(item, false));
    });
    const visibleStudioRows = append ? (state.studioRows || []).concat(studioRows) : partnerRows.concat(studioRows);
    state.rows = append ? state.rows.concat(rows) : rows;
    state.studioRows = visibleStudioRows;
    state.cursor = page.nextCursor;
    state.hasMore = page.hasMore;
    setLoadMore("settlement", page.hasMore);
    if (visibleStudioRows.length) renderRows("studioSettlementRows", visibleStudioRows, 7);
    else renderRows("studioSettlementRows", backstageRows.studioSettlement, 7);
    if (state.rows.length) renderRows("settlementRows", state.rows, 7);
    else renderLoadingRow("settlementRows", "표시할 정산 예상치가 없습니다.");
  } catch {
    renderBackstageTables();
    setLoadMore("settlement", false);
    renderFallbackNote("studioSettlementRows");
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
  if (!canAccessBackstageSection(sectionId)) {
    setActiveSection("overview");
    renderBackstageTables();
    loadBackstageSummary();
    return;
  }
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
  const sectionId = getSavedSection();
  operatorEmail.textContent = auth?.user?.email || emailInput.value || "운영자";
  loginView.classList.add("is-hidden");
  dashboardView.classList.remove("is-hidden");
  applyPermissionVisibility();
  setActiveSection(sectionId);
  renderBackstageTables();
  updateTodayLabel();
  loadSection(sectionId);
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

  const inlineButton = event.target.closest("[data-inline-action]");
  if (inlineButton) {
    handleInlineAction(inlineButton);
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
  if (filterButton) {
    if (filterButton.dataset.sectionFilter) applySectionFilter(filterButton);
    else applyOverviewFilter(filterButton);
  }

  const settlementToggle = event.target.closest("[data-settlement-toggle]");
  if (settlementToggle) {
    const key = settlementToggle.dataset.settlementToggle;
    const childRow = document.querySelector(`[data-settlement-child="${key}"]`);
    const willOpen = childRow?.classList.contains("is-hidden");
    childRow?.classList.toggle("is-hidden", !willOpen);
    settlementToggle.textContent = willOpen ? "접기" : "펼침";
    settlementToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }
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

detailForm?.addEventListener("input", saveDetailDraft);
detailForm?.addEventListener("change", saveDetailDraft);

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
  const sectionId = getCurrentSection();
  renderBackstageTables();
  updateTodayLabel();
  loadSection(sectionId);
});

bootstrapBackstage();


