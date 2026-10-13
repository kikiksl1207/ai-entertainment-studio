(function () {
  "use strict";

  const authKey = "lumina_auth";
  const apiOrigin = "https://api.lumina-stage.com";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const route = /^\/api\/v1\/me\/creator-studio\/stories\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/generation-profile\/approved-section-bytes\?measurement=json-utf8-v1$/;
  const catalogRoute = /^\/api\/v1\/me\/creator-studio\/approved-reading-catalog\?locale=(?:ko|en|ja|zh-Hans|zh-Hant)&limit=12(?:&cursor=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/;
  const bodyRoute = /^\/api\/v1\/me\/creator-studio\/stories\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/body-preview\?locale=(?:ko|en|ja|zh-Hans|zh-Hant)$/;
  const optionKeys = new Set(["method", "identity", "token", "_retried", "cache", "headers", "signal", "auth"]);

  function failure(code) {
    const error = new Error("Readonly transport unavailable");
    error.code = code;
    return error;
  }

  function cancel(response) {
    try { Promise.resolve(response?.body?.cancel?.()).catch(() => {}); } catch (_) {}
  }

  function createForRoute(acceptedRoute, { storage, fetch: nativeFetch, eventTarget = window } = {}) {
    let epoch = 0, initialized = false, marker = null, disposed = false;
    const pending = new Set();
    const listeners = [];

    function read() {
      try {
        const raw = (storage === undefined ? window.localStorage : storage).getItem(authKey);
        if (typeof raw !== "string" || !raw || raw.length > 65536) return null;
        const auth = JSON.parse(raw);
        if (!auth || typeof auth !== "object" || Array.isArray(auth)) return null;
        const user = auth.user || auth.viewer;
        const ownerId = user?.id || user?.userId;
        const token = auth.accessToken || auth.access_token || auth.token || auth.tokens?.accessToken || auth.tokens?.access_token;
        if (typeof ownerId !== "string" || ownerId.length !== 36 || !uuid.test(ownerId) || typeof token !== "string" ||
            !token || token !== token.trim() || token.length > 8192 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) return null;
        return { ownerId, token };
      } catch (_) { return null; }
    }

    function advance() {
      ++epoch;
      if (!Number.isSafeInteger(epoch)) disposed = true;
      for (const gate of Array.from(pending)) gate.stop(disposed ? "disposed" : "stale");
    }

    function sample() {
      if (disposed) return null;
      const next = read();
      if (initialized && (marker?.ownerId !== next?.ownerId || marker?.token !== next?.token)) advance();
      marker = next; initialized = true;
      return disposed ? null : marker;
    }

    function getAuth() {
      const current = sample();
      return current ? Object.freeze({ accessToken: current.token, user: Object.freeze({ id: current.ownerId }) }) : null;
    }

    function identity() {
      const current = sample();
      return current ? Object.freeze({ ownerId: current.ownerId, epoch }) : null;
    }

    function isCurrent(owner) {
      const current = sample();
      try {
        return !!current && !!owner && typeof owner.ownerId === "string" && owner.ownerId === current.ownerId &&
          Number.isSafeInteger(owner.epoch) && owner.epoch >= 0 && owner.epoch === epoch &&
          (owner.token === undefined || owner.token === current.token);
      } catch (_) { return false; }
    }

    function invalidate() {
      if (disposed) return;
      initialized = false; marker = null; advance();
    }

    function dispose() {
      if (disposed) return;
      disposed = true; marker = null; initialized = false; advance();
      for (const [type, listener] of listeners) {
        try { eventTarget.removeEventListener(type, listener); } catch (_) {}
      }
      listeners.length = 0;
    }

    function validOptions(options) {
      if (!options || typeof options !== "object" || Array.isArray(options) ||
          Reflect.ownKeys(options).some(key => typeof key !== "string" || !optionKeys.has(key)) ||
          options.method !== "GET" || options._retried !== true || options.cache !== "no-store" ||
          (options.auth !== undefined && options.auth !== true)) return false;
      const headers = options.headers;
      if (!headers || typeof headers !== "object" || Array.isArray(headers) ||
          Reflect.ownKeys(headers).length !== 2 ||
          headers.Accept !== "application/json" || headers["Cache-Control"] !== "no-store") return false;
      const signal = options.signal;
      return !!signal && typeof signal.aborted === "boolean" &&
        typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function";
    }

    async function fetchReadonly(path, options) {
      if (disposed) throw failure("disposed");
      try {
        if (typeof path !== "string" || path !== path.trim() || !acceptedRoute.test(path) || !validOptions(options)) {
          throw failure("invalid_request");
        }
      } catch (_) { throw failure("invalid_request"); }
      const current = sample();
      if (!current) throw failure("unauthenticated");
      let owner, token, signal, send;
      try {
        owner = { ownerId: options.identity?.ownerId, epoch: options.identity?.epoch };
        token = options.token; signal = options.signal;
        send = nativeFetch === undefined && typeof window.fetch === "function" ? window.fetch.bind(window) : nativeFetch;
      } catch (_) { throw failure("invalid_request"); }
      if (!isCurrent(owner) || token !== current.token || signal.aborted) throw failure("stale");
      if (typeof send !== "function") throw failure("transport");

      // Invalidation settles callers even if native fetch ignores abort.
      return new Promise((resolve, reject) => {
        const abort = new AbortController();
        let settled = false;
        function requestCurrent() {
          try { return !signal.aborted && isCurrent(owner) && marker?.token === token; }
          catch (_) { return false; }
        }
        function finish(code, response) {
          if (settled) { if (response) cancel(response); return; }
          settled = true; pending.delete(gate);
          try { signal.removeEventListener("abort", onAbort); } catch (_) {}
          if (code) {
            try { abort.abort(); } catch (_) {}
            reject(failure(code));
          } else resolve(response);
        }
        function onAbort() { finish("stale"); }
        const gate = { stop: code => finish(code) };
        pending.add(gate);
        try {
          signal.addEventListener("abort", onAbort, { once: true });
          if (!requestCurrent()) { finish("stale"); return; }
          const result = send(apiOrigin + path, {
            method: "GET", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
            headers: { Authorization: "Bearer " + token, Accept: "application/json", "Cache-Control": "no-store" },
            signal: abort.signal
          });
          Promise.resolve(result).then(response => {
            if (settled) { cancel(response); return; }
            if (!requestCurrent()) { finish("stale"); cancel(response); return; }
            finish(null, response);
          }, () => {
            if (!settled) finish(requestCurrent() ? "transport" : "stale");
          });
        } catch (_) { finish("transport"); }
      });
    }

    try {
      const storageChanged = event => { if (event.key === authKey || event.key === null) invalidate(); };
      for (const [type, listener] of [["storage", storageChanged], ["lumina:authchange", invalidate],
        ["lumina:auth-expired", invalidate], ["pagehide", dispose]]) {
        listeners.push([type, listener]); eventTarget.addEventListener(type, listener);
      }
    } catch (_) { dispose(); }

    return Object.freeze({ getAuth, identity, isCurrent, fetch: fetchReadonly, dispose });
  }

  window.LuminaCreatorApprovedReadonlyTransport = Object.freeze({
    create: options => createForRoute(route, options),
    createCatalog: options => createForRoute(catalogRoute, options),
    createBody: options => createForRoute(bodyRoute, options)
  });
})();
