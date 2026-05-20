// #336 — 프리미엄챗 허브: 내가 열어둔 채팅방 + 랭킹 진입 카드.
// 좋아요 응원은 /lumina-pick, 소통/후원 랭킹은 /chat-rankings로 분리한다.
// 실제 차감/오픈 POST는 #328 contract.policy.walletMutationEnabled 가 true 가 되기 전까지 잠금 유지.
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.LuminaPremiumChatHub) return;

  var API_BASE = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");

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

  async function fetchJson(path) {
    var token = authToken();
    if (!token) return { error: "unauth" };
    try {
      var res = await fetch(API_BASE + path, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) return { error: "http-" + res.status };
      return { data: await res.json() };
    } catch (_) {
      return { error: "network" };
    }
  }

  function setState(text) {
    var el = $("premiumChatRoomsState");
    if (el) el.textContent = text;
  }

  function renderRooms(rooms, mutationOpen) {
    var list = $("premiumChatRoomsList");
    if (!list) return;
    if (!rooms.length) {
      list.innerHTML =
        '<li class="premium-chat-hub-rooms-empty">' +
          '<p>아직 열어둔 프리미엄 채팅방이 없어요.</p>' +
          '<p class="premium-chat-hub-rooms-empty-note">아티스트 라인업에서 프로필을 열고 "이 아티스트와 대화하기"로 들어가면 채팅방이 만들어져요.</p>' +
          '<a class="premium-chat-hub-rooms-empty-cta" href="/characters">아티스트 보러 가기 →</a>' +
        '</li>';
      return;
    }
    list.innerHTML = rooms.map(function (room) {
      var slug = room.slug || "";
      var name = escapeHtml(room.name || slug || "아티스트");
      var summary = escapeHtml(room.summary || "");
      var statusLabel = mutationOpen ? "후원 가능" : "후원 잠금";
      var statusClass = mutationOpen ? "is-ready" : "is-locked";
      var chatHref = slug ? "/character-chat?slug=" + encodeURIComponent(slug) : "/character-chat";
      var profileHref = slug ? "/character-detail?slug=" + encodeURIComponent(slug) : "/characters";
      var avatarStyle = slug
        ? 'style="background-image:url(\'/assets/characters/' + encodeURIComponent(slug) + '/thumb.png\')"'
        : "";
      var lastMessage = escapeHtml(room.lastMessageAt || room.updatedAt || "");
      return (
        '<li class="premium-chat-hub-room">' +
          '<a class="premium-chat-hub-room-main" href="' + chatHref + '" aria-label="' + name + ' 채팅방 열기">' +
            '<span class="premium-chat-hub-room-avatar" aria-hidden="true" ' + avatarStyle + '></span>' +
            '<span class="premium-chat-hub-room-body">' +
              '<strong>' + name + '</strong>' +
              (summary ? '<span class="premium-chat-hub-room-summary">' + summary + '</span>' : "") +
              (lastMessage ? '<span class="premium-chat-hub-room-time">' + lastMessage + '</span>' : "") +
            '</span>' +
            '<span class="premium-chat-hub-room-badge ' + statusClass + '">' + statusLabel + '</span>' +
          '</a>' +
          '<a class="premium-chat-hub-room-profile" href="' + profileHref + '">프로필 보기</a>' +
        '</li>'
      );
    }).join("");
  }

  function normalizeConversation(item) {
    var artist = item.artist || item.peer || {};
    return {
      slug: artist.slug || item.artistSlug || item.slug || "",
      name: artist.displayName || artist.name || item.artistName || "",
      summary: artist.statusLine || item.lastMessagePreview || "",
      updatedAt: item.lastMessageAt || item.updatedAt || "",
    };
  }

  async function load() {
    var head = $("chatListShell");
    if (!head || head.dataset.hubLoaded === "1") return;
    head.dataset.hubLoaded = "1";

    // 1) contract
    var contractRes = await fetchJson("/api/v1/chat/premium-support-contract");
    var contract = contractRes.data && (contractRes.data.contract || contractRes.data) || null;
    var mutationOpen = !!(contract && contract.policy && contract.policy.walletMutationEnabled);

    if (contractRes.error === "unauth") {
      setState("로그인이 필요해요");
      renderRooms([], false);
      return;
    }

    // 2) conversations (read-only) — 프리미엄 전용 필터가 contract에서 정의되기 전까지 모든 방을 보여준다.
    var convRes = await fetchJson("/api/v1/chat/conversations?box=all&take=10");
    if (convRes.error === "unauth") {
      setState("로그인이 필요해요");
      renderRooms([], mutationOpen);
      return;
    }
    if (convRes.error) {
      setState(mutationOpen ? "데이터 로드 실패" : "원장·보안 검증 대기");
      renderRooms([], mutationOpen);
      return;
    }
    var items = (convRes.data && (convRes.data.items || convRes.data.data?.items)) || [];
    var rooms = items.map(normalizeConversation).filter(function (r) { return r.slug || r.name; });
    setState(mutationOpen ? "준비 완료" : "후원 잠금 · 진입만 가능");
    renderRooms(rooms.slice(0, 6), mutationOpen);
  }

  window.LuminaPremiumChatHub = { load: load };

  function maybeStart() {
    // chatListShell이 등장(slug 없이 진입한 리스트 모드)할 때만 로드.
    var shell = $("chatListShell");
    if (!shell || shell.hidden) return;
    load();
  }

  // chatListShell 가시화는 character-chat.js가 결정한다. 페이지 로드 후 잠시 폴링.
  function pollForListShell() {
    var attempts = 0;
    var iv = setInterval(function () {
      attempts += 1;
      var shell = $("chatListShell");
      if (shell && !shell.hidden) {
        clearInterval(iv);
        load();
        return;
      }
      if (attempts > 20) {
        clearInterval(iv);
      }
    }, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", pollForListShell);
  } else {
    pollForListShell();
  }
})();
