// #329 — 프리미엄챗 후원 UI / 랭킹 진입.
// #328 GET /api/v1/chat/premium-support-contract 응답 기준으로 read-only 미리보기만 렌더한다.
// donation POST, wallet debit, settlement, payout mutation은 walletMutationEnabled가 true가 되기 전까지 비활성 유지.
// 좋아요 순위와 분리 — donation/communication 랭킹은 /chat-rankings에서 별도 노출.
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.LuminaPremiumChatSupport) return;

  var API_BASE = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
  var CONTRACT_PATH = "/api/v1/chat/premium-support-contract";

  // 화면 텍스트 fallback — API 다운/비로그인 등 contract 호출 실패 시에도 정적 안내를 유지.
  var FALLBACK_CONTRACT = {
    version: "fallback",
    feature: "premium_chat_support",
    status: "contract_pending",
    policy: {
      authRequired: true,
      walletMutationEnabled: false,
      disabledDisplayMessageKo: "프리미엄챗 후원은 원장·보안 검증이 끝난 뒤 열릴 예정이에요."
    },
    donation: {
      fixedAmountsLumina: [10, 50, 100, 500, 1000, 5000, 10000, 50000],
      customAmount: { supported: true, minLumina: 1, maxLumina: 50000, integerOnly: true },
      message: { optional: true, maxChars: 200 },
      highValuePolicy: {
        startsAtLumina: 10000,
        dailyLimitLumina: 50000,
        requiresIdentityVerification: true
      }
    }
  };

  var state = {
    contract: null,
    selectedAmount: null,
    selectedSource: "fixed",
    customAmount: null,
    message: "",
    pendingConfirmAmount: null,
    ready: false
  };

  function $(id) { return document.getElementById(id); }

  function formatLumina(amount) {
    var num = Number(amount);
    if (!Number.isFinite(num)) return "0";
    return num.toLocaleString("ko-KR");
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text == null ? "" : String(text);
  }

  function authToken() {
    try {
      if (typeof window.getAccessToken === "function") {
        var currentToken = window.getAccessToken();
        if (currentToken) return currentToken;
      }
    } catch (_) {}
    try {
      if (!window.localStorage) return null;
      var keys = ["lumina_auth", "lumina.session"];
      for (var i = 0; i < keys.length; i += 1) {
        var raw = window.localStorage.getItem(keys[i]);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        var token = parsed && (
          parsed.accessToken ||
          parsed.token ||
          parsed.access_token ||
          (parsed.tokens && (parsed.tokens.accessToken || parsed.tokens.access_token))
        );
        if (token) return token;
      }
      return null;
    } catch (_) { return null; }
  }

  async function fetchContract() {
    var token = authToken();
    if (!token) {
      // 비로그인 — fallback 정적 contract 사용. UI는 read-only로 안내만 노출.
      return { contract: FALLBACK_CONTRACT, source: "fallback-unauth" };
    }
    var res;
    try {
      res = await fetch(API_BASE + CONTRACT_PATH, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Authorization: "Bearer " + token }
      });
    } catch (_) {
      return { contract: FALLBACK_CONTRACT, source: "fallback-network" };
    }
    if (!res.ok) {
      return { contract: FALLBACK_CONTRACT, source: "fallback-http-" + res.status };
    }
    try {
      var data = await res.json();
      // 응답이 {data: {...}} 또는 그 자체일 수 있어서 둘 다 지원.
      var contract = data && data.contract ? data.contract : (data && data.data && data.data.contract) || data;
      return { contract: contract, source: "live" };
    } catch (_) {
      return { contract: FALLBACK_CONTRACT, source: "fallback-parse" };
    }
  }

  function renderFixedAmounts(contract) {
    var grid = $("donationFixedAmounts");
    if (!grid) return;
    var amounts = (contract && contract.donation && contract.donation.fixedAmountsLumina) || FALLBACK_CONTRACT.donation.fixedAmountsLumina;
    var highValueStart = contract && contract.donation && contract.donation.highValuePolicy && contract.donation.highValuePolicy.startsAtLumina;
    grid.innerHTML = "";
    amounts.forEach(function (amount) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "donation-amount";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", "false");
      btn.dataset.amount = String(amount);
      if (highValueStart && amount >= highValueStart) btn.dataset.highValue = "1";
      btn.innerHTML =
        '<span class="donation-amount-value">' + formatLumina(amount) + "</span>" +
        '<span class="donation-amount-unit">L</span>';
      btn.addEventListener("click", function () { onFixedSelect(amount, btn); });
      grid.appendChild(btn);
    });
  }

  function onFixedSelect(amount, button) {
    state.selectedAmount = amount;
    state.selectedSource = "fixed";
    state.customAmount = null;
    var custom = $("donationCustomAmount");
    if (custom) custom.value = "";
    var siblings = document.querySelectorAll(".donation-amount");
    siblings.forEach(function (b) {
      var active = b === button;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-checked", active ? "true" : "false");
    });
    updateSummary();
  }

  function onCustomInput(event) {
    var input = event.target;
    var raw = String(input.value || "").trim();
    if (!raw) {
      state.customAmount = null;
      state.selectedAmount = null;
      state.selectedSource = "fixed";
      clearFixedSelection();
      updateSummary();
      return;
    }
    // 정수만 허용. 소수점/문자/음수는 거른다.
    var n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      state.customAmount = null;
      state.selectedAmount = null;
      updateSummary("정수만 입력할 수 있어요.");
      return;
    }
    var max = currentMax();
    if (n > max) {
      state.customAmount = null;
      state.selectedAmount = null;
      updateSummary("직접 입력은 1L ~ " + formatLumina(max) + "L까지 가능해요.");
      return;
    }
    state.selectedSource = "custom";
    state.customAmount = n;
    state.selectedAmount = n;
    clearFixedSelection();
    updateSummary();
  }

  function clearFixedSelection() {
    document.querySelectorAll(".donation-amount").forEach(function (b) {
      b.classList.remove("is-active");
      b.setAttribute("aria-checked", "false");
    });
  }

  function currentMax() {
    var c = state.contract && state.contract.donation && state.contract.donation.customAmount;
    return (c && c.maxLumina) || FALLBACK_CONTRACT.donation.customAmount.maxLumina;
  }

  function currentHighValueStart() {
    var hv = state.contract && state.contract.donation && state.contract.donation.highValuePolicy;
    return (hv && hv.startsAtLumina) || FALLBACK_CONTRACT.donation.highValuePolicy.startsAtLumina;
  }

  function updateSummary(hint) {
    var summary = $("donationSummary");
    if (!summary) return;
    var amount = state.selectedAmount;
    var parts = [];
    if (amount != null) {
      parts.push('<span class="donation-summary-amount"><strong>' + formatLumina(amount) + 'L</strong> 후원 미리보기</span>');
      if (amount >= currentHighValueStart()) {
        parts.push('<span class="donation-summary-tag">고액 후원 — 본인확인 필요</span>');
      }
    } else {
      parts.push('<span class="donation-summary-amount">금액을 선택하면 합계가 표시됩니다.</span>');
    }
    if (hint) parts.push('<span class="donation-summary-hint">' + hint + '</span>');
    summary.innerHTML = parts.join("");
    updateConfirmButton();
  }

  function isMutationEnabled() {
    return !!(state.contract && state.contract.policy && state.contract.policy.walletMutationEnabled);
  }

  function updateConfirmButton() {
    var btn = $("donationConfirmBtn");
    var label = $("donationConfirmLabel");
    if (!btn || !label) return;
    var mutationOpen = isMutationEnabled();
    if (!mutationOpen) {
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      btn.title = (state.contract && state.contract.policy && state.contract.policy.disabledDisplayMessageKo) ||
        FALLBACK_CONTRACT.policy.disabledDisplayMessageKo;
      label.textContent = "후원 잠금";
      return;
    }
    var hasAmount = state.selectedAmount != null;
    btn.disabled = !hasAmount;
    btn.setAttribute("aria-disabled", btn.disabled ? "true" : "false");
    btn.title = hasAmount ? "" : "금액을 먼저 선택하세요";
    label.textContent = hasAmount ? formatLumina(state.selectedAmount) + "L 후원하기" : "금액 선택";
  }

  function renderStatusBanner(contract, source) {
    var banner = $("donationStatusBanner");
    if (!banner) return;
    var mutationOpen = !!(contract && contract.policy && contract.policy.walletMutationEnabled);
    var unauth = source === "fallback-unauth";
    var disabled = !mutationOpen;
    banner.dataset.state = unauth ? "unauth" : disabled ? "disabled" : "ready";
    var label, body;
    if (unauth) {
      label = "로그인이 필요해요";
      body = "후원 정책은 로그인한 팬에게만 공개돼요. 로그인 후 다시 시도해 주세요.";
    } else if (disabled) {
      label = "후원 준비 중";
      body = (contract && contract.policy && contract.policy.disabledDisplayMessageKo) ||
        FALLBACK_CONTRACT.policy.disabledDisplayMessageKo;
    } else {
      label = "후원 가능";
      body = "고액 후원은 본인확인이 끝난 계정만 진행할 수 있어요.";
    }
    banner.innerHTML =
      '<strong class="donation-status-label">' + label + "</strong>" +
      '<p class="donation-status-text">' + body + "</p>";
  }

  function renderPolicyInfo(contract) {
    var hv = (contract && contract.donation && contract.donation.highValuePolicy) || FALLBACK_CONTRACT.donation.highValuePolicy;
    setText(
      "donationPolicyHighValue",
      formatLumina(hv.startsAtLumina) + "L 이상 후원은 본인확인이 끝난 계정만 진행할 수 있어요."
    );
    setText(
      "donationPolicyDailyLimit",
      "하루 후원 합계는 " + formatLumina(hv.dailyLimitLumina) + "L까지로 제한돼요."
    );
    // blockedStates 텍스트는 정적 유지 (계약상 message key 만 정의됨)
    var custom = (contract && contract.donation && contract.donation.customAmount) || FALLBACK_CONTRACT.donation.customAmount;
    var hint = $("donationCustomHint");
    if (hint) {
      hint.textContent =
        "최소 " + formatLumina(custom.minLumina) + "L, 최대 " +
        formatLumina(custom.maxLumina) + "L까지 입력할 수 있어요. 정수만 가능합니다.";
    }
    var msgCfg = (contract && contract.donation && contract.donation.message) || FALLBACK_CONTRACT.donation.message;
    var ta = $("donationMessage");
    if (ta && msgCfg.maxChars) ta.setAttribute("maxlength", String(msgCfg.maxChars));
  }

  function onMessageInput(event) {
    var ta = event.target;
    state.message = String(ta.value || "");
    var counter = $("donationMessageCounter");
    var max = (state.contract && state.contract.donation && state.contract.donation.message && state.contract.donation.message.maxChars) ||
      FALLBACK_CONTRACT.donation.message.maxChars;
    if (counter) counter.textContent = state.message.length + " / " + max;
  }

  function openSheet() {
    var sheet = $("chatDonationSheet");
    var backdrop = $("chatDonationBackdrop");
    if (!sheet || !backdrop) return;
    backdrop.hidden = false;
    sheet.hidden = false;
    document.body.classList.add("is-donation-open");
    // 시트가 처음 열린 시점에 한 번 더 contract 새로고침 (token 획득 가능성).
    void initialize();
  }

  function closeSheet() {
    var sheet = $("chatDonationSheet");
    var backdrop = $("chatDonationBackdrop");
    if (sheet) sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("is-donation-open");
  }

  function openConfirm(amount) {
    state.pendingConfirmAmount = amount;
    var modal = $("donationConfirmModal");
    var backdrop = $("donationConfirmBackdrop");
    var amountEl = $("donationConfirmAmount");
    if (amountEl) amountEl.textContent = formatLumina(amount) + "L";
    if (modal) modal.hidden = false;
    if (backdrop) backdrop.hidden = false;
    var proceed = $("donationConfirmProceed");
    if (proceed) {
      var mutationOpen = isMutationEnabled();
      proceed.disabled = !mutationOpen;
      proceed.setAttribute("aria-disabled", mutationOpen ? "false" : "true");
      proceed.textContent = mutationOpen ? "진행하기" : "진행 잠금";
      proceed.title = mutationOpen ? "" : (state.contract && state.contract.policy && state.contract.policy.disabledDisplayMessageKo) ||
        FALLBACK_CONTRACT.policy.disabledDisplayMessageKo;
    }
  }

  function closeConfirm() {
    state.pendingConfirmAmount = null;
    var modal = $("donationConfirmModal");
    var backdrop = $("donationConfirmBackdrop");
    if (modal) modal.hidden = true;
    if (backdrop) backdrop.hidden = true;
  }

  function onConfirmDonation() {
    var amount = state.selectedAmount;
    if (amount == null) return;
    if (amount >= currentHighValueStart()) {
      openConfirm(amount);
      return;
    }
    // mutation이 활성화되기 전이라 실제 POST는 일어나지 않는다. UI 피드백만.
    flashLocked();
  }

  function onProceedDonation() {
    // walletMutationEnabled false 동안에는 잠금. POST 없음.
    flashLocked();
  }

  function flashLocked() {
    var banner = $("donationStatusBanner");
    if (!banner) return;
    banner.dataset.flash = "locked";
    window.setTimeout(function () { banner.removeAttribute("data-flash"); }, 1800);
  }

  async function initialize() {
    if (state.ready && state.contract) return;
    var result = await fetchContract();
    state.contract = result.contract;
    renderStatusBanner(result.contract, result.source);
    renderFixedAmounts(result.contract);
    renderPolicyInfo(result.contract);
    updateConfirmButton();
    state.ready = true;
  }

  function bind() {
    var openBtn = $("chatDonationOpen");
    if (openBtn && !openBtn.dataset.bound) {
      openBtn.dataset.bound = "1";
      openBtn.addEventListener("click", openSheet);
    }
    document.querySelectorAll("[data-donation-close]").forEach(function (el) {
      if (el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", closeSheet);
    });
    var backdrop = $("chatDonationBackdrop");
    if (backdrop && !backdrop.dataset.bound) {
      backdrop.dataset.bound = "1";
      backdrop.addEventListener("click", closeSheet);
    }
    var custom = $("donationCustomAmount");
    if (custom && !custom.dataset.bound) {
      custom.dataset.bound = "1";
      custom.addEventListener("input", onCustomInput);
    }
    var msg = $("donationMessage");
    if (msg && !msg.dataset.bound) {
      msg.dataset.bound = "1";
      msg.addEventListener("input", onMessageInput);
    }
    var confirmBtn = $("donationConfirmBtn");
    if (confirmBtn && !confirmBtn.dataset.bound) {
      confirmBtn.dataset.bound = "1";
      confirmBtn.addEventListener("click", onConfirmDonation);
    }
    var proceed = $("donationConfirmProceed");
    if (proceed && !proceed.dataset.bound) {
      proceed.dataset.bound = "1";
      proceed.addEventListener("click", onProceedDonation);
    }
    var cancel = document.querySelector("[data-donation-confirm-cancel]");
    if (cancel && !cancel.dataset.bound) {
      cancel.dataset.bound = "1";
      cancel.addEventListener("click", closeConfirm);
    }
    var modalBackdrop = $("donationConfirmBackdrop");
    if (modalBackdrop && !modalBackdrop.dataset.bound) {
      modalBackdrop.dataset.bound = "1";
      modalBackdrop.addEventListener("click", closeConfirm);
    }
  }

  window.LuminaPremiumChatSupport = {
    open: openSheet,
    close: closeSheet,
    refresh: function () { state.ready = false; return initialize(); }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
