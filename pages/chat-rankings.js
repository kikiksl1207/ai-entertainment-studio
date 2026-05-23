// #329/#351 — 소통/후원 랭킹 페이지.
// 4상태(loading / empty / error / success)를 명확히 분리한다.
// 백엔드 endpoint(GET /api/v1/chat/rankings)는 contract `status: planned` 동안 호출하지 않고
// empty 상태로 안내한다. enabled가 true가 되는 순간 실제 호출 + success 렌더 활성.
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.LuminaChatRankings) return;

  var API_BASE = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
  var CONTRACT_PATH = "/api/v1/chat/premium-support-contract";
  var RANKINGS_PATH = "/api/v1/chat/rankings";

  var state = {
    type: "communication",
    period: "daily",
    contract: null,
    contractStatus: "loading", // loading | ready | error | unauth
    rankings: null,
    rankingsStatus: "idle",    // idle | loading | success | error | empty
    rows: [],
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function authToken() {
    try {
      if (typeof window.getAccessToken === "function") {
        var t = window.getAccessToken();
        if (t) return t;
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
    if (!token) return { status: "unauth", contract: null };
    try {
      var res = await fetch(API_BASE + CONTRACT_PATH, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) return { status: "error", contract: null };
      var data = await res.json();
      var contract = data && data.contract ? data.contract : data;
      return { status: "ready", contract: contract };
    } catch (_) {
      return { status: "error", contract: null };
    }
  }

  function rankingsEnabled(contract) {
    var ep = contract && contract.endpoints && contract.endpoints.rankings;
    if (!ep) return false;
    return ep.enabled === true || ep.status === "live" || ep.status === "ready";
  }

  async function fetchRankings() {
    var token = authToken();
    if (!token) return { status: "unauth", items: [] };
    var params = new URLSearchParams();
    params.set("type", state.type);
    params.set("period", state.period);
    params.set("take", "20");
    try {
      var res = await fetch(API_BASE + RANKINGS_PATH + "?" + params.toString(), {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) return { status: "error", items: [] };
      var data = await res.json();
      var items = (data && (data.items || (data.data && data.data.items))) || [];
      return { status: items.length ? "success" : "empty", items: items };
    } catch (_) {
      return { status: "error", items: [] };
    }
  }

  // ── view rendering ───────────────────────────────────────────────────────

  function setPanelState(value) {
    var panel = $("chatRankingsPanel");
    if (panel) panel.setAttribute("data-rankings-state", value);
  }

  function showOnly(elementId) {
    var ids = ["chatRankingsSkeleton", "chatRankingsEmpty", "chatRankingsError", "chatRankingsRows"];
    ids.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.hidden = id !== elementId;
    });
  }

  function setStateLabel(text) {
    var el = $("chatRankingsStateLabel");
    if (el) el.textContent = text;
  }

  function setTitleSubtitle() {
    var title = $("chatRankingsBoardTitle");
    var subtitle = $("chatRankingsBoardSubtitle");
    if (state.type === "donation") {
      if (title) title.textContent = "후원 랭킹";
      // #370 — 사용자 화면 카피에서 내부/영문 용어(net Lumina, row) 제거.
      if (subtitle) subtitle.textContent = "확정된 후원 합계 기준 랭킹입니다. 환불·블라인드 처리된 항목은 제외돼요.";
    } else {
      if (title) title.textContent = "소통 TOP";
      if (subtitle) subtitle.textContent = "방 열기, 대화, 후원 활동을 합산한 아티스트별 활동 점수입니다.";
    }
  }

  function renderLoading() {
    setPanelState("loading");
    setStateLabel("불러오는 중");
    setTitleSubtitle();
    showOnly("chatRankingsSkeleton");
  }

  function renderEmpty(reason) {
    setPanelState("empty");
    setTitleSubtitle();
    var title = $("chatRankingsEmptyTitle");
    var body = $("chatRankingsBoardMessage");
    if (reason === "unauth") {
      setStateLabel("로그인 필요");
      if (title) title.textContent = "로그인하면 랭킹을 볼 수 있어요";
      if (body) body.textContent = "프리미엄챗 소통/후원 랭킹은 로그인한 팬에게만 공개돼요. 먼저 로그인해 주세요.";
    } else if (reason === "disabled") {
      setStateLabel("원장·보안 검증 대기");
      var disabledMsg = state.contract && state.contract.policy && state.contract.policy.disabledDisplayMessageKo;
      // #379 — "준비 중" 직접 노출 톤 변경.
      if (title) title.textContent = "랭킹 데이터를 모으는 중이에요";
      if (body) body.textContent = state.type === "donation"
        ? (disabledMsg || "후원 랭킹은 원장·보안 검증이 끝난 뒤 공개돼요.")
        : "소통 랭킹은 원장·검증이 끝난 뒤 함께 공개돼요.";
    } else {
      // 0건
      setStateLabel("0건");
      if (title) title.textContent = (state.type === "donation" ? "후원 랭킹" : "소통 TOP") + " 데이터가 아직 없어요";
      if (body) body.textContent = "이 기간에 집계된 활동이 없어요. 다른 기간을 선택하거나 잠시 후 다시 확인해 주세요.";
    }
    showOnly("chatRankingsEmpty");
  }

  function renderError() {
    setPanelState("error");
    setStateLabel("불러오기 실패");
    setTitleSubtitle();
    showOnly("chatRankingsError");
  }

  function renderSuccess(rows) {
    setPanelState("success");
    setStateLabel(rows.length + "위 노출");
    setTitleSubtitle();
    var container = $("chatRankingsRows");
    if (!container) return;
    container.innerHTML = rows.map(function (row, idx) {
      var rank = Number(row.rankNo || idx + 1);
      var name = escapeHtml(row.displayName || row.artistSlug || "");
      var slug = row.artistSlug || "";
      var score = escapeHtml(row.score != null ? String(row.score) : "0");
      var scoreLabel = state.type === "donation" ? "후원 합계 L" : "활동 점수";
      var profileHref = slug ? "/character-detail?slug=" + encodeURIComponent(slug) : "/characters";
      return (
        '<li class="chat-rankings-row">' +
          '<span class="chat-rankings-row-rank">' + rank + '</span>' +
          '<a class="chat-rankings-row-name" href="' + profileHref + '">' + name + '</a>' +
          '<span class="chat-rankings-row-score" aria-label="' + scoreLabel + '">' + score + '</span>' +
        '</li>'
      );
    }).join("");
    showOnly("chatRankingsRows");
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

  async function refresh() {
    renderLoading();
    if (state.contractStatus !== "ready" || !state.contract) {
      var contractResult = await fetchContract();
      state.contract = contractResult.contract;
      state.contractStatus = contractResult.status;
    }
    if (state.contractStatus === "unauth") {
      renderEmpty("unauth");
      return;
    }
    if (state.contractStatus === "error") {
      renderError();
      return;
    }
    if (!rankingsEnabled(state.contract)) {
      renderEmpty("disabled");
      return;
    }
    // 활성화된 경우에만 실제 랭킹 fetch
    var result = await fetchRankings();
    if (result.status === "unauth") { renderEmpty("unauth"); return; }
    if (result.status === "error")  { renderError(); return; }
    if (result.status === "empty")  { renderEmpty("zero"); return; }
    renderSuccess(result.items);
  }

  function bindUi() {
    document.querySelectorAll("[data-chat-rankings-tab]").forEach(function (el) {
      if (el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", function () {
        state.type = el.getAttribute("data-chat-rankings-tab") || "communication";
        updateTabState();
        refresh();
      });
    });
    document.querySelectorAll("[data-chat-rankings-period]").forEach(function (el) {
      if (el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", function () {
        state.period = el.getAttribute("data-chat-rankings-period") || "daily";
        updateTabState();
        refresh();
      });
    });
    var retry = $("chatRankingsRetryBtn");
    if (retry && !retry.dataset.bound) {
      retry.dataset.bound = "1";
      retry.addEventListener("click", function () {
        state.contractStatus = "loading";
        state.contract = null;
        refresh();
      });
    }
  }

  function init() {
    // #407 — URL ?type= 쿼리로 초기 탭 결정.
    // type=donation → 후원 랭킹, type=communication → 소통 TOP, 없거나 허용값 외 → 기본값 유지.
    var urlType = new URLSearchParams(window.location.search).get("type");
    if (urlType === "donation" || urlType === "communication") {
      state.type = urlType;
    }
    bindUi();
    updateTabState();
    refresh();
  }

  window.LuminaChatRankings = { init: init, refresh: refresh };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
