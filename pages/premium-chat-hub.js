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

  // #479 — donation sheet 열기 (방 목록 후원 버튼용 이벤트 델리게이션)
  function bindRoomDonateButtons() {
    var list = $("premiumChatRoomsList");
    if (!list || list.dataset.donateBound === "1") return;
    list.dataset.donateBound = "1";
    list.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-room-donate]");
      if (!btn) return;
      if (btn.getAttribute("aria-disabled") === "true") return;
      e.preventDefault();
      var sheet = $("chatDonationSheet");
      var backdrop = $("chatDonationBackdrop");
      if (sheet) { sheet.hidden = false; }
      if (backdrop) { backdrop.hidden = false; }
    });
  }

  function renderRooms(rooms, mutationOpen) {
    var list = $("premiumChatRoomsList");
    if (!list) return;
    bindRoomDonateButtons();
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
      var lastMessage = escapeHtml(room.updatedAt || "");

      // #518 — 방 상태별 UX 보강: 만료 임박 urgency / blocked 진입 차단 / per-room 후원 잠금
      var isBlocked = room.roomStatus === "blocked" || room.roomStatus === "under_review";
      var isExpiringSoon = room.remainingDays != null && room.remainingDays <= 3;

      // 상태 배지 목록
      var detailParts = [];
      if (room.remainingDays != null) {
        var remainingCls = "premium-chat-hub-room-remaining" + (isExpiringSoon ? " is-expiring" : "");
        var remainingLabel = isExpiringSoon
          ? room.remainingDays + "일 남음 · 만료 임박"
          : room.remainingDays + "일 남음";
        detailParts.push('<span class="' + remainingCls + '">' + remainingLabel + '</span>');
      }
      if (room.unanswered) {
        detailParts.push('<span class="premium-chat-hub-room-unanswered">24시간 답변 대기 중</span>');
      }
      if (isBlocked) {
        detailParts.push('<span class="premium-chat-hub-room-status is-blocked">신고·운영 검토 중 · 입장 일시 중단</span>');
      } else if (room.roomStatus === "refund_review") {
        detailParts.push('<span class="premium-chat-hub-room-status is-refund">환불 검토 중</span>');
      }
      var detailHtml = detailParts.length
        ? '<span class="premium-chat-hub-room-detail">' + detailParts.join("") + '</span>'
        : "";

      // #518 — 후원 버튼: 전역 잠금(mutationOpen) + per-room 차단(blocked) 모두 확인
      var donateDisabled = !mutationOpen || isBlocked;
      var donateBtnLabel = isBlocked ? "후원 일시 중단" : (mutationOpen ? "후원하기" : "후원 안내 예정");
      var donateBtnDisabled = donateDisabled ? ' aria-disabled="true" tabindex="-1"' : "";
      var donateBtnCls = "premium-chat-hub-room-donate-btn" + (donateDisabled ? " is-locked" : "");

      // #518 — blocked 방은 채팅 진입 링크를 비활성 span으로 교체 (AI챗 오연결 방지 연장)
      var roomBodyHtml =
        '<span class="premium-chat-hub-room-avatar" aria-hidden="true" ' + avatarStyle + '></span>' +
        '<span class="premium-chat-hub-room-body">' +
          '<strong>' + name + '</strong>' +
          (summary ? '<span class="premium-chat-hub-room-summary">' + summary + '</span>' : "") +
          detailHtml +
          (lastMessage ? '<span class="premium-chat-hub-room-time">' + lastMessage + '</span>' : "") +
        '</span>' +
        '<span class="premium-chat-hub-room-badge ' + statusClass + '">' + statusLabel + '</span>';
      var roomMainHtml = isBlocked
        ? '<span class="premium-chat-hub-room-main is-blocked" aria-label="' + name + ' 채팅방 — 현재 검토 중">' + roomBodyHtml + '</span>'
        : '<a class="premium-chat-hub-room-main" href="' + chatHref + '" aria-label="' + name + ' 채팅방 열기">' + roomBodyHtml + '</a>';

      return (
        '<li class="premium-chat-hub-room' + (isBlocked ? " is-blocked" : "") + (isExpiringSoon ? " is-expiring" : "") + '">' +
          roomMainHtml +
          '<div class="premium-chat-hub-room-actions">' +
            '<a class="premium-chat-hub-room-profile" href="' + profileHref + '">프로필 보기</a>' +
            '<button type="button" class="' + donateBtnCls + '" data-room-donate="' + escapeHtml(slug) + '"' + donateBtnDisabled + '>' + donateBtnLabel + '</button>' +
          '</div>' +
        '</li>'
      );
    }).join("");
  }

  // ── #469 — 프리미엄챗 가능 아티스트 렌더 ────────────────────────────────────

  function renderAvailableArtists(artists, mutationOpen) {
    var list = $("premiumChatAvailableArtists");
    var stateEl = $("premiumChatArtistsState");
    if (!list) return;
    if (!artists.length) {
      if (stateEl) stateEl.textContent = "0명";
      list.innerHTML =
        '<li class="premium-chat-available-artists-empty">' +
          '<p>아직 프리미엄챗 가능 아티스트가 없어요.</p>' +
          '<a class="premium-chat-available-artists-cta" href="/characters">아티스트 라인업 보기 →</a>' +
        '</li>';
      return;
    }
    if (stateEl) stateEl.textContent = artists.length + "명";
    list.innerHTML = artists.map(function (artist) {
      var slug = artist.slug || "";
      var name = escapeHtml(artist.displayName || artist.name || slug || "아티스트");
      var profileHref = slug ? "/character-detail?slug=" + encodeURIComponent(slug) : "/characters";
      var chatHref = slug ? "/character-chat?slug=" + encodeURIComponent(slug) : "/character-chat";
      var avatarStyle = slug
        ? ' style="background-image:url(\'/assets/characters/' + encodeURIComponent(slug) + '/thumb.png\')"'
        : "";
      var btnLabel = mutationOpen ? "채팅 열기" : "채팅 안내 예정";
      var disabledAttrs = mutationOpen ? "" : ' aria-disabled="true" tabindex="-1"';
      return (
        '<li class="premium-chat-available-artist">' +
          '<span class="premium-chat-available-artist-avatar" aria-hidden="true"' + avatarStyle + '></span>' +
          '<strong class="premium-chat-available-artist-name">' + name + '</strong>' +
          '<a class="premium-chat-available-artist-profile" href="' + profileHref + '">프로필 보기</a>' +
          '<a class="premium-chat-available-artist-chat" href="' + chatHref + '"' + disabledAttrs + '>' + btnLabel + '</a>' +
        '</li>'
      );
    }).join("");
  }

  async function loadAvailableArtists(mutationOpen) {
    var list = $("premiumChatAvailableArtists");
    var stateEl = $("premiumChatArtistsState");
    if (!list) return;

    // 1) API 시도
    var res = await fetchJson("/api/v1/chat/premium-available-artists");
    if (res.data) {
      var apiItems = res.data.items || res.data.artists || (Array.isArray(res.data) ? res.data : []);
      if (stateEl) stateEl.textContent = apiItems.length ? apiItems.length + "명" : "0명";
      renderAvailableArtists(apiItems.slice(0, 12), mutationOpen);
      return;
    }

    // 2) window.LuminaCharacterData fallback (CMS 주입 데이터)
    if (window.LuminaCharacterData && Array.isArray(window.LuminaCharacterData)) {
      var eligible = window.LuminaCharacterData.filter(function (c) {
        return c.premiumChatAvailable || c.hasPremiumChat;
      });
      var fallback = eligible.length ? eligible : window.LuminaCharacterData.slice(0, 8);
      if (stateEl) stateEl.textContent = fallback.length + "명";
      renderAvailableArtists(fallback.slice(0, 12), mutationOpen);
      return;
    }

    // 3) 404/501 — 엔드포인트 미개방 (contract: planned 상태)
    if (stateEl) stateEl.textContent = "준비 중"; // #474 내부 용어 제거
    list.innerHTML =
      '<li class="premium-chat-available-artists-empty">' +
        '<p>프리미엄챗 가능 아티스트는 서비스 준비 완료 후 공개돼요.</p>' +
        '<a class="premium-chat-available-artists-cta" href="/characters">아티스트 라인업 보기 →</a>' +
      '</li>';
  }

  function normalizeConversation(item) {
    var artist = item.artist || item.peer || {};
    // #479 — 방 상세: 상태·남은 기간·미답변 추출.
    var roomStatus = item.status || item.roomStatus || "normal";
    var remainingDays = null;
    if (item.expiresAt || item.expiredAt) {
      var diff = new Date(item.expiresAt || item.expiredAt) - Date.now();
      remainingDays = Math.max(0, Math.ceil(diff / 86400000));
    } else if (item.remainingDays != null) {
      remainingDays = Number(item.remainingDays);
    }
    var unanswered = !!(item.artistUnresponded || item.hasUnansweredMessage || false);
    return {
      slug: artist.slug || item.artistSlug || item.slug || "",
      name: artist.displayName || artist.name || item.artistName || "",
      summary: artist.statusLine || item.lastMessagePreview || "",
      updatedAt: item.lastMessageAt || item.updatedAt || "",
      roomStatus: roomStatus,
      remainingDays: remainingDays,
      unanswered: unanswered,
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
      setState(mutationOpen ? "데이터 로드 실패" : "서비스 준비 중"); // #474 내부 용어 제거
      renderRooms([], mutationOpen);
      loadAvailableArtists(mutationOpen); // #469 — 방 목록 실패여도 아티스트 목록은 시도
      return;
    }
    var items = (convRes.data && (convRes.data.items || convRes.data.data?.items)) || [];
    var rooms = items.map(normalizeConversation).filter(function (r) { return r.slug || r.name; });
    setState(mutationOpen ? "준비 완료" : "후원 잠금 · 진입만 가능");
    renderRooms(rooms.slice(0, 6), mutationOpen);
    loadAvailableArtists(mutationOpen); // #469 — 가능 아티스트 목록 병렬 로드
  }

  // ── #390 — 루미나 피드 진입 영역 (피드 사이드 패널용 경량 렌더) ────────────────

  function setFeedState(text) {
    var el = $("feedPremiumRoomsState");
    if (el) el.textContent = text;
  }

  function renderFeedRooms(rooms) {
    var list = $("feedPremiumRoomsList");
    if (!list) return;
    if (!rooms.length) {
      list.innerHTML =
        '<li class="feed-premium-entry-rooms-empty">' +
          '아직 열어둔 방이 없어요. ' +
          '<a class="feed-premium-entry-rooms-cta" href="/characters">아티스트 보러 가기 →</a>' +
        '</li>';
      return;
    }
    list.innerHTML = rooms.map(function (room) {
      var slug = room.slug || "";
      var name = escapeHtml(room.name || slug || "아티스트");
      var chatHref = slug ? "/character-chat?slug=" + encodeURIComponent(slug) : "/character-chat";
      var avatarStyle = slug
        ? ' style="background-image:url(\'/assets/characters/' + encodeURIComponent(slug) + '/thumb.png\')"'
        : "";
      return (
        '<li class="feed-premium-entry-room">' +
          '<a class="feed-premium-entry-room-link" href="' + chatHref + '" aria-label="' + name + ' 채팅방 열기">' +
            '<span class="feed-premium-entry-room-avatar" aria-hidden="true"' + avatarStyle + '></span>' +
            '<span class="feed-premium-entry-room-name">' + name + '</span>' +
          '</a>' +
        '</li>'
      );
    }).join("");
  }

  async function loadForFeedEntry() {
    var list = $("feedPremiumRoomsList");
    if (!list || list.dataset.feedLoaded === "1") return;
    list.dataset.feedLoaded = "1";

    // 1) contract (로그인 여부 + walletMutationEnabled 확인)
    var contractRes = await fetchJson("/api/v1/chat/premium-support-contract");
    if (contractRes.error === "unauth") {
      setFeedState("로그인 필요");
      list.innerHTML = '<li class="feed-premium-entry-rooms-empty"><a class="feed-premium-entry-rooms-cta" href="#" data-action="login">로그인하면 내 채팅방을 볼 수 있어요</a></li>';
      return;
    }

    // 2) conversations (read-only)
    var convRes = await fetchJson("/api/v1/chat/conversations?box=all&take=4");
    if (convRes.error === "unauth") {
      setFeedState("로그인 필요");
      renderFeedRooms([]);
      return;
    }
    if (convRes.error) {
      setFeedState("불러오기 실패");
      list.innerHTML = '<li class="feed-premium-entry-rooms-empty">잠시 후 다시 확인해 주세요.</li>';
      return;
    }
    var items = (convRes.data && (convRes.data.items || (convRes.data.data && convRes.data.data.items))) || [];
    var rooms = items.map(normalizeConversation).filter(function (r) { return r.slug || r.name; });
    setFeedState(rooms.length ? rooms.length + "개" : "");
    renderFeedRooms(rooms.slice(0, 4));
  }

  window.LuminaPremiumChatHub = { load: load, loadForFeedEntry: loadForFeedEntry };

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
    document.addEventListener("DOMContentLoaded", function () {
      pollForListShell();
      // 루미나 피드 페이지에 feedPremiumRoomsList가 있으면 피드 진입 영역도 초기화.
      if ($("feedPremiumRoomsList")) loadForFeedEntry();
    });
  } else {
    pollForListShell();
    if ($("feedPremiumRoomsList")) loadForFeedEntry();
  }
})();
