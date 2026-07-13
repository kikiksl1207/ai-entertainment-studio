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
      disabledDisplayMessageKo: "후원 기능을 준비하고 있어요. 열리면 바로 알려드릴게요. 지금은 금액과 정책만 미리 볼 수 있어요." // #1341 locked preview copy
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
    sheetTrigger: null,
    escBound: false,
    ready: false,
    contractSource: "fallback-unauth"
  };

  var SUPPORT_COPY = {
    ko: {
      title: "후원 안내", description: "프리미엄 채팅의 후원 금액, 본인확인 조건, 환불 안내를 읽기 전용으로 확인합니다.", back: "캐릭터챗으로 돌아가기",
      panelLabel: "프리미엄챗 후원 상태", stepsLabel: "후원 단계", stepAmount: "금액 선택", stepReview: "내용 확인", stepComplete: "후원 완료",
      loadingLabel: "상태 확인 중", loadingText: "후원 정책을 불러오는 중입니다.", fixedLegend: "고정 후원 금액", fixedAria: "고정 후원 금액 선택", customLegend: "직접 입력", amountLabel: "후원 금액 (L)", amountPlaceholder: "1 ~ 50,000",
      messageLegend: "메시지", messagePlaceholder: "응원 메시지를 미리 작성해 볼 수 있어요.", messageHint: "이 화면은 읽기 전용입니다. 실제 제출은 열리지 않습니다.", summaryEmpty: "금액을 선택하면 합계가 표시됩니다.", summarySelected: "{amount}L 후원 안내", highValueTag: "고액 후원 · 본인확인 필요",
      integerOnly: "정수만 입력할 수 있어요.", customRange: "직접 입력은 {min}L부터 {max}L까지 가능합니다.", disabledLabel: "후원 준비 중", disabledText: "현재 후원을 이용할 수 없습니다. 이용 가능해지면 알려드릴게요.", unauthText: "로그인하면 후원 가능 여부를 확인할 수 있어요. 지금은 금액과 정책만 확인할 수 있어요.", readyLabel: "후원 가능", readyText: "고액 후원은 본인확인이 완료된 계정에서만 진행할 수 있어요.",
      policyHigh: "{amount}L 이상 후원은 본인확인이 완료된 계정에서만 진행할 수 있어요.", policyDaily: "하루 후원 합계는 {amount}L까지로 제한돼요.", policyBlocked: "신고 또는 운영 검토 중인 방에서는 후원이 잠길 수 있어요.", policyReview: "24시간 미응답 상태는 환불 검토 대상입니다.", policyRefund: "정책 사유 발생 시 환불 금액은 조건에 따라 제한될 수 있어요.", hub: "허브 보기", confirmInfo: "후원 안내 확인", selectAmount: "금액 선택", confirmAmount: "{amount}L 후원하기", confirmTitle: "고액 후원 확인", confirmBody: "아래 금액으로 후원할지 확인합니다.", confirmIdentity: "본인확인이 필요한 금액입니다.", confirmDaily: "일일 한도 안에서만 진행됩니다.", confirmRefund: "정책 사유가 있으면 환불 범위가 제한될 수 있어요.", confirmNote: "읽기 전용 화면에서는 진행 버튼이 잠겨 있습니다.", cancel: "다시 보기", proceed: "진행하기", locked: "진행 잠금"
    },
    en: {
      title: "Support guide", description: "Review support amounts, identity requirements, and refund guidance in read-only mode.", back: "Back to Character Chat",
      panelLabel: "Premium chat support status", stepsLabel: "Support steps", stepAmount: "Choose amount", stepReview: "Review", stepComplete: "Complete",
      loadingLabel: "Checking status", loadingText: "Loading the support policy.", fixedLegend: "Fixed support amount", fixedAria: "Choose a fixed support amount", customLegend: "Custom amount", amountLabel: "Support amount (L)", amountPlaceholder: "1 - 50,000",
      messageLegend: "Message", messagePlaceholder: "Draft an encouragement message.", messageHint: "This screen is read-only. Submission is unavailable.", summaryEmpty: "Choose an amount to see the total.", summarySelected: "{amount}L support guide", highValueTag: "High-value support · identity required",
      integerOnly: "Enter a whole number.", customRange: "Custom amounts are available from {min}L to {max}L.", disabledLabel: "Support unavailable", disabledText: "Support is not available yet. We will let you know when it opens.", unauthText: "Log in to check whether support is available. You can review amounts and policy now.", readyLabel: "Support available", readyText: "High-value support is available only to identity-verified accounts.",
      policyHigh: "Support of {amount}L or more is available only to identity-verified accounts.", policyDaily: "Daily support is limited to {amount}L.", policyBlocked: "Support may be locked in rooms under report or operations review.", policyReview: "No response for 24 hours may be reviewed for a refund.", policyRefund: "Refund amounts may be limited by the applicable policy.", hub: "View hub", confirmInfo: "Review support guide", selectAmount: "Choose amount", confirmAmount: "Support {amount}L", confirmTitle: "Confirm high-value support", confirmBody: "Confirm support with the amount below.", confirmIdentity: "This amount requires identity verification.", confirmDaily: "It can proceed only within the daily limit.", confirmRefund: "Refund scope may be limited by policy.", confirmNote: "The proceed button is locked in read-only mode.", cancel: "Back", proceed: "Proceed", locked: "Locked"
    },
    ja: {
      title: "支援ガイド", description: "支援額、本人確認の条件、返金案内を読み取り専用で確認できます。", back: "キャラクターチャットに戻る",
      panelLabel: "プレミアムチャットの支援状況", stepsLabel: "支援の手順", stepAmount: "金額を選択", stepReview: "内容を確認", stepComplete: "完了",
      loadingLabel: "状態を確認中", loadingText: "支援ポリシーを読み込んでいます。", fixedLegend: "定額の支援", fixedAria: "定額の支援額を選択", customLegend: "金額を入力", amountLabel: "支援額 (L)", amountPlaceholder: "1 - 50,000",
      messageLegend: "メッセージ", messagePlaceholder: "応援メッセージを下書きできます。", messageHint: "この画面は読み取り専用です。送信はできません。", summaryEmpty: "金額を選ぶと合計が表示されます。", summarySelected: "{amount}L の支援ガイド", highValueTag: "高額支援・本人確認が必要",
      integerOnly: "整数を入力してください。", customRange: "直接入力は {min}L から {max}L までです。", disabledLabel: "支援は準備中", disabledText: "現在、支援は利用できません。利用可能になったらお知らせします。", unauthText: "ログインすると支援可否を確認できます。現在は金額とポリシーを確認できます。", readyLabel: "支援可能", readyText: "高額支援は本人確認が完了したアカウントのみ利用できます。",
      policyHigh: "{amount}L 以上の支援は本人確認済みのアカウントのみ利用できます。", policyDaily: "1日の支援合計は {amount}L までです。", policyBlocked: "通報または運営確認中のルームでは支援がロックされる場合があります。", policyReview: "24時間応答がない場合は返金の確認対象になることがあります。", policyRefund: "ポリシーにより返金額が制限される場合があります。", hub: "ハブを見る", confirmInfo: "支援ガイドを確認", selectAmount: "金額を選択", confirmAmount: "{amount}L を支援", confirmTitle: "高額支援の確認", confirmBody: "以下の金額で支援するか確認します。", confirmIdentity: "この金額には本人確認が必要です。", confirmDaily: "1日の上限内でのみ進められます。", confirmRefund: "ポリシーにより返金範囲が制限される場合があります。", confirmNote: "読み取り専用画面では進行ボタンはロックされています。", cancel: "戻る", proceed: "進む", locked: "ロック中"
    },
    "zh-Hans": {
      title: "支持指南", description: "以只读方式查看支持金额、身份验证条件和退款说明。", back: "返回角色聊天",
      panelLabel: "高级聊天支持状态", stepsLabel: "支持步骤", stepAmount: "选择金额", stepReview: "确认内容", stepComplete: "完成",
      loadingLabel: "正在确认状态", loadingText: "正在加载支持政策。", fixedLegend: "固定支持金额", fixedAria: "选择固定支持金额", customLegend: "自定义金额", amountLabel: "支持金额 (L)", amountPlaceholder: "1 - 50,000",
      messageLegend: "留言", messagePlaceholder: "可以拟写鼓励留言。", messageHint: "此页面为只读模式，无法提交。", summaryEmpty: "选择金额后将显示合计。", summarySelected: "{amount}L 支持指南", highValueTag: "高额支持 · 需要身份验证",
      integerOnly: "请输入整数。", customRange: "自定义金额范围为 {min}L 至 {max}L。", disabledLabel: "暂不可支持", disabledText: "目前无法使用支持功能，开放后会通知您。", unauthText: "登录后可确认是否可以支持。现在可查看金额和政策。", readyLabel: "可以支持", readyText: "高额支持仅限已完成身份验证的账号。",
      policyHigh: "{amount}L 及以上支持仅限已完成身份验证的账号。", policyDaily: "每日支持合计上限为 {amount}L。", policyBlocked: "处于举报或运营审核中的房间可能会锁定支持。", policyReview: "24小时未响应可能会进入退款审核。", policyRefund: "退款金额可能会受适用政策限制。", hub: "查看中心", confirmInfo: "确认支持指南", selectAmount: "选择金额", confirmAmount: "支持 {amount}L", confirmTitle: "确认高额支持", confirmBody: "请确认是否按以下金额支持。", confirmIdentity: "此金额需要身份验证。", confirmDaily: "仅可在每日限额内进行。", confirmRefund: "退款范围可能会受政策限制。", confirmNote: "只读模式下，继续按钮处于锁定状态。", cancel: "返回", proceed: "继续", locked: "已锁定"
    },
    "zh-Hant": {
      title: "支持指南", description: "以唯讀方式查看支持金額、身分驗證條件和退款說明。", back: "返回角色聊天",
      panelLabel: "進階聊天支持狀態", stepsLabel: "支持步驟", stepAmount: "選擇金額", stepReview: "確認內容", stepComplete: "完成",
      loadingLabel: "正在確認狀態", loadingText: "正在載入支持政策。", fixedLegend: "固定支持金額", fixedAria: "選擇固定支持金額", customLegend: "自訂金額", amountLabel: "支持金額 (L)", amountPlaceholder: "1 - 50,000",
      messageLegend: "留言", messagePlaceholder: "可以擬寫鼓勵留言。", messageHint: "此頁面為唯讀模式，無法提交。", summaryEmpty: "選擇金額後將顯示合計。", summarySelected: "{amount}L 支持指南", highValueTag: "高額支持 · 需要身分驗證",
      integerOnly: "請輸入整數。", customRange: "自訂金額範圍為 {min}L 至 {max}L。", disabledLabel: "暫不可支持", disabledText: "目前無法使用支持功能，開放後會通知您。", unauthText: "登入後可確認是否可以支持。現在可查看金額和政策。", readyLabel: "可以支持", readyText: "高額支持僅限已完成身分驗證的帳號。",
      policyHigh: "{amount}L 以上支持僅限已完成身分驗證的帳號。", policyDaily: "每日支持合計上限為 {amount}L。", policyBlocked: "處於檢舉或營運審核中的房間可能會鎖定支持。", policyReview: "24小時未回應可能會進入退款審核。", policyRefund: "退款金額可能會受適用政策限制。", hub: "查看中心", confirmInfo: "確認支持指南", selectAmount: "選擇金額", confirmAmount: "支持 {amount}L", confirmTitle: "確認高額支持", confirmBody: "請確認是否按以下金額支持。", confirmIdentity: "此金額需要身分驗證。", confirmDaily: "僅可在每日限額內進行。", confirmRefund: "退款範圍可能會受政策限制。", confirmNote: "唯讀模式下，繼續按鈕處於鎖定狀態。", cancel: "返回", proceed: "繼續", locked: "已鎖定"
    }
  };

  function supportLocale() {
    var locale = window.luminaI18n && typeof window.luminaI18n.getLocale === "function" ? window.luminaI18n.getLocale() : "ko";
    return SUPPORT_COPY[locale] ? locale : "ko";
  }

  function supportText(key, values) {
    var value = SUPPORT_COPY[supportLocale()][key] || SUPPORT_COPY.en[key] || "";
    return String(value).replace(/\{(\w+)\}/g, function (_, token) {
      return values && values[token] != null ? String(values[token]) : "";
    });
  }

  function $(id) { return document.getElementById(id); }

  function formatLumina(amount) {
    var num = Number(amount);
    if (!Number.isFinite(num)) return "0";
    var locale = { ko: "ko-KR", en: "en-US", ja: "ja-JP", "zh-Hans": "zh-CN", "zh-Hant": "zh-TW" }[supportLocale()] || "en-US";
    return num.toLocaleString(locale);
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text == null ? "" : String(text);
  }

  function applyStaticCopy() {
    document.querySelectorAll("[data-support-copy]").forEach(function (el) {
      el.textContent = supportText(el.dataset.supportCopy);
    });
    document.querySelectorAll("[data-support-aria]").forEach(function (el) {
      el.setAttribute("aria-label", supportText(el.dataset.supportAria));
    });
    document.querySelectorAll("[data-support-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", supportText(el.dataset.supportPlaceholder));
    });
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
      updateSummary(supportText("integerOnly"));
      return;
    }
    var max = currentMax();
    if (n > max) {
      state.customAmount = null;
      state.selectedAmount = null;
      updateSummary(supportText("customRange", { min: formatLumina(1), max: formatLumina(max) }));
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
      parts.push('<span class="donation-summary-amount">' + supportText("summarySelected", { amount: '<strong>' + formatLumina(amount) + "</strong>" }) + "</span>");
      if (amount >= currentHighValueStart()) {
        parts.push('<span class="donation-summary-tag">' + supportText("highValueTag") + "</span>");
      }
    } else {
      parts.push('<span class="donation-summary-amount">' + supportText("summaryEmpty") + "</span>");
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
      // #484 — API의 disabledDisplayMessageKo를 신뢰하지 않음. 내부어 노출 방지를 위해 FALLBACK 고정 사용.
      btn.title = supportText("disabledText");
      label.textContent = supportText("confirmInfo");
      return;
    }
    var hasAmount = state.selectedAmount != null;
    btn.disabled = !hasAmount;
    btn.setAttribute("aria-disabled", btn.disabled ? "true" : "false");
    btn.title = hasAmount ? "" : supportText("selectAmount");
    label.textContent = hasAmount ? supportText("confirmAmount", { amount: formatLumina(state.selectedAmount) }) : supportText("selectAmount");
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
      label = supportText("disabledLabel");
      body = supportText("unauthText");
    } else if (disabled) {
      // #1341 — disabled 이유를 짧게 보이고, read-only 금액/정책 preview는 열어 둔다.
      // API 값 무시, FALLBACK 고정 (API가 내부어 포함 가능).
      label = supportText("disabledLabel");
      body = supportText("disabledText");
    } else {
      label = supportText("readyLabel");
      body = supportText("readyText");
    }
    banner.innerHTML =
      '<strong class="donation-status-label">' + label + "</strong>" +
      '<p class="donation-status-text">' + body + "</p>";
  }

  function renderPolicyInfo(contract) {
    var hv = (contract && contract.donation && contract.donation.highValuePolicy) || FALLBACK_CONTRACT.donation.highValuePolicy;
    setText(
      "donationPolicyHighValue",
      supportText("policyHigh", { amount: formatLumina(hv.startsAtLumina) })
    );
    setText(
      "donationPolicyDailyLimit",
      supportText("policyDaily", { amount: formatLumina(hv.dailyLimitLumina) })
    );
    // blockedStates 텍스트는 정적 유지 (계약상 message key 만 정의됨)
    var custom = (contract && contract.donation && contract.donation.customAmount) || FALLBACK_CONTRACT.donation.customAmount;
    var hint = $("donationCustomHint");
    if (hint) {
      hint.textContent =
        supportText("customRange", { min: formatLumina(custom.minLumina), max: formatLumina(custom.maxLumina) });
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

  function focusDonationSheet(sheet) {
    var first = sheet && (sheet.querySelector("[data-donation-close]") || sheet.querySelector("button, [href], input, select, textarea"));
    if (first && typeof first.focus === "function") {
      requestAnimationFrame(function () { first.focus({ preventScroll: true }); });
    }
  }

  function openSheet(triggerEl) {
    var sheet = $("chatDonationSheet");
    var backdrop = $("chatDonationBackdrop");
    if (!sheet || !backdrop) return;
    state.sheetTrigger = triggerEl && typeof triggerEl.focus === "function" ? triggerEl : document.activeElement;
    backdrop.hidden = false;
    sheet.hidden = false;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    document.body.classList.add("is-donation-open");
    focusDonationSheet(sheet);
    // 시트가 처음 열린 시점에 한 번 더 contract 새로고침 (token 획득 가능성).
    void initialize();
  }

  function closeSheet() {
    var sheet = $("chatDonationSheet");
    var backdrop = $("chatDonationBackdrop");
    if (sheet) sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("is-donation-open");
    var trigger = state.sheetTrigger;
    state.sheetTrigger = null;
    var fallbackTrigger = $("chatPlusToggle");
    var target = trigger && trigger.offsetParent !== null ? trigger : fallbackTrigger;
    if (target && typeof target.focus === "function") {
      requestAnimationFrame(function () { target.focus({ preventScroll: true }); });
    }
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
      proceed.textContent = mutationOpen ? supportText("proceed") : supportText("locked");
      // #484 — API 값 무시, FALLBACK 고정 (API가 내부어 포함 가능).
      proceed.title = mutationOpen ? "" : supportText("disabledText");
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
    applyStaticCopy();
    var result = await fetchContract();
    state.contract = result.contract;
    state.contractSource = result.source;
    renderStatusBanner(result.contract, result.source);
    renderFixedAmounts(result.contract);
    renderPolicyInfo(result.contract);
    updateConfirmButton();
    state.ready = true;
  }

  function bind() {
    applyStaticCopy();
    window.addEventListener("lumina:localechange", function () {
      applyStaticCopy();
      if (!state.contract) return;
      renderStatusBanner(state.contract, state.contractSource);
      renderPolicyInfo(state.contract);
      updateSummary();
    });
    var openBtn = $("chatDonationOpen");
    if (openBtn && !openBtn.dataset.bound) {
      openBtn.dataset.bound = "1";
      openBtn.disabled = false;
      openBtn.setAttribute("aria-disabled", "false");
      openBtn.addEventListener("click", function (event) {
        event.preventDefault();
        openSheet(openBtn);
      });
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
    if (!state.escBound) {
      state.escBound = true;
      document.addEventListener("keydown", function (event) {
        var sheet = $("chatDonationSheet");
        if (event.key === "Escape" && sheet && !sheet.hidden) {
          event.preventDefault();
          closeSheet();
        }
      });
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
