(function () {
  "use strict";
  const authKey = "lumina_auth";
  const endpoint = "https://api.lumina-stage.com/api/v1/auth/refresh";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const tokenPattern = /^[A-Za-z0-9._~+/-]+=*$/;

  function plain(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function token(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 8192 && tokenPattern.test(value);
  }
  function owner(user) {
    if (!plain(user)) return null;
    const value = user.id || user.userId;
    return typeof value === "string" && uuid.test(value) &&
      (user.id === undefined || user.userId === undefined || user.id.toLowerCase() === user.userId.toLowerCase())
      ? value.toLowerCase() : null;
  }
  function aliases(values) {
    const present = values.filter(value => value !== undefined && value !== null);
    return present.length && token(present[0]) && present.every(value => value === present[0]) ? present[0] : null;
  }
  function parseAuth(raw) {
    try {
      if (typeof raw !== "string" || !raw || raw.length > 65536) return null;
      const value = JSON.parse(raw);
      if (!plain(value)) return null;
      const id = owner(value.user || value.viewer);
      const access = aliases([value.accessToken, value.access_token, value.token, value.tokens?.accessToken, value.tokens?.access_token]);
      const refresh = aliases([value.refreshToken, value.refresh_token, value.tokens?.refreshToken, value.tokens?.refresh_token]);
      return id && access && refresh ? { raw, owner: id, access, refresh } : null;
    } catch (_) { return null; }
  }
  function cancel(response) { try { Promise.resolve(response?.body?.cancel?.()).catch(() => {}); } catch (_) {} }
  const failure = phase => Object.assign(new Error("Authentication connection unavailable"), { phase });

  function create({ storage, fetch: suppliedFetch, eventTarget = window, onChange = () => {}, deadlineMs = 8000 } = {}) {
    if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 8000) throw failure("unavailable");
    const store = storage === undefined ? window.localStorage : storage;
    const getStored = store.getItem.bind(store), setStored = store.setItem.bind(store);
    let disposed = false, epoch = 0, initialized = false, marker = null, active = null, usedRaw = null, uncertain = false;
    let phase = "idle";
    const listeners = [];
    function read() { try { return parseAuth(getStored(authKey)); } catch (_) { return null; } }
    function advance() {
      ++epoch;
      if (!Number.isSafeInteger(epoch)) disposed = true;
      active?.stop("changed");
    }
    function sample() {
      if (disposed) return null;
      const next = read();
      if (initialized && marker !== (next?.raw || null)) advance();
      initialized = true; marker = next?.raw || null;
      return disposed ? null : next;
    }
    function state() {
      const current = sample();
      return Object.freeze({ phase: disposed ? "disposed" : uncertain ? "uncertain" : phase,
        canConnect: !disposed && !uncertain && !active && !!current && current.raw !== usedRaw });
    }
    function notify() { try { onChange(state()); } catch (_) {} }
    function sync() {
      const before = epoch;
      sample();
      if (before !== epoch && !active) { phase = "idle"; notify(); }
    }
    function changed() {
      if (disposed) return;
      advance(); initialized = false; marker = null;
      if (!active) { phase = "idle"; notify(); }
    }
    function dispose() {
      if (disposed) return;
      disposed = true; active?.stop("changed");
      for (const [name, listener] of listeners) {
        try { eventTarget.removeEventListener(name, listener); } catch (_) {}
      }
      listeners.length = 0; marker = null; phase = "disposed";
      notify();
    }
    async function connect(confirmed) {
      if (confirmed !== true || disposed || uncertain || active) return false;
      const before = sample(), startedEpoch = epoch;
      if (!before || before.raw === usedRaw) return false;
      const send = suppliedFetch === undefined && typeof window.fetch === "function" ? window.fetch.bind(window) : suppliedFetch;
      if (typeof send !== "function") { phase = "unavailable"; notify(); return false; }
      const abort = new AbortController();
      let stop, reader, timer, invoked = false, settled = false, retired = false;
      const stopped = new Promise((_, reject) => { stop = value => {
        if (settled || retired) return;
        retired = true;
        reject(failure(value));
        try { abort.abort(); } catch (_) {}
        try { Promise.resolve(reader?.cancel?.()).catch(() => {}); } catch (_) {}
      }; });
      stopped.catch(() => {});
      const flight = { stop }; active = flight; phase = "connecting";
      function rawCurrent(expectedRaw, expectedEpoch, requireFlight) {
        const live = () => !retired && !abort.signal.aborted && !disposed && epoch === expectedEpoch && (!requireFlight || active === flight);
        if (!live()) return false;
        const observed = getStored(authKey);
        return live() && observed === expectedRaw;
      }
      const current = () => rawCurrent(before.raw, startedEpoch, true);
      notify();
      try {
        if (!current()) throw failure("changed");
        eventTarget.dispatchEvent(new Event("creator:approved-auth-connection-start"));
        if (!current()) throw failure("changed");
        timer = setTimeout(() => stop("timeout"), deadlineMs);
        const exchange = (async () => {
          if (!current()) throw failure("changed");
          usedRaw = before.raw; invoked = true;
          const response = await send(endpoint, { method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
            referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ refreshToken: before.refresh }), signal: abort.signal });
          if (!current()) { cancel(response); throw failure("changed"); }
          if (response?.status === 401 || response?.status === 403) { cancel(response); throw failure("rejected"); }
          if (![200, 201].includes(response?.status) || response.redirected === true ||
              !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(response.headers?.get?.("content-type") || "") ||
              typeof response.body?.getReader !== "function") { cancel(response); throw failure("uncertain"); }
          const length = response.headers.get("content-length");
          if (length !== null && (!/^\d+$/.test(length) || Number(length) > 65536)) { cancel(response); throw failure("uncertain"); }
          reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
          let bytes = 0, chunks = 0, text = "";
          for (;;) {
            if (!current()) throw failure("changed");
            const chunk = await reader.read();
            if (!current()) throw failure("changed");
            if (!chunk || typeof chunk.done !== "boolean") throw failure("uncertain");
            if (chunk.done) break;
            if (!(chunk.value instanceof Uint8Array) || ++chunks > 64) throw failure("uncertain");
            bytes += chunk.value.byteLength;
            if (bytes > 65536) throw failure("uncertain");
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
          const data = JSON.parse(text);
          if (!bytes || text.charCodeAt(0) === 0xfeff || JSON.stringify(data) !== text || !plain(data) || owner(data.user) !== before.owner ||
              !plain(data.tokens) || data.tokenType !== "Bearer" || data.tokens.tokenType !== "Bearer") throw failure("uncertain");
          const access = aliases([data.accessToken, data.tokens.accessToken, data.access_token]);
          const refresh = aliases([data.refreshToken, data.tokens.refreshToken, data.refresh_token]);
          if (!access || !refresh || refresh === before.refresh || !current()) throw failure("uncertain");
          const nextRaw = JSON.stringify({ accessToken: access, refreshToken: refresh, user: data.user });
          if (nextRaw.length > 65536 || !parseAuth(nextRaw) || !current()) throw failure("uncertain");
          // The server may already have rotated credentials; never restore an old value after a lost local commit.
          setStored(authKey, nextRaw);
          if (!rawCurrent(nextRaw, startedEpoch, true)) throw failure("uncertain");
          active = null; marker = nextRaw; initialized = true; usedRaw = nextRaw;
          const committedEpoch = epoch;
          eventTarget.dispatchEvent(new Event("lumina:authchange"));
          if (!rawCurrent(nextRaw, committedEpoch + 1, false)) throw failure("uncertain");
          const publishedEpoch = epoch;
          phase = "connected"; notify();
          if (!rawCurrent(nextRaw, publishedEpoch, false)) throw failure("uncertain");
          return true;
        })();
        const result = await Promise.race([exchange, stopped]);
        return result === true;
      } catch (error) {
        if (!disposed) {
          phase = error?.phase === "changed" ? "changed" : error?.phase === "rejected" ? "rejected" : invoked ? "uncertain" : "unavailable";
          if (invoked && phase !== "rejected") uncertain = true;
          notify();
        }
        return false;
      } finally {
        settled = true; clearTimeout(timer);
        try { abort.abort(); } catch (_) {}
        try { Promise.resolve(reader?.cancel?.()).catch(() => {}); reader?.releaseLock?.(); } catch (_) {}
        if (active === flight) active = null;
        if (!disposed) notify();
      }
    }
    try {
      const storageChanged = event => {
        if (event.key !== authKey && event.key !== null) return;
        try {
          const local = window.localStorage, session = window.sessionStorage, area = event.storageArea;
          // Only a positively identified other native store is irrelevant.
          if (local && session && typeof local === "object" && typeof session === "object" && local !== session &&
              (store === local && area === session || store === session && area === local)) return;
        } catch (_) {}
        changed();
      };
      for (const [name, listener] of [["storage", storageChanged], ["lumina:authchange", changed],
        ["lumina:auth-expired", changed], ["pagehide", dispose]]) {
        listeners.push([name, listener]); eventTarget.addEventListener(name, listener);
      }
    } catch (_) { dispose(); }
    return Object.freeze({ connect, state, sync, dispose });
  }
  window.LuminaCreatorApprovedAuthConnection = Object.freeze({ create });
})();
