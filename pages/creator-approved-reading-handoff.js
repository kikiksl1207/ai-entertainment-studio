(function () {
  "use strict";
  const ready = "lumina-approved-reading-ready-v1", handoff = "lumina-approved-reading-handoff-v1";
  const check = "lumina-approved-reading-check-v1", checked = "lumina-approved-reading-checked-v1";
  const revoked = "lumina-approved-reading-revoked-v1";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const locales = new Set(["ko", "en", "ja", "zh-Hans", "zh-Hant"]);
  const nonceValid = value => typeof value === "string" && value.length === 36 && uuid.test(value);
  function fields(value, keys) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      Reflect.ownKeys(value).length === keys.length && keys.every(key => {
        const d = Object.getOwnPropertyDescriptor(value, key);
        return d && d.enumerable && Object.prototype.hasOwnProperty.call(d, "value");
      });
  }
  function context(value) {
    if (!fields(value, ["workId", "sourceLocale", "workLabel", "ownerId"]) ||
      !nonceValid(value.workId) || !nonceValid(value.ownerId) || !locales.has(value.sourceLocale) ||
      typeof value.workLabel !== "string" || !value.workLabel.trim() || value.workLabel.length > 2000) return null;
    return Object.freeze({ workId: value.workId, sourceLocale: value.sourceLocale,
      workLabel: value.workLabel, ownerId: value.ownerId });
  }
  function equal(left, right) {
    return !!left && !!right && Object.keys(left).every(key => left[key] === right[key]);
  }
  function send(target, payload, origin) {
    try { target.postMessage(payload, origin); return true; } catch (_) { return false; }
  }
  function createSender({ target = window, origin = location.origin, readContext, isCurrent, open } = {}) {
    const windows = new Map();
    let disposed = false;
    function current(record) {
      try { return !disposed && isCurrent(record.identity) === true && equal(record.context, context(readContext()?.context)); }
      catch (_) { return false; }
    }
    function revoke(child, record) {
      send(child, { type: revoked, nonce: record.nonce || null }, origin); windows.delete(child);
    }
    function receive(event) {
      const record = windows.get(event.source);
      if (!record || event.origin !== origin || !nonceValid(event.data?.nonce)) return;
      const initial = fields(event.data, ["type", "nonce"]) && event.data.type === ready;
      const validation = fields(event.data, ["type", "nonce", "requestId"]) && event.data.type === check &&
        Number.isSafeInteger(event.data.requestId) && event.data.requestId > 0;
      if (!initial && !validation) return;
      if (!current(record)) { revoke(event.source, record); return; }
      if (initial && record.nonce === null) {
        record.nonce = event.data.nonce;
        if (!send(event.source, { type: handoff, nonce: record.nonce, context: record.context }, origin)) windows.delete(event.source);
      } else if (validation && record.nonce === event.data.nonce) {
        send(event.source, { type: checked, nonce: record.nonce, requestId: event.data.requestId, valid: true }, origin);
      }
    }
    function openCurrent() {
      if (disposed) return false;
      let snapshot;
      try { snapshot = readContext(); } catch (_) { return false; }
      const value = context(snapshot?.context);
      if (!value || isCurrent(snapshot.identity) !== true) return false;
      let child;
      try { child = open("/creator-studio/approved-reading/", "_blank"); } catch (_) { return false; }
      if (!child) return false;
      windows.set(child, { context: value, identity: Object.freeze({ ...snapshot.identity }), nonce: null });
      return true;
    }
    function invalidate() { for (const [child, record] of Array.from(windows)) revoke(child, record); }
    function dispose() { if (disposed) return; disposed = true; invalidate(); target.removeEventListener("message", receive); }
    target.addEventListener("message", receive);
    return Object.freeze({ openCurrent, invalidate, dispose });
  }
  function createReceiver({ target = window, origin = location.origin, opener, nonce, identity, isCurrent,
    onChange = () => {}, timers = window } = {}) {
    let scope = null, owner = null, disposed = false, pending = null, accepted = false, sequence = 0;
    const initialOwner = identity();
    const validNonce = nonceValid(nonce);
    function invalidate() {
      scope = null; owner = null;
      if (pending) pending.finish(false);
      onChange(null);
    }
    function current() {
      try { return !disposed && scope && opener && !opener.closed && isCurrent(owner) === true && identity()?.ownerId === scope.ownerId; }
      catch (_) { return false; }
    }
    function receive(event) {
      if (disposed || !validNonce || !opener || event.origin !== origin || event.source !== opener || event.data?.nonce !== nonce) return;
      const data = event.data;
      if (fields(data, ["type", "nonce", "context"]) && data.type === handoff && !accepted) {
        accepted = true;
        const value = context(data.context), active = initialOwner;
        if (!value || !active || active.ownerId !== value.ownerId || !isCurrent(active)) { invalidate(); return; }
        scope = value; owner = Object.freeze({ ...active }); onChange(scope);
      } else if (fields(data, ["type", "nonce"]) && data.type === revoked) invalidate();
      else if (fields(data, ["type", "nonce", "requestId", "valid"]) && data.type === checked && pending && data.requestId === pending.requestId)
        pending.finish(data.valid === true && current());
    }
    function snapshot() { if (scope && !current()) invalidate(); return scope; }
    function validate(signal) {
      if (!current() || !signal || signal.aborted || pending) return Promise.resolve(false);
      return new Promise(resolve => {
        let done = false, timeout;
        const requestId = ++sequence;
        if (!Number.isSafeInteger(requestId)) { invalidate(); resolve(false); return; }
        const record = { requestId, finish(ok) {
          if (done) return; done = true;
          timers.clearTimeout(timeout); signal.removeEventListener("abort", abort);
          if (pending === record) pending = null;
          resolve(ok === true);
        } };
        const abort = () => record.finish(false);
        pending = record;
        signal.addEventListener("abort", abort, { once: true });
        timeout = timers.setTimeout(() => { record.finish(false); invalidate(); }, 3000);
        if (signal.aborted || !send(opener, { type: check, nonce, requestId }, origin)) record.finish(false);
      });
    }
    function dispose() { if (disposed) return; disposed = true; invalidate(); target.removeEventListener("message", receive); }
    target.addEventListener("message", receive);
    function start() { return !disposed && validNonce && !!opener && send(opener, { type: ready, nonce }, origin); }
    return Object.freeze({ snapshot, start, validate, invalidate, dispose });
  }
  window.LuminaCreatorApprovedReadingHandoff = Object.freeze({ createSender, createReceiver });
  function mountSender() {
    if (!document.body?.classList.contains("page-creator-studio")) return;
    const section = document.getElementById("writer-manuscript"), selector = document.getElementById("writerManuscriptWork");
    if (!section || !selector || selector.tagName !== "SELECT" || !window.LuminaCreatorApprovedReadonlyTransport || selector.dataset.readingHandoffMounted) return;
    selector.dataset.readingHandoffMounted = "true";
    const transport = window.LuminaCreatorApprovedReadonlyTransport.create();
    const sender = createSender({ readContext() {
      const identity = transport.identity();
      return { identity, context: { workId: selector.value, sourceLocale: document.getElementById("writerManuscriptLocale")?.value,
        workLabel: selector.selectedOptions?.[0]?.textContent || "", ownerId: identity?.ownerId } };
    }, isCurrent: transport.isCurrent, open: window.open.bind(window) });
    const button = document.createElement("button");
    button.type = "button"; button.className = "secondary-action"; button.textContent = "\uc2b9\uc778\uc790\ub8cc \ud655\uc778";
    const status = document.createElement("span"); status.setAttribute("role", "status");
    const commands = document.createElement("div"); commands.className = "writer-actions"; commands.append(button, status);
    (selector.closest("label") || selector.parentNode).insertAdjacentElement("afterend", commands);
    button.addEventListener("click", () => {
      const shell = document.getElementById("studioShell");
      status.textContent = !shell || shell.hidden || selector.disabled || !section.classList.contains("is-active") || !sender.openCurrent()
        ? "\uc791\ud488 \ub610\ub294 \ub85c\uadf8\uc778 \uc0c1\ud0dc\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694." : "";
    });
    const invalidate = () => sender.invalidate();
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "creator:manuscript-accepted", "creator:generation-profile-changed"])
      window.addEventListener(name, invalidate);
    document.addEventListener("change", event => { if (["writerManuscriptWork", "writerManuscriptLocale"].includes(event.target?.id)) invalidate(); }, true);
    window.addEventListener("pagehide", () => { sender.dispose(); transport.dispose(); }, { once: true });
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountSender, { once: true });
    else mountSender();
  }
})();
