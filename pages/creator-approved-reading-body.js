(function () {
  "use strict";
  if (window.LuminaCreatorApprovedReadingBody) return;
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const maxBytes = 256 * 1024, mounts = new WeakMap();
  const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  const failure = kind => Object.assign(new Error("Readonly body unavailable"), { kind });
  const cancel = value => { try { Promise.resolve(value?.cancel?.()).catch(() => {}); } catch (_) {} };
  function fields(value, names) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Reflect.ownKeys(value).length !== names.length) return false;
    return names.every(name => {
      const d = Object.getOwnPropertyDescriptor(value, name);
      return d?.enumerable && Object.prototype.hasOwnProperty.call(d, "value");
    });
  }
  function create({ transport, scope = window.LuminaCreatorApprovedReadingScope,
    locale = () => document.documentElement.lang, visible = () => document.visibilityState !== "hidden",
    onChange = () => {}, deadlineMs = 30000, eventTarget = window,
    documentTarget = typeof document === "undefined" ? null : document } = {}) {
    const core = window.LuminaCreatorBodyPreview;
    if (!core || typeof core.createController !== "function" || typeof core.parsePreview !== "function" || !core.copy ||
        !scope || !Object.isFrozen(scope) || !fields(scope, ["snapshot", "isCurrent", "validate"]) ||
        ["snapshot", "isCurrent", "validate"].some(key => typeof scope[key] !== "function") ||
        !transport || ["fetch", "getAuth", "identity", "isCurrent"].some(key => typeof transport[key] !== "function") ||
        !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30000) throw failure("invalid");
    let disposed = false, loading = false, pin = null, controller = null, active = null;
    const listeners = [];
    function sample() {
      let selection = null, owner = null, token = null, language = "", shown = false;
      try {
        language = locale(); shown = visible() === true;
        const candidate = scope.snapshot(), identity = transport.identity(), auth = transport.getAuth();
        if (fields(candidate, ["ownerId", "workId", "workLabel", "sourceLocale"]) && Object.isFrozen(candidate) &&
            uuid(candidate.ownerId) && uuid(candidate.workId) && locales.includes(candidate.sourceLocale) &&
            typeof candidate.workLabel === "string" && candidate.workLabel.length <= 1000 &&
            !/[\u0000-\u001f\u007f]/.test(candidate.workLabel) && scope.isCurrent(candidate) === true) selection = candidate;
        if (uuid(identity?.ownerId) && Number.isSafeInteger(identity.epoch) && identity.epoch >= 0 &&
            transport.isCurrent(identity) === true && auth?.user?.id === identity.ownerId &&
            typeof auth.accessToken === "string" && auth.accessToken.length > 0 && auth.accessToken.length <= 8192 &&
            /^[A-Za-z0-9._~+/-]+=*$/.test(auth.accessToken)) {
          owner = Object.freeze({ ownerId: identity.ownerId, epoch: identity.epoch }); token = auth.accessToken;
        }
        if (selection && selection.ownerId !== owner?.ownerId) selection = null;
      } catch (_) { selection = null; owner = null; token = null; }
      return { selection, owner, token, language, shown };
    }
    const same = (a, b) => !!a && !!b && a.selection === b.selection && a.owner?.ownerId === b.owner?.ownerId &&
      a.owner?.epoch === b.owner?.epoch && a.token === b.token && a.language === b.language && a.shown === b.shown;
    function sessionCurrent(value) {
      try {
        return !disposed && !!value?.owner && same(value, sample()) && transport.isCurrent(value.owner) === true;
      } catch (_) { return false; }
    }
    function current(value) {
      try {
        return sessionCurrent(value) && !!value.selection && value.shown && locales.includes(value.language) && scope.isCurrent(value.selection) === true;
      } catch (_) { return false; }
    }
    function syncContext() {
      if (disposed) return false;
      const next = sample();
      if (same(pin, next)) { controller?.syncContext(); return false; }
      pin = next; active?.stop("stale"); controller?.invalidate(); return true;
    }
    function invalidate() {
      if (disposed) return;
      active?.stop("stale"); pin = sample(); controller?.invalidate();
    }
    function gateFor(value, signal) {
      const abort = new AbortController(), expires = Date.now() + deadlineMs;
      let stopped = false, finished = false, reader = null, response = null, bytes = 0, reject;
      const rejected = new Promise((_, no) => { reject = no; });
      rejected.catch(() => {});
      const gate = {
        rejected, signal: abort.signal,
        stop(kind) {
          if (stopped || finished) return;
          stopped = true; reject(failure(kind)); abort.abort(); cancel(reader || response?.body);
        },
        ensure() {
          if (Date.now() >= expires) gate.stop("transport");
          if (!current(value)) gate.stop("stale");
          if (stopped || finished) throw failure("stale");
        },
        async validate() {
          gate.ensure();
          const valid = await gate.wait(Promise.resolve().then(() => scope.validate(value.selection, abort.signal)));
          gate.ensure(); if (valid !== true) { gate.stop("stale"); throw failure("stale"); }
        },
        wait(promise) { return Promise.race([promise, rejected]); },
        response(value) { response = value; if (stopped || finished) cancel(value?.body); },
        reader(value) { reader = value; if (stopped || finished) cancel(value); },
        count(value) { bytes += value; if (bytes > maxBytes) throw failure("invalid"); },
        finish() {
          if (finished) return;
          finished = true; clearTimeout(timeout); signal.removeEventListener("abort", stop);
          cancel(reader || response?.body); reader = null; response = null;
          if (active === gate) active = null;
        }
      };
      const stop = () => gate.stop("stale");
      const timeout = setTimeout(() => gate.stop("transport"), deadlineMs);
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      return gate;
    }
    async function fetchBody(path, options) {
      const before = pin;
      const expected = before?.selection ? "/api/v1/me/creator-studio/stories/" + before.selection.workId.toLowerCase() +
        "/body-preview?locale=" + before.selection.sourceLocale : null;
      if (!current(before) || path !== expected || options?.method !== "GET" || options._retried !== true ||
          options.cache !== "no-store" || options.identity?.ownerId !== before.owner.ownerId ||
          options.identity?.epoch !== before.owner.epoch || !fields(options.headers, ["Cache-Control"]) ||
          options.headers["Cache-Control"] !== "no-store" || !options.signal || options.signal.aborted ||
          typeof options.signal.addEventListener !== "function" || typeof options.signal.removeEventListener !== "function" ||
          Reflect.ownKeys(options).some(key => !["method", "identity", "_retried", "cache", "headers", "signal"].includes(key))) throw failure("invalid");
      const gate = gateFor(before, options.signal); active = gate;
      let response;
      try {
        await gate.validate(); gate.ensure();
        const sent = Promise.resolve().then(() => {
          gate.ensure();
          return transport.fetch(expected, { method: "GET", identity: before.owner, token: before.token,
            _retried: true, cache: "no-store", headers: { Accept: "application/json", "Cache-Control": "no-store" }, signal: gate.signal });
        });
        // Late headers are discarded even when the supplied transport ignores abort.
        const received = sent.then(value => { gate.response(value); return value; });
        response = await gate.wait(received);
        await gate.validate(); gate.ensure();
        if (!response || !Number.isInteger(response.status) || response.redirected === true) throw failure("invalid");
        if (response.status !== 200) {
          cancel(response.body);
          return { status: response.status, body: { cancel: () => Promise.resolve() } };
        }
        const header = key => response.headers?.get?.(key);
        const type = header("content-type"), cache = header("cache-control"), length = header("content-length");
        const directives = typeof cache === "string" ? cache.toLowerCase().split(",").map(x => x.trim()) : [];
        if (typeof type !== "string" || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(type) ||
            !directives.includes("private") || !directives.includes("no-store") || directives.some(x => /^public(?:\s*=|$)/.test(x)) ||
            (length !== null && length !== undefined && (typeof length !== "string" || !/^\d+$/.test(length) || Number(length) > maxBytes)) ||
            typeof response.body?.getReader !== "function") throw failure("invalid");
        await gate.validate(); gate.ensure();
        let obtained = false;
        return { status: 200, headers: { get: key => key.toLowerCase() === "content-length" ? length : null }, body: {
          cancel() { cancel(response.body); return Promise.resolve(); },
          getReader() {
            gate.ensure(); if (obtained) throw failure("invalid"); obtained = true;
            const reader = response.body.getReader(); gate.reader(reader);
            if (typeof reader?.read !== "function" || typeof reader.cancel !== "function" || typeof reader.releaseLock !== "function") throw failure("invalid");
            return {
              async read() {
                try {
                  await gate.validate(); gate.ensure();
                  const chunk = await gate.wait(Promise.resolve().then(() => { gate.ensure(); return reader.read(); }));
                  gate.ensure();
                  if (!chunk || typeof chunk.done !== "boolean" || (!chunk.done && !(chunk.value instanceof Uint8Array)) ||
                      (chunk.done && chunk.value !== undefined)) throw failure("invalid");
                  if (!chunk.done) gate.count(chunk.value.byteLength);
                  await gate.validate(); gate.ensure();
                  return chunk.done ? { done: true } : { done: false, value: chunk.value.slice() };
                } catch (error) { cancel(reader); throw error; }
              },
              cancel() { cancel(reader); return Promise.resolve(); },
              releaseLock() { try { reader.releaseLock(); } catch (_) {} }
            };
          }
        } };
      } catch (error) { cancel(response?.body); throw error; }
    }
    pin = sample();
    controller = core.createController({ fetch: fetchBody,
      identity: () => sessionCurrent(pin) ? pin.owner : null,
      isCurrent: owner => sessionCurrent(pin) && owner?.ownerId === pin.owner.ownerId && owner?.epoch === pin.owner.epoch,
      context: () => ({ workId: pin?.selection?.workId.toLowerCase() || "", locale: pin?.selection?.sourceLocale }),
      locale: () => pin?.language, visible: () => !disposed && pin?.shown === true,
      onChange(state) {
        if (state.data) {
          try { if (active) active.ensure(); else if (!current(pin)) throw failure("stale"); }
          catch (_) { controller?.invalidate(); return; }
        }
        onChange(state);
      }
    });
    async function load(expectedTicket = null) {
      if (disposed) return false;
      syncContext();
      if (loading || active || !current(pin)) return false;
      loading = true;
      try {
        const loaded = await controller.load(expectedTicket);
        if (loaded) {
          try { active?.ensure(); if (!current(pin)) throw failure("stale"); }
          catch (_) { controller.invalidate(); return false; }
        }
        return loaded;
      }
      finally { active?.finish(); loading = false; }
    }
    function listen(target, name, handler) {
      if (!target?.addEventListener) return;
      target.addEventListener(name, handler); listeners.push([target, name, handler]);
    }
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "lumina:localechange",
      "creator:generation-profile-changed", "creator:approved-reading-scope-changed"]) listen(eventTarget, name, invalidate);
    listen(documentTarget, "lumina:auth-expired", invalidate);
    listen(documentTarget, "visibilitychange", invalidate);
    listen(eventTarget, "focus", syncContext);
    listen(eventTarget, "pagehide", dispose);
    const watch = setInterval(syncContext, 250);
    function dispose() {
      if (disposed) return;
      disposed = true; active?.stop("stale"); active?.finish(); pin = null;
      clearInterval(watch);
      for (const [target, name, handler] of listeners) target.removeEventListener(name, handler);
      listeners.length = 0; controller.invalidate();
    }
    onChange(controller.snapshot());
    return Object.freeze({ load, snapshot: () => { syncContext(); return controller.snapshot(); }, syncContext, sync: syncContext, invalidate, dispose });
  }
  function mount(host = document.getElementById("readingSavedBody")) {
    if (!host || host.id !== "readingSavedBody") return null;
    if (mounts.has(host)) return mounts.get(host);
    if (host.dataset.approvedReadingBodyMounted || !window.LuminaCreatorBodyPreview ||
        !window.LuminaCreatorApprovedReadingScope || typeof window.LuminaCreatorApprovedReadonlyTransport?.createBody !== "function") return null;
    let transport;
    try { transport = window.LuminaCreatorApprovedReadonlyTransport.createBody(); } catch (_) { return null; }
    const observers = [], listeners = [];
    const element = (tag, className, text) => {
      const node = document.createElement(tag); if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text); return node;
    };
    const header = element("header", "body-preview-header"), heading = element("div"), title = element("h3"), privacy = element("p", "body-preview-private");
    title.id = "readingSavedBodyTitle"; host.setAttribute("aria-labelledby", title.id); heading.append(title, privacy);
    const button = element("button", "body-preview-refresh"); button.id = "readingSavedBodyLoad"; button.type = "button";
    let icon;
    try { if (window.lucide?.icons?.RefreshCw && typeof window.lucide.createElement === "function") icon = window.lucide.createElement(window.lucide.icons.RefreshCw); } catch (_) {}
    if (!icon) icon = element("span", "body-preview-icon", "\u21bb");
    icon.setAttribute("aria-hidden", "true"); button.append(icon); header.append(heading, button);
    const status = element("p", "body-preview-state"), content = element("div", "body-preview-content");
    status.id = "readingSavedBodyState"; content.id = "readingSavedBodyContent";
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); host.replaceChildren(header, status, content);
    const visible = () => {
      if (document.visibilityState === "hidden" || !host.isConnected) return false;
      for (let node = host; node; node = node.parentElement) {
        if (node.hidden || node.style?.display === "none" || node.style?.visibility === "hidden") return false;
        const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(node) : node.style;
        if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") return false;
      }
      return true;
    };
    const names = { ko: "\ud55c\uad6d\uc5b4", en: "English", ja: "\u65e5\u672c\u8a9e", "zh-Hans": "\u7b80\u4f53\u4e2d\u6587", "zh-Hant": "\u7e41\u9ad4\u4e2d\u6587" };
    function render(state) {
      const words = window.LuminaCreatorBodyPreview.copy[state.locale];
      title.textContent = words.title; privacy.textContent = words.privacy;
      button.title = words.refresh; button.setAttribute("aria-label", words.refresh); button.disabled = !state.canLoad;
      host.lang = state.locale; host.setAttribute("aria-busy", String(state.busy));
      status.textContent = words[state.messageKey]; status.className = "body-preview-state" + (state.phase === "error" ? " is-error" : "");
      content.replaceChildren();
      const progress = state.data?.progress; if (!progress) return;
      const metadata = element("dl", "body-preview-metadata"), pending = /^(pending|generating)/i.test(progress.status) || progress.status === "ai_pending";
      const statusKey = progress.status === "active" ? "statusActive" : pending ? "statusPending" : progress.status === "completed" ? "statusCompleted" : "statusOther";
      const pairs = [[words.status, words[statusKey]], [words.revision, progress.revision], [words.version, progress.storyVersion], [words.source, names[state.data.locale]]];
      if (progress.scene) pairs.push([words.origin, words[progress.scene.isGenerated ? "originGenerated" : "originOriginal"]]);
      for (const [label, value] of pairs) { const row = element("div"); row.append(element("dt", "", label), element("dd", "", value)); metadata.append(row); }
      content.append(metadata);
      const source = element("div", "body-preview-source"); source.lang = state.data.locale;
      if (progress.scene) {
        source.append(element("h4", "body-preview-scene-title", progress.scene.title));
        const prose = element("div", "body-preview-prose");
        for (const beat of progress.scene.beats) prose.append(element("p", "body-preview-beat", beat.content));
        source.append(prose);
        if (progress.scene.endingType !== null) {
          const endings = { original: "endingOriginal", author_main: "endingOriginal", author_sub: "endingAlternate", ai_generated: "endingGenerated" };
          source.append(element("p", "body-preview-ending", words[Object.hasOwn(endings, progress.scene.endingType) ? endings[progress.scene.endingType] : "endingOther"]));
        }
      }
      content.append(source);
      if (progress.choices.length) {
        const list = element("ol", "body-preview-choices"); list.lang = state.data.locale;
        for (const choice of progress.choices) {
          const routes = { writer_original: "routeOriginal", generation_required: "routeGeneration", branch: "routeBranch", rejoin: "routeRejoin", ending: "routeEnding" };
          const item = element("li"); item.append(element("span", "body-preview-choice-label", choice.label),
            element("small", "body-preview-route", words[Object.hasOwn(routes, choice.routeKind) ? routes[choice.routeKind] : "routeOther"])); list.append(item);
        }
        content.append(element("h4", "body-preview-choices-title", words.choices), list);
      }
    }
    let bridge;
    try { bridge = create({ transport, visible, onChange: render }); }
    catch (_) { try { transport.dispose?.(); } catch (_) {} host.replaceChildren(); return null; }
    const click = () => { if (!button.disabled) return bridge.load(bridge.snapshot().ticket); };
    button.addEventListener("click", click); listeners.push([button, "click", click]);
    const changed = event => {
      if (["readingLocale", "readingCatalogWork", "writerManuscriptWork", "writerManuscriptLocale"].includes(event.target?.id)) bridge.invalidate();
    };
    for (const name of ["input", "change"]) { document.addEventListener(name, changed); listeners.push([document, name, changed]); }
    if (typeof MutationObserver === "function") {
      for (let node = host; node; node = node.parentElement) {
        const observer = new MutationObserver(records => { if (records.length) bridge.invalidate(); });
        observer.observe(node, { attributes: true, attributeFilter: node === document.documentElement ? ["lang", "hidden", "style", "class"] : ["hidden", "style", "class"] });
        observers.push(observer);
      }
    }
    let closed = false;
    const mounted = Object.freeze({ ...bridge, dispose() {
      if (closed) return; closed = true;
      for (const observer of observers) observer.disconnect();
      for (const [target, name, handler] of listeners) target.removeEventListener(name, handler);
      window.removeEventListener("pagehide", mounted.dispose);
      bridge.dispose(); try { transport.dispose?.(); } catch (_) {} host.replaceChildren();
      delete host.dataset.approvedReadingBodyMounted; mounts.delete(host);
    } });
    host.dataset.approvedReadingBodyMounted = "true"; mounts.set(host, mounted);
    window.addEventListener("pagehide", mounted.dispose); return mounted;
  }
  window.LuminaCreatorApprovedReadingBody = Object.freeze({ create, mount, maxBytes });
  if (typeof document !== "undefined") {
    const start = () => mount(document.getElementById("readingSavedBody"));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})();
