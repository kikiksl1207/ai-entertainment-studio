(function () {
  "use strict";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const reasons = ["sexual_content", "harassment", "hate", "impersonation", "spam", "other"];
  const flights = new Map();
  const keys = new Map();
  let view = null;
  const text = key => window.luminaI18n?.t?.(`feed.report.${key}`) || key;
  const owner = () => {
    const auth = typeof getAuth === "function" ? getAuth() : null;
    return auth?.accessToken && uuid.test(auth.user?.id || "") ? { id: auth.user.id, token: auth.accessToken } : null;
  };
  const sameOwner = expected => {
    const current = owner();
    return !!current && current.id === expected.id && current.token === expected.token;
  };
  const available = () => window.feedReportAvailable?.() === true;
  const apply = dialog => window.luminaI18n?.apply?.(dialog);

  function close() {
    const previous = view;
    if (!previous) return;
    view = null;
    previous.dialog.close();
    previous.dialog.remove();
    if (sameOwner(previous.owner) && previous.origin?.isConnected) previous.origin.focus({ preventScroll: true });
  }

  function requestKey(userId, postId, reason) {
    const name = `lumina-feed-report:${userId}:${postId}:${reason}`;
    let value = keys.get(name);
    try { value = value || sessionStorage.getItem(name); } catch (_) {}
    if (!uuid.test(value || "")) value = crypto.randomUUID();
    keys.set(name, value);
    try { sessionStorage.setItem(name, value); } catch (_) {}
    return { name, value };
  }

  function message(current, key) {
    if (view !== current || !sameOwner(current.owner) || !current.dialog.open) return;
    const node = current.dialog.querySelector("[data-report-message]");
    node.setAttribute("data-i18n", `feed.report.${key}`);
    node.textContent = text(key);
    node.hidden = false;
    node.focus({ preventScroll: true });
  }

  async function submit(current, event) {
    event.preventDefault();
    if (view !== current || !current.dialog.open || !sameOwner(current.owner) || !available()) return;
    const flightName = `${current.owner.id}:${current.postId}`;
    if (flights.has(flightName)) return;
    const form = current.dialog.querySelector("form");
    const reason = form.elements.reason.value;
    const detail = form.elements.detail.value.trim();
    if (!reasons.includes(reason) || detail.length > 500) return message(current, "invalid");
    let key;
    try { key = requestKey(current.owner.id, current.postId, reason); }
    catch (_) { return message(current, "error"); }
    const controls = [...form.querySelectorAll("select, textarea, [type=submit]")];
    controls.forEach(control => { control.disabled = true; });
    message(current, "sending");
    const pending = { done: false };
    flights.set(flightName, pending);
    try {
      const result = await apiFetch(`/api/v1/lumina-feed/posts/${encodeURIComponent(current.postId)}/report`, {
        method: "POST", auth: true, throwOnError: true, body: { reason, detail, requestKey: key.value }
      });
      const report = result?.report;
      if (!uuid.test(report?.id || "") || report.postId !== current.postId || report.reporterUserId !== current.owner.id
          || !["submitted", "reviewing", "resolved", "dismissed"].includes(report.status)) throw new Error("Invalid report receipt");
      pending.done = true;
      keys.delete(key.name);
      try { sessionStorage.removeItem(key.name); } catch (_) {}
      message(current, result.alreadySubmitted ? "duplicate" : "submitted");
    } catch (error) {
      message(current, error?.status === 401 ? "auth" : error?.status === 403 || error?.status === 404 ? "unavailable" : "error");
    } finally {
      if (flights.get(flightName) === pending) flights.delete(flightName);
      if (view === current && sameOwner(current.owner) && current.dialog.open) {
        if (pending.done) form.querySelector("[type=submit]").hidden = true;
        else controls.forEach(control => { control.disabled = false; });
      }
    }
  }

  function open(origin) {
    const postId = origin.dataset.feedReport;
    if (origin.disabled || !uuid.test(postId || "") || !available()) return;
    const viewer = owner();
    if (!viewer) {
      if (typeof openAuthModal === "function") openAuthModal("login", { returnTo: { href: window.location.pathname } });
      return;
    }
    if (flights.has(`${viewer.id}:${postId}`)) return;
    close();
    const dialog = document.createElement("dialog");
    dialog.className = "feed-report-dialog";
    dialog.setAttribute("aria-labelledby", "feedReportHeading");
    dialog.innerHTML = `<form novalidate>
      <h2 id="feedReportHeading" data-i18n="feed.report.title"></h2>
      <label for="feedReportReason" data-i18n="feed.report.reason"></label>
      <select id="feedReportReason" name="reason" required>
        <option value="" data-i18n="feed.report.choose"></option>
        ${reasons.map(reason => `<option value="${reason}" data-i18n="feed.report.reason.${reason}"></option>`).join("")}
      </select>
      <label for="feedReportDetail" data-i18n="feed.report.detail"></label>
      <textarea id="feedReportDetail" name="detail" maxlength="500"></textarea>
      <p data-report-message role="status" tabindex="-1" hidden></p>
      <div class="feed-report-actions">
        <button type="button" data-report-cancel data-i18n="feed.report.cancel"></button>
        <button type="submit" data-i18n="feed.report.submit"></button>
      </div>
    </form>`;
    const current = { dialog, postId, owner: viewer, origin };
    view = current;
    dialog.querySelector("form").addEventListener("submit", event => submit(current, event));
    dialog.querySelector("[data-report-cancel]").addEventListener("click", close);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    document.body.append(dialog);
    apply(dialog);
    try { dialog.showModal(); } catch (_) { close(); }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-feed-report]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    open(button);
  });
  ["lumina:authchange", "lumina:auth-expired"].forEach(name => window.addEventListener(name, () => {
    if (view && !sameOwner(view.owner)) close();
  }));
  window.addEventListener("storage", event => {
    if ((event.key === "lumina_auth" || event.key === null) && view && !sameOwner(view.owner)) close();
  });
  window.addEventListener("lumina:localechange", () => { if (view) apply(view.dialog); });
})();
