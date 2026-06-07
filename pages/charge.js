(function initChargeModule() {
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
let _chargePageInitialized = false;
let _chargeStationInitLoadPromise = null;
let _chargeStationInitLoadedFor = null;

/* Charge helper boundary: endpoint/status/payload decisions stay out of DOM binding. */
const CHARGE_ENDPOINTS = Object.freeze({
  station: "/api/v1/lumina-station?take=5",
  paymentOrders: "/api/v1/payments/orders"
});
const CHARGE_PAYMENT_STATUS = Object.freeze({
  pgPending: "pg_pending",
  pending: "pending"
});

// #373 — 충전소 6종 정책(1,000 / 3,000 / 5,000 / 10,000 / 50,000 / 100,000원)에 맞춰 화면 표시 정리.
// backend 응답이 30,000원·70,000원처럼 spec 외 상품을 포함하더라도 사용자 화면에는 노출하지 않는다.
// 결제/원장은 backend가 그대로 관리하고, 클라이언트는 시각 표시만 필터링한다.
const CHARGE_HIDDEN_PRICE_AMOUNTS = new Set([30000, 70000]);
const CHARGE_VISIBLE_PRICE_ORDER = [1000, 3000, 5000, 10000, 50000, 100000];

// #721 — 로컬/preview 환경에서 로그인 없이 충전 상품 카드와 첫 충전 보너스를 검수할 수 있도록
// 하는 fixture 데이터. 실결제 mutation과 완전히 분리됨 (payment.status = "pg_pending" 유지해
// 결제 버튼이 disabled 상태로 렌더됨).
const CHARGE_PREVIEW_FIXTURE = Object.freeze({
  wallet: { cachedBalance: 1500, balance: 1500 },
  policy: { paidLikeUnitPriceLumina: 10 },
  payment: { status: "pg_pending" }, // disabled 상태 — 실결제 절대 불가
  products: [
    { id: "fixture-1000",  name: "스타터",    priceAmount: 1000,  luminaAmount: 100,   bonusAmount: 0,    bonusRate: 0,  firstChargeBonusLumina: 50  },
    { id: "fixture-3000",  name: "라이트",    priceAmount: 3000,  luminaAmount: 330,   bonusAmount: 30,   bonusRate: 10, firstChargeBonusLumina: 150 },
    { id: "fixture-5000",  name: "레귤러",    priceAmount: 5000,  luminaAmount: 550,   bonusAmount: 55,   bonusRate: 10, firstChargeBonusLumina: 0   },
    { id: "fixture-10000", name: "프리미엄",  priceAmount: 10000, luminaAmount: 1200,  bonusAmount: 200,  bonusRate: 20, firstChargeBonusLumina: 0,  isBest: true },
    { id: "fixture-50000", name: "VIP",       priceAmount: 50000, luminaAmount: 6500,  bonusAmount: 1000, bonusRate: 20, firstChargeBonusLumina: 0   },
  ],
  recentOrders: [],
});

function normalizeChargeProducts(data) {
  const raw = Array.isArray(data?.products) ? data.products : [];
  // 1) 숨김 가격(30,000 / 70,000) 제외
  const filtered = raw.filter((p) => {
    const price = Number(p?.priceAmount || p?.priceKrw || 0);
    return Number.isFinite(price) && !CHARGE_HIDDEN_PRICE_AMOUNTS.has(price);
  });
  // 2) 가격 오름차순 안정 정렬 — 소액(1k/3k/5k) 카드가 첫 화면에 먼저 보이게.
  return filtered.slice().sort((a, b) => {
    const ap = Number(a?.priceAmount || a?.priceKrw || 0);
    const bp = Number(b?.priceAmount || b?.priceKrw || 0);
    const ai = CHARGE_VISIBLE_PRICE_ORDER.indexOf(ap);
    const bi = CHARGE_VISIBLE_PRICE_ORDER.indexOf(bp);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return ap - bp;
  });
}

function canCreatePaymentOrder(stationData = _chargeStationData) {
  return (stationData?.payment?.status || "") !== CHARGE_PAYMENT_STATUS.pgPending;
}

function formatLuminaProductPrice(value) {
  return formatCurrencyKRW(value);
}

function buildPaymentOrderPayload(productId) {
  return { luminaProductId: productId };
}

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

function formatChargeLuminaAmount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("ko-KR");
}

/* 충전소 데이터 로드 */
async function loadChargeStationData() {
  try {
    const data = await apiFetch(CHARGE_ENDPOINTS.station, { auth: true });
    _chargeStationData = data || null;
    return _chargeStationData;
  } catch (err) {
    console.warn("[Lumina] /lumina-station 실패:", err);
    return null;
  }
}

function getChargeInitAuthKey() {
  const auth = typeof getAuth === "function" ? getAuth() : null;
  return auth?.user?.id || auth?.user?.userId || auth?.user?.email || auth?.accessToken || "authenticated";
}

async function loadChargeStationDataForInit(authKey) {
  if (_chargeStationInitLoadedFor === authKey && _chargeStationData) return _chargeStationData;
  if (_chargeStationInitLoadPromise) return _chargeStationInitLoadPromise;

  _chargeStationInitLoadPromise = loadChargeStationData()
    .then(data => {
      if (data) _chargeStationInitLoadedFor = authKey;
      return data;
    })
    .finally(() => {
      _chargeStationInitLoadPromise = null;
    });
  return _chargeStationInitLoadPromise;
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
  if (balanceEl) balanceEl.textContent = formatChargeLuminaAmount(balance);

  // 2. 정책 힌트
  if (policyHintEl) {
    const unitL = data.policy?.paidLikeUnitPriceLumina ?? 10;
    policyHintEl.textContent = `1개 = ${unitL}L`;
  }

  // 3. 결제 status — pg_pending이면 안내 카드 표시 + 결제 버튼 비활성
  const paymentStatus = data.payment?.status || "";
  const isPgPending = paymentStatus === CHARGE_PAYMENT_STATUS.pgPending;
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
  const products = normalizeChargeProducts(data);
  if (productGrid) {
    if (products.length === 0) {
      productGrid.innerHTML = `<div class="charge-empty">지금 선택할 수 있는 충전 상품이 없어요.</div>`;
    } else {
      productGrid.innerHTML = products.map(p => renderChargeProductCard(p, !canCreatePaymentOrder(data))).join("");
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
  // #373 보강 — 첫 충전 보너스 projection. 계정당 1회, 기본 루미나 기준 10%, 패키지 보너스에 중복 X.
  // backend가 firstChargeBonusLumina / firstChargeTotalLumina 를 내려주면 카드에 별도 줄로 표시한다.
  // #558 — bonusAmount(패키지 보너스)가 있는 상품은 정책상 firstCharge와 중복 적용 X.
  //         backend가 두 값을 모두 보내는 경우에도 UI 에서 "(패키지 보너스와 중복 적용 안 됨)" 안내.
  const firstChargeBonusLumina = Number(p.firstChargeBonusLumina || 0);
  const firstChargeTotalLumina = Number(p.firstChargeTotalLumina || 0);
  const hasFirstChargeBonus = firstChargeBonusLumina > 0;
  // 패키지 보너스와 첫 충전 보너스 동시 존재 여부 (정책상 발생 X이지만 방어적 처리)
  const hasBothBonus = hasFirstChargeBonus && bonusAmount > 0;

  return `
    <article class="charge-product-card${isBest ? ' is-best' : ''}" data-product-id="${feedEscapeHtml(productId)}">
      ${isBest ? `<span class="charge-best-badge" title="가장 많이 선택되는 충전팩">BEST</span>` : ""}
      <header class="charge-product-head">
        <h3 class="charge-product-name">${name}</h3>
        ${bonusRate > 0 ? `<span class="charge-bonus-rate">+${bonusRate}% 보너스</span>` : ""}
      </header>
      <div class="charge-product-amount">
        <span class="charge-amount-main">${formatChargeLuminaAmount(totalLumina)}<small>L</small></span>
        ${bonusAmount > 0
          ? `<span class="charge-amount-detail">기본 ${formatChargeLuminaAmount(luminaAmount)}L + 패키지 보너스 ${formatChargeLuminaAmount(bonusAmount)}L</span>`
          : ""}
        ${hasFirstChargeBonus
          ? `<span class="charge-amount-first-charge" title="계정당 1회 혜택. 기본 루미나의 10% 추가 지급. 패키지 보너스와 중복 적용 안 됩니다.">
               <span class="charge-first-charge-tag">첫 충전 1회</span>
               + 첫 충전 보너스 ${formatChargeLuminaAmount(firstChargeBonusLumina)}L
               ${firstChargeTotalLumina > 0
                 ? ` → 합계 ${formatChargeLuminaAmount(firstChargeTotalLumina)}L`
                 : ""}
               ${hasBothBonus ? `<span class="charge-first-charge-note">패키지 보너스와 중복 적용 안 됨</span>` : ""}
             </span>`
          : ""}
      </div>
      <div class="charge-product-price">
        <strong>${formatLuminaProductPrice(priceAmount)}</strong>
        ${discountAmount > 0 ? `<small class="charge-discount">${formatLuminaProductPrice(discountAmount)} 할인</small>` : ""}
      </div>
      <button
        class="charge-buy-btn"
        type="button"
        data-charge-buy="${feedEscapeHtml(productId)}"
        ${isPgPending ? 'disabled' : ''}>
        ${isPgPending ? '결제 안내 대기'
          : hasFirstChargeBonus && firstChargeTotalLumina > 0
            ? `${formatChargeLuminaAmount(firstChargeTotalLumina)}L 충전하기 (첫 충전 적용)`
            : `${formatChargeLuminaAmount(totalLumina)}L 충전하기`}
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
        <span class="charge-order-lumina">+${formatChargeLuminaAmount(lumina)}L</span>
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
    const order = await apiFetch(CHARGE_ENDPOINTS.paymentOrders, {
      method: "POST",
      auth: true,
      throwOnError: true,
      headers: { "Idempotency-Key": idempotencyKey },
      body: buildPaymentOrderPayload(productId)
    });

    // 응답 확인 — PG 리다이렉트 URL이 있으면 이동, 아니면 안내
    const redirectUrl = order?.payment?.redirectUrl || order?.checkoutUrl || order?.paymentUrl;
    const status = order?.status || order?.payment?.status || "";

    if (redirectUrl && /^https?:\/\//i.test(redirectUrl)) {
      // PG 리다이렉트 — 보안: URL이 https인지 한 번 더 확인
      window.location.href = redirectUrl;
      return; // 페이지 떠나므로 후속 처리 불필요
    }

    if (status === CHARGE_PAYMENT_STATUS.pgPending || status === CHARGE_PAYMENT_STATUS.pending) {
      // #362 — alert 카피도 동일 톤으로 정리. "준비 중" 어휘 반복 축소.
      alert("결제 가능 시점은 공지와 메일로 안내드릴게요. 지금은 상품 정보와 예상 지급 루미나를 먼저 확인할 수 있어요.");
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

  if (!_chargePageInitialized) {
    _chargePageInitialized = true;
    bindChargePage();
  }

  if (!isLoggedIn()) {
    // #721 — 로컬/preview 환경에서는 fixture로 상품 카드 검수 가능하게 함.
    // payment.status = "pg_pending" 고정이라 결제 버튼은 disabled 유지 — 실결제 없음.
    const isPreview = (function () {
      try { var h = window.location.hostname; return h === "localhost" || h === "127.0.0.1" || h === "" || h.endsWith(".local"); } catch (_) { return false; }
    })();
    if (isPreview) {
      if (gate) gate.hidden = true;
      if (content) content.hidden = false;
      _chargeStationData = Object.assign({}, CHARGE_PREVIEW_FIXTURE);
      renderChargePage();
      const fixtureNotice = document.getElementById("chargeFixtureNotice");
      if (fixtureNotice) fixtureNotice.hidden = false;
      return;
    }
    if (gate) gate.hidden = false;
    if (content) content.hidden = true;
    _chargeStationInitLoadedFor = null;
    return;
  }
  if (gate) gate.hidden = true;
  if (content) content.hidden = false;

  await loadChargeStationDataForInit(getChargeInitAuthKey());
  renderChargePage();
}


window.initChargePage = initChargePage;
})();
