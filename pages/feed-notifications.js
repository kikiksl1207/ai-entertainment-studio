(function () {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const BASE = "/api/v1/me/notifications";
  const WORDS = {
    ko: { title: "\uC54C\uB9BC", close: "\uB2EB\uAE30", all: "\uC804\uCCB4", unread: "\uC77D\uC9C0 \uC54A\uC74C", refresh: "\uC0C8\uB85C\uACE0\uCE68", markAll: "\uBAA8\uB450 \uC77D\uC74C", markOne: "\uC77D\uC74C \uD45C\uC2DC", more: "\uB354 \uBCF4\uAE30", retry: "\uB2E4\uC2DC \uBD88\uB7EC\uC624\uAE30", loading: "\uBD88\uB7EC\uC624\uB294 \uC911", saving: "\uC800\uC7A5 \uC911", emptyAll: "\uC54C\uB9BC\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.", emptyUnread: "\uC77D\uC9C0 \uC54A\uC740 \uC54C\uB9BC\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.", auth: "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.", listError: "\uC54C\uB9BC\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", readError: "\uC77D\uC74C \uC0C1\uD0DC\uB97C \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", changed: "\uC54C\uB9BC \uBAA9\uB85D\uC774 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", count: "\uC77D\uC9C0 \uC54A\uC74C {n}" },
    en: { title: "Notifications", close: "Close", all: "All", unread: "Unread", refresh: "Refresh", markAll: "Read all", markOne: "Mark read", more: "Load more", retry: "Reload", loading: "Loading", saving: "Saving", emptyAll: "No notifications.", emptyUnread: "No unread notifications.", auth: "Sign in required.", listError: "Notifications could not be loaded.", readError: "Read status could not be saved.", changed: "The notification list has changed.", count: "{n} unread" },
    ja: { title: "\u901A\u77E5", close: "\u9589\u3058\u308B", all: "\u3059\u3079\u3066", unread: "\u672A\u8AAD", refresh: "\u66F4\u65B0", markAll: "\u3059\u3079\u3066\u65E2\u8AAD", markOne: "\u65E2\u8AAD\u306B\u3059\u308B", more: "\u3082\u3063\u3068\u898B\u308B", retry: "\u518D\u8AAD\u307F\u8FBC\u307F", loading: "\u8AAD\u307F\u8FBC\u307F\u4E2D", saving: "\u4FDD\u5B58\u4E2D", emptyAll: "\u901A\u77E5\u306F\u3042\u308A\u307E\u305B\u3093\u3002", emptyUnread: "\u672A\u8AAD\u306E\u901A\u77E5\u306F\u3042\u308A\u307E\u305B\u3093\u3002", auth: "\u30ED\u30B0\u30A4\u30F3\u304C\u5FC5\u8981\u3067\u3059\u3002", listError: "\u901A\u77E5\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002", readError: "\u65E2\u8AAD\u72B6\u614B\u3092\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002", changed: "\u901A\u77E5\u4E00\u89A7\u304C\u5909\u66F4\u3055\u308C\u307E\u3057\u305F\u3002", count: "\u672A\u8AAD {n}" },
    "zh-CN": { title: "\u901A\u77E5", close: "\u5173\u95ED", all: "\u5168\u90E8", unread: "\u672A\u8BFB", refresh: "\u5237\u65B0", markAll: "\u5168\u90E8\u5DF2\u8BFB", markOne: "\u6807\u4E3A\u5DF2\u8BFB", more: "\u52A0\u8F7D\u66F4\u591A", retry: "\u91CD\u65B0\u52A0\u8F7D", loading: "\u52A0\u8F7D\u4E2D", saving: "\u4FDD\u5B58\u4E2D", emptyAll: "\u6682\u65E0\u901A\u77E5\u3002", emptyUnread: "\u6CA1\u6709\u672A\u8BFB\u901A\u77E5\u3002", auth: "\u8BF7\u5148\u767B\u5F55\u3002", listError: "\u65E0\u6CD5\u52A0\u8F7D\u901A\u77E5\u3002", readError: "\u65E0\u6CD5\u4FDD\u5B58\u5DF2\u8BFB\u72B6\u6001\u3002", changed: "\u901A\u77E5\u5217\u8868\u5DF2\u66F4\u6539\u3002", count: "{n} \u6761\u672A\u8BFB" },
    "zh-TW": { title: "\u901A\u77E5", close: "\u95DC\u9589", all: "\u5168\u90E8", unread: "\u672A\u8B80", refresh: "\u91CD\u65B0\u6574\u7406", markAll: "\u5168\u90E8\u5DF2\u8B80", markOne: "\u6A19\u70BA\u5DF2\u8B80", more: "\u8F09\u5165\u66F4\u591A", retry: "\u91CD\u65B0\u8F09\u5165", loading: "\u8F09\u5165\u4E2D", saving: "\u5132\u5B58\u4E2D", emptyAll: "\u76EE\u524D\u6C92\u6709\u901A\u77E5\u3002", emptyUnread: "\u6C92\u6709\u672A\u8B80\u901A\u77E5\u3002", auth: "\u8ACB\u5148\u767B\u5165\u3002", listError: "\u7121\u6CD5\u8F09\u5165\u901A\u77E5\u3002", readError: "\u7121\u6CD5\u5132\u5B58\u5DF2\u8B80\u72C0\u614B\u3002", changed: "\u901A\u77E5\u6E05\u55AE\u5DF2\u8B8A\u66F4\u3002", count: "{n} \u5247\u672A\u8B80" }
  };
  const REGIONS = { ko: "ko-KR", en: "en-US", ja: "ja-JP", "zh-CN": "zh-CN", "zh-TW": "zh-TW" };
  function locale() {
    const value = window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko";
    if (/^(zh-Hant|zh-TW|zh-HK)$/i.test(value)) return "zh-TW";
    if (/^(zh-Hans|zh-CN|zh)$/i.test(value)) return "zh-CN";
    const short = String(value).split("-")[0];
    return WORDS[short] ? short : "ko";
  }
  const words = () => WORDS[locale()];
  const dateValid = value => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  function notification(value) {
    if (!value || typeof value.id !== "string" || !UUID.test(value.id) || typeof value.title !== "string" ||
        !(value.body === null || typeof value.body === "string") || !dateValid(value.createdAt) ||
        !(value.readAt === null || dateValid(value.readAt))) throw new Error("INVALID_NOTIFICATION_RECEIPT");
    return { id: value.id, title: value.title.slice(0, 300), body: value.body?.slice(0, 4000) || "",
      createdAt: value.createdAt, read: value.readAt !== null };
  }
  function owner() {
    const auth = getAuth();
    const id = auth?.user?.id || auth?.user?.userId || auth?.userId;
    if (typeof id !== "string" || !UUID.test(id) || typeof auth?.accessToken !== "string" || !auth.accessToken) return null;
    const refresh = auth.refreshToken || auth.refresh_token || auth.tokens?.refreshToken || auth.tokens?.refresh_token;
    return { key: JSON.stringify([id, auth.accessToken, typeof refresh === "string" ? refresh : ""]) };
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function icon(name) {
    const node = element("img", "feed-notifications-icon");
    node.src = "/assets/icons/lucide/" + name + ".svg";
    node.alt = "";
    node.width = node.height = 20;
    node.setAttribute("aria-hidden", "true");
    return node;
  }
  function mount() {
    const root = document.querySelector("[data-feed-notifications-root]");
    const opener = root?.querySelector("#feedNotificationsOpen");
    if (!root || !opener || root.dataset.feedNotificationsBound ||
        typeof apiFetch !== "function" || typeof getAuth !== "function") return;
    root.dataset.feedNotificationsBound = "1";
    let account = owner(), epoch = 0, sequence = 0, opened = false, filter = "all";
    let rows = [], unreadCount = null, cursor = null, ready = false, loadPending = null, message = "";
    const writes = new Map();
    const captions = [];
    const openLabel = element("span");
    const badge = element("span", "feed-notifications-badge");
    badge.hidden = true;
    opener.replaceChildren(icon("bell"), openLabel, badge);
    opener.type = "button";
    opener.setAttribute("aria-controls", "feedNotificationsPanel");
    const panel = element("dialog", "feed-notifications-panel");
    panel.id = "feedNotificationsPanel";
    panel.hidden = true;
    panel.setAttribute("aria-labelledby", "feedNotificationsHeading");
    const header = element("div", "feed-notifications-header");
    const heading = element("h2");
    heading.id = "feedNotificationsHeading";
    const count = element("p", "feed-notifications-count");
    count.id = "feedNotificationsCount";
    function button(id, key, symbol, parent) {
      const node = element("button", "feed-notifications-command");
      node.id = id; node.type = "button";
      if (symbol) node.append(icon(symbol));
      const label = element("span");
      node.append(label); captions.push({ node, label, key }); parent.append(node);
      return node;
    }
    header.append(heading);
    const closeButton = button("feedNotificationsClose", "close", "x", header);
    const filters = element("div", "feed-notifications-filters");
    filters.setAttribute("role", "group");
    const allButton = button("feedNotificationsAll", "all", null, filters);
    const unreadButton = button("feedNotificationsUnread", "unread", null, filters);
    const tools = element("div", "feed-notifications-tools");
    const refreshButton = button("feedNotificationsRefresh", "refresh", "refresh-cw", tools);
    const allReadButton = button("feedNotificationsReadAll", "markAll", "check-check", tools);
    const status = element("p", "feed-notifications-status");
    status.id = "feedNotificationsStatus";
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); status.tabIndex = -1;
    const list = element("ul", "feed-notifications-list");
    list.id = "feedNotificationsList";
    const footer = element("div", "feed-notifications-footer");
    const retryButton = button("feedNotificationsRetry", "retry", "refresh-cw", footer);
    const moreButton = button("feedNotificationsMore", "more", "chevron-down", footer);
    panel.append(header, count, filters, tools, status, list, footer);
    root.append(panel);
    function identityCurrent() {
      const next = owner();
      if (next?.key !== account?.key) { resetAccount(next); return false; }
      return !!next;
    }
    function current(ticket) {
      return identityCurrent() && root.isConnected && opened && ticket.epoch === epoch &&
        ticket.sequence === sequence && ticket.key === account?.key;
    }
    function ticket() { return { epoch, sequence: ++sequence, key: account.key }; }
    function clearView() {
      rows = []; unreadCount = null; cursor = null; ready = false; loadPending = null; message = "";
      list.replaceChildren();
      badge.textContent = ""; badge.hidden = true; count.textContent = "";
    }
    function close(restore = true) {
      sequence++; opened = false;
      if (panel.open && typeof panel.close === "function") panel.close();
      panel.removeAttribute("open"); panel.hidden = true;
      clearView(); render();
      if (restore && opener.isConnected) opener.focus({ preventScroll: true });
    }
    function resetAccount(next = owner()) {
      epoch++; account = next; writes.clear(); filter = "all"; close(false);
    }
    function render() {
      const w = words();
      const writing = !!account && writes.has(account.key);
      openLabel.textContent = w.title; opener.title = w.title;
      opener.setAttribute("aria-expanded", String(opened));
      opener.setAttribute("aria-label", unreadCount === null ? w.title : w.title + ", " + w.count.replace("{n}", unreadCount));
      heading.textContent = w.title; filters.setAttribute("aria-label", w.title);
      for (const caption of captions) {
        caption.label.textContent = w[caption.key];
        caption.node.title = w[caption.key]; caption.node.setAttribute("aria-label", w[caption.key]);
      }
      count.textContent = unreadCount === null ? "" : w.count.replace("{n}", unreadCount);
      badge.textContent = unreadCount === null ? "" : String(unreadCount);
      badge.hidden = !opened || !unreadCount;
      allButton.setAttribute("aria-pressed", String(filter === "all"));
      unreadButton.setAttribute("aria-pressed", String(filter === "unread"));
      allButton.disabled = unreadButton.disabled = !account || writing;
      refreshButton.disabled = !account || writing || !!loadPending;
      allReadButton.disabled = !account || !ready || writing || !!loadPending || !unreadCount;
      moreButton.hidden = !cursor; moreButton.disabled = !ready || writing || !!loadPending;
      retryButton.hidden = !opened || !account || !["listError", "readError", "changed"].includes(message);
      retryButton.disabled = writing || !!loadPending;
      panel.setAttribute("aria-busy", String(!!loadPending || writing));
      const statusKey = loadPending ? "loading" : writing ? "saving" : message ||
        (!account && opened ? "auth" : ready && !rows.length ? (filter === "all" ? "emptyAll" : "emptyUnread") : "");
      status.textContent = statusKey ? w[statusKey] : ""; status.hidden = !statusKey;
      list.replaceChildren();
      for (const row of rows) {
        const item = element("li", "feed-notifications-item");
        item.classList.toggle("is-unread", !row.read);
        const content = element("div", "feed-notifications-content");
        content.append(element("h3", "", row.title));
        if (row.body) content.append(element("p", "", row.body));
        const time = element("time");
        time.dateTime = row.createdAt;
        time.textContent = new Intl.DateTimeFormat(REGIONS[locale()],
          { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(row.createdAt));
        content.append(time); item.append(content);
        if (!row.read) {
          const readButton = element("button", "feed-notifications-command feed-notifications-read");
          readButton.type = "button"; readButton.dataset.notificationId = row.id;
          readButton.append(icon("check"), element("span", "", w.markOne));
          readButton.title = w.markOne; readButton.setAttribute("aria-label", w.markOne);
          readButton.disabled = !ready || writing || !!loadPending;
          const renderedEpoch = epoch;
          readButton.addEventListener("click", () => {
            if (renderedEpoch === epoch && readButton.isConnected && rows.includes(row)) mutate(row);
          });
          item.append(readButton);
        }
        list.append(item);
      }
    }
    async function load(append = false) {
      if (!identityCurrent() || !opened || !root.isConnected || writes.has(account.key)) return;
      if (append && (!ready || !cursor || loadPending)) return;
      const requestCursor = append ? cursor : null;
      const operation = ticket();
      loadPending = operation; ready = false; message = "";
      if (!append) { rows = []; cursor = null; unreadCount = null; }
      render();
      const query = new URLSearchParams({ take: "20" });
      if (filter === "unread") query.set("status", "unread");
      if (requestCursor) query.set("cursor", requestCursor);
      try {
        const result = await apiFetch(BASE + "?" + query, { auth: true, throwOnError: true });
        if (!current(operation)) return;
        if (!Array.isArray(result?.notifications) || result.notifications.length > 20 || !integer(result.unreadCount) ||
            !(result.nextCursor === null || (typeof result.nextCursor === "string" && UUID.test(result.nextCursor)))) {
          throw new Error("INVALID_NOTIFICATION_LIST");
        }
        const incoming = result.notifications.map(notification), ids = incoming.map(row => row.id);
        if (new Set(ids).size !== ids.length || (filter === "unread" && incoming.some(row => row.read)) ||
            incoming.filter(row => !row.read).length > result.unreadCount ||
            (result.nextCursor && result.nextCursor !== incoming.at(-1)?.id) ||
            (append && (result.nextCursor === requestCursor || incoming.some(row => rows.some(old => old.id === row.id))))) {
          throw new Error("INVALID_NOTIFICATION_PAGE");
        }
        rows = append ? rows.concat(incoming) : incoming;
        cursor = result.nextCursor; unreadCount = result.unreadCount; ready = true;
      } catch (error) {
        if (!current(operation)) return;
        cursor = null;
        message = error?.status === 401 ? "auth" : error?.status === 400 ? "changed" : "listError";
      } finally {
        if (current(operation)) { loadPending = null; render(); }
      }
    }
    async function mutate(row) {
      if (!identityCurrent() || !opened || !root.isConnected || !ready || loadPending || writes.has(account.key) ||
          (row && (!rows.includes(row) || row.read)) || (!row && !unreadCount)) return;
      const operation = ticket();
      writes.set(account.key, operation); message = ""; render(); status.focus({ preventScroll: true });
      try {
        // The shared API helper retries 401 by default; mutations must not auto-replay.
        const result = await apiFetch(row ? BASE + "/" + row.id + "/read" : BASE + "/read-all",
          { auth: true, throwOnError: true, method: "PATCH", body: {} }, 1);
        if (!current(operation)) return;
        if (row) {
          const saved = notification(result?.notification);
          if (saved.id !== row.id || !saved.read) throw new Error("INVALID_READ_RECEIPT");
          rows = rows.map(old => old === row ? saved : old);
          unreadCount = Math.max(0, unreadCount - 1);
        } else {
          if (result?.ok !== true || !integer(result.updatedCount)) throw new Error("INVALID_READ_ALL_RECEIPT");
          rows = rows.map(old => ({ ...old, read: true })); unreadCount = 0;
        }
        if (filter === "unread") rows = rows.filter(item => !item.read);
        cursor = null;
      } catch (error) {
        if (!current(operation)) return;
        ready = false; cursor = null; message = error?.status === 401 ? "auth" : "readError";
      } finally {
        if (writes.get(operation.key) === operation) writes.delete(operation.key);
        if (current(operation)) {
          render();
          if (document.activeElement === status) refreshButton.focus({ preventScroll: true });
        } else if (opened && identityCurrent() && operation.key === account?.key && operation.epoch === epoch) render();
      }
    }
    opener.addEventListener("click", () => {
      if (opened) { close(); return; }
      identityCurrent(); opened = true; sequence++; clearView(); panel.hidden = false;
      try {
        if (typeof panel.showModal === "function") panel.showModal();
        else { panel.setAttribute("open", ""); panel.setAttribute("aria-modal", "false"); }
      } catch (_) { close(); return; }
      render(); closeButton.focus({ preventScroll: true });
      if (account) load();
    });
    closeButton.addEventListener("click", () => close());
    panel.addEventListener("cancel", event => { event.preventDefault(); close(); });
    panel.addEventListener("keydown", event => {
      if (!opened) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const controls = [...panel.querySelectorAll("button")].filter(node => !node.disabled && !node.hidden);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    for (const [node, value] of [[allButton, "all"], [unreadButton, "unread"]]) {
      node.addEventListener("click", () => {
        if (!identityCurrent() || !opened || writes.has(account.key) || filter === value) return;
        filter = value; load();
      });
    }
    refreshButton.addEventListener("click", () => load());
    retryButton.addEventListener("click", () => load());
    moreButton.addEventListener("click", () => load(true));
    allReadButton.addEventListener("click", () => mutate(null));
    window.addEventListener("lumina:authchange", () => resetAccount());
    window.addEventListener("lumina:auth-expired", () => resetAccount());
    window.addEventListener("storage", event => { if (event.key === "lumina_auth" || event.key === null) resetAccount(); });
    window.addEventListener("lumina:localechange", () => render());
    render(); opener.hidden = false;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
