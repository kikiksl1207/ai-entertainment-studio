// #329 — 소통/후원 랭킹 페이지. 백엔드 endpoint(GET /api/v1/chat/rankings)는 contract `status: planned` 상태라
// read-only 안내 + tab/period UI scaffold만 노출. 실제 호출은 endpoints.rankings.enabled 가 true가 되는 시점에 추가한다.
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.LuminaChatRankings) return;

  var API_BASE = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
  var CONTRACT_PATH = "/api/v1/chat/premium-support-contract";

  var state = {
    type: "communication",
    period: "daily",
    contract: null,
  };

  function $(id) { return document.getElementById(id); }

  function authToken() {
    try {
      var raw = window.localStorage && window.localStorage.getItem("lumina.session");
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && (parsed.accessToken || parsed.token) || null;
    } catch (_) { return null; }
  }

  async function fetchContract() {
    var token = authToken();
    if (!token) return null;
    try {
      var res = await fetch(API_BASE + CONTRACT_PATH, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) return null;
      var data = await res.json();
      return data && data.contract ? data.contract : data;
    } catch (_) { return null; }
  }

  function rankingsEnabled(contract) {
    var ep = contract && contract.endpoints && contract.endpoints.rankings;
    if (!ep) return false;
    return ep.enabled === true || ep.status === "live" || ep.status === "ready";
  }

  function renderState() {
    var label = $("chatRankingsStateLabel");
    var body = $("chatRankingsBoardMessage");
    var title = $("chatRankingsBoardTitle");
    var subtitle = $("chatRankingsBoardSubtitle");
    if (!label) return;
    var enabled = rankingsEnabled(state.contract);
    var disabledMsg = state.contract && state.contract.policy && state.contract.policy.disabledDisplayMessageKo;
    if (enabled) {
      label.textContent = "준비 완료";
    } else {
      label.textContent = state.contract ? "원장·보안 검증 대기" : "정책 로딩";
    }
    if (state.type === "donation") {
      if (title) title.textContent = "후원 랭킹";
      if (subtitle) subtitle.textContent = "확정 후원 합계(net Lumina) 기준 랭킹입니다. 환불/블라인드된 row는 제외돼요.";
      if (body) body.textContent = enabled
        ? "데이터를 불러오는 중이에요."
        : (disabledMsg || "후원 랭킹은 원장·보안 검증이 끝난 뒤 공개돼요.");
    } else {
      if (title) title.textContent = "소통 TOP";
      if (subtitle) subtitle.textContent = "방 열기, 대화, 후원 활동을 합산한 아티스트별 활동 점수입니다.";
      if (body) body.textContent = enabled
        ? "데이터를 불러오는 중이에요."
        : "소통 랭킹은 원장·검증이 끝난 뒤 함께 공개돼요.";
    }
  }

  function updateTabState() {
    document.querySelectorAll("[data-chat-rankings-tab]").forEach(function (el) {
      var on = el.getAttribute("data-chat-rankings-tab") === state.type;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("[data-chat-rankings-period]").forEach(function (el) {
      var on = el.getAttribute("data-chat-rankings-period") === state.period;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function bindTabs() {
    document.querySelectorAll("[data-chat-rankings-tab]").forEach(function (el) {
      if (el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", function () {
        state.type = el.getAttribute("data-chat-rankings-tab") || "communication";
        updateTabState();
        renderState();
      });
    });
    document.querySelectorAll("[data-chat-rankings-period]").forEach(function (el) {
      if (el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", function () {
        state.period = el.getAttribute("data-chat-rankings-period") || "daily";
        updateTabState();
        renderState();
      });
    });
  }

  async function init() {
    bindTabs();
    updateTabState();
    state.contract = await fetchContract();
    renderState();
  }

  window.LuminaChatRankings = { init: init };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
