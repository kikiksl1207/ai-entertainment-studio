import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../pages/feed-notifications.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/feed-notifications.css", import.meta.url), "utf8");
const ID = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const auth = (n = 1, token = "first") => ({ user: { id: ID(n) }, accessToken: "synthetic-" + n + "-" + token, refreshToken: "synthetic-refresh-" + token });
const row = (n, read = false, extra = {}) => ({ id: ID(n), title: "Synthetic title " + n, body: "Synthetic body " + n,
  createdAt: "2026-10-08T00:00:00.000Z", readAt: read ? "2026-10-08T01:00:00.000Z" : null, ...extra });
const page = (notifications = [], unreadCount = notifications.filter(n => n.readAt === null).length, nextCursor = null) => ({ notifications, unreadCount, nextCursor });
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function tick() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

function harness({ language = "en", signedIn = true, loading = false, withRoot = true } = {}) {
  let savedAuth = signedIn ? auth() : null;
  const requests = [], events = new Map(), documentEvents = new Map();
  const document = { activeElement: null, documentElement: { lang: language }, readyState: loading ? "loading" : "complete" };
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
      this.attributes = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.handlers = new Map();
      this._text = ""; this.className = ""; this.id = ""; this.open = false;
      this.classList = { toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force ?? !names.has(name);
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(" "); return enabled;
      } };
    }
    get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
    set textContent(text) { this.replaceChildren(); this._text = String(text); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
    set innerHTML(_) { throw new Error("Raw HTML is forbidden in this fixture"); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ""; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === "open") this.open = true; }
    removeAttribute(name) { delete this.attributes[name]; if (name === "open") this.open = false; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(name, callback) { const list = this.handlers.get(name) || []; list.push(callback); this.handlers.set(name, list); }
    querySelectorAll(selector) {
      const found = [];
      const matches = node => selector.startsWith("#") ? node.id === selector.slice(1)
        : selector === "[data-feed-notifications-root]" ? Object.hasOwn(node.dataset, "feedNotificationsRoot")
          : node.tagName === selector.toUpperCase();
      const visit = node => { for (const child of node.children) { if (matches(child)) found.push(child); visit(child); } };
      visit(this); return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { if (this.isConnected) document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    fire(name, extra = {}) {
      const event = { target: this, key: "", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const callback of this.handlers.get(name) || []) callback(event);
      return event;
    }
    click() { if (!this.disabled && !this.hidden) this.fire("click"); }
  }
  document.body = new Element("body");
  document.createElement = tag => new Element(tag);
  document.querySelector = selector => document.body.querySelector(selector);
  document.addEventListener = (name, callback) => {
    const handlers = documentEvents.get(name) || []; handlers.push(callback); documentEvents.set(name, handlers);
  };
  const root = new Element("div"); root.dataset.feedNotificationsRoot = "";
  const open = new Element("button"); open.id = "feedNotificationsOpen"; open.hidden = true;
  root.append(open); if (withRoot) document.body.append(root);
  const context = { document, URLSearchParams, Intl, Date, getAuth: () => savedAuth,
    apiFetch(path, options, retryDepth) {
      const pending = deferred();
      requests.push({ path, options: plain(options), retryDepth, owner: savedAuth?.user?.id || null, pending });
      return pending.promise;
    },
    window: { addEventListener(name, callback) {
      const handlers = events.get(name) || []; handlers.push(callback); events.set(name, handlers);
    } }
  };
  runInNewContext(source, context, { filename: "pages/feed-notifications.js" });
  return { document, context, root, open, requests,
    node: id => document.querySelector("#feedNotifications" + id),
    readers: () => root.querySelectorAll("button").filter(node => node.dataset.notificationId),
    emit(name, event = {}) { for (const callback of events.get(name) || []) callback(event); },
    setAuth(next, notify = true) { savedAuth = next; if (notify) this.emit("lumina:authchange"); },
    domReady() { document.readyState = "complete"; for (const callback of documentEvents.get("DOMContentLoaded") || []) callback(); },
    evaluateAgain() { runInNewContext(source, context); },
    async resolve(data, index = requests.length - 1) { requests[index].pending.resolve(data); await tick(); },
    async reject(status = 500, index = requests.length - 1) { requests[index].pending.reject({ status, message: "PRIVATE_ERROR_CANARY" }); await tick(); }
  };
}

test("feed notifications exact UI source with synthetic DOM/auth/API stubs, no real HTTP proof", t => {
  t.diagnostic(JSON.stringify({ sourceSha256: createHash("sha256").update(source).digest("hex"),
    cssSha256: createHash("sha256").update(css).digest("hex"), scope: "VM; synthetic DOM/auth/API promises; no HTTP/browser/DB" }));
  assert.doesNotMatch(source, /\.innerHTML|setInterval|localStorage|fetch\(/);
  assert.match(css, /min\(420px, calc\(100% - 32px\)\)/);
  assert.match(css, /max-width: 480px/);
  assert.match(css, /\.feed-notifications-icon\s*\{[^}]*filter:\s*invert\(1\)\s*;/);
  assert.doesNotMatch(css, /letter-spacing:\s*-/);
});

test("feed notifications binds parent hidden bell, creates one panel and makes no mount requests", () => {
  const h = harness();
  assert.equal(h.open.hidden, false); assert.equal(h.open.textContent, "Notifications");
  assert.equal(h.node("Panel").hidden, true); assert.equal(h.requests.length, 0);
  h.evaluateAgain(); assert.equal(h.root.querySelectorAll("dialog").length, 1);
  h.open.click();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].path, "/api/v1/me/notifications?take=20");
  assert.deepEqual(h.requests[0].options, { auth: true, throwOnError: true });
  assert.equal(h.document.activeElement, h.node("Close"));
  assert.equal(h.node("Panel").getAttribute("aria-busy"), "true");
});

test("feed notifications delayed DOM mount and absent integration root remain request-free", () => {
  const h = harness({ loading: true });
  assert.equal(h.open.hidden, true); h.domReady(); assert.equal(h.open.hidden, false);
  assert.equal(harness({ withRoot: false }).requests.length, 0);
});

test("feed notifications anonymous open has auth state but no API or mutation", () => {
  const h = harness({ signedIn: false }); h.open.click(); h.node("ReadAll").click();
  assert.match(h.node("Status").textContent, /Sign in/); assert.equal(h.requests.length, 0);
});

for (const [language, title, empty] of [
  ["ko-KR", "\uC54C\uB9BC", "\uC54C\uB9BC\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."],
  ["en-US", "Notifications", "No notifications."],
  ["ja-JP", "\u901A\u77E5", "\u901A\u77E5\u306F\u3042\u308A\u307E\u305B\u3093\u3002"],
  ["zh-CN", "\u901A\u77E5", "\u6682\u65E0\u901A\u77E5\u3002"],
  ["zh-Hant", "\u901A\u77E5", "\u76EE\u524D\u6C92\u6709\u901A\u77E5\u3002"]
]) {
  test("feed notifications " + language + " labels and empty state use own locale dictionary", async () => {
    const h = harness({ language }); h.open.click(); await h.resolve(page());
    assert.equal(h.node("Heading").textContent, title); assert.equal(h.node("Status").textContent, empty);
    assert.equal(h.node("ReadAll").disabled, true); assert.equal(h.requests.length, 1);
  });
}

test("feed notifications server content is text only, no metadata links or raw error messages", async () => {
  const h = harness(); h.open.click();
  await h.resolve(page([row(10, false, { title: "<img onerror=alert(1)>", body: "<script>private</script>",
    metadata: { url: "https://private.invalid/secret", rawHistoricalBody: "METADATA_CANARY" } })]));
  assert.match(h.node("List").textContent, /<img onerror=alert\(1\)>/);
  assert.equal(h.node("List").querySelectorAll("script").length, 0);
  assert.equal(h.node("List").querySelectorAll("a").length, 0);
  assert.doesNotMatch(h.root.textContent, /METADATA_CANARY|private\.invalid/);
  assert.equal(h.node("Count").textContent, "1 unread");
  h.node("Refresh").click(); await h.reject();
  assert.doesNotMatch(h.root.textContent, /PRIVATE_ERROR_CANARY/);
  assert.equal(h.node("Retry").hidden, false);
});

test("feed notifications cursor pages take20 and unread/all filter ignores out-of-order GET", async () => {
  const h = harness(); h.open.click(); await h.resolve(page([row(10), row(11)], 3, ID(11)));
  h.node("More").click();
  assert.equal(h.requests[1].path, "/api/v1/me/notifications?take=20&cursor=" + ID(11));
  await h.resolve(page([row(12)], 3));
  assert.equal(h.readers().length, 3); assert.equal(h.node("More").hidden, true);
  h.node("Unread").click(); const old = h.requests.length - 1;
  assert.equal(h.requests[old].path, "/api/v1/me/notifications?take=20&status=unread");
  h.node("All").click(); const newest = h.requests.length - 1;
  await h.resolve(page([row(15, true)]), newest); await h.resolve(page([row(16)]), old);
  assert.match(h.node("List").textContent, /Synthetic title 15/);
  assert.doesNotMatch(h.node("List").textContent, /Synthetic title 16/);
});

test("feed notifications hidden cursor400 waits for explicit fresh GET, no writer or automatic retry", async () => {
  const h = harness(); h.open.click(); await h.resolve(page([row(10)], 2, ID(10)));
  h.node("More").click(); await h.reject(400);
  assert.equal(h.requests.length, 2); assert.equal(h.node("More").hidden, true);
  assert.equal(h.readers()[0].disabled, true);
  assert.match(h.node("Status").textContent, /list has changed/);
  h.node("Retry").click(); assert.equal(h.requests[2].path, "/api/v1/me/notifications?take=20");
  await h.resolve(page([row(11)])); assert.equal(h.readers()[0].disabled, false);
});

test("feed notifications explicit PATCH/read body{} suppresses auth auto-replay and updates only on confirmed receipt", async () => {
  const h = harness(); h.open.click(); await h.resolve(page([row(10), row(11)], 2));
  const first = h.readers()[0]; first.focus(); first.click();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].path, "/api/v1/me/notifications/" + ID(10) + "/read");
  assert.deepEqual(h.requests[1].options, { auth: true, throwOnError: true, method: "PATCH", body: {} });
  assert.equal(h.requests[1].retryDepth, 1);
  first.fire("click"); h.node("ReadAll").fire("click"); assert.equal(h.requests.length, 2);
  assert.equal(h.node("Count").textContent, "2 unread");
  await h.resolve({ notification: row(10, true) });
  assert.equal(h.node("Count").textContent, "1 unread");
  assert.equal(h.readers().length, 1); assert.equal(h.document.activeElement, h.node("Refresh"));
  first.fire("click"); assert.equal(h.requests.length, 2);
});

test("feed notifications explicit read-all clears unread list only on confirmed receipt", async () => {
  const h = harness(); h.open.click(); await h.resolve(page([row(10)], 1));
  h.node("Unread").click(); await h.resolve(page([row(10)], 3)); h.node("ReadAll").click();
  assert.equal(h.requests[2].path, "/api/v1/me/notifications/read-all");
  assert.equal(h.requests[2].retryDepth, 1);
  await h.resolve({ ok: true, updatedCount: 3 });
  assert.equal(h.node("Count").textContent, "0 unread"); assert.equal(h.readers().length, 0);
  assert.equal(h.node("ReadAll").disabled, true); assert.match(h.node("Status").textContent, /No unread notifications/);
  assert.equal(h.requests.length, 3);
});

for (const all of [false, true]) {
  test("feed notifications " + (all ? "all" : "one") + " failed PATCH never auto-retries; explicit GET reconciles", async () => {
    const h = harness(); h.open.click(); await h.resolve(page([row(10)]));
    if (all) h.node("ReadAll").click(); else h.readers()[0].click();
    await h.reject(500);
    assert.equal(h.requests.length, 2); assert.equal(h.node("Count").textContent, "1 unread");
    assert.equal(h.readers()[0].disabled, true);
    h.readers()[0].fire("click"); h.node("ReadAll").fire("click"); assert.equal(h.requests.length, 2);
    h.node("Retry").click(); assert.equal(h.requests[2].options.method, undefined);
    await h.resolve(page([row(10, true)], 0)); assert.equal(h.node("Count").textContent, "0 unread");
    assert.doesNotMatch(h.root.textContent, /PRIVATE_ERROR_CANARY/);
  });
}

for (const status of [401, 403, 404]) {
  test("feed notifications PATCH " + status + " is not retried and does not claim success", async () => {
    const h = harness(); h.open.click(); await h.resolve(page([row(10)]));
    h.readers()[0].click(); await h.reject(status);
    assert.equal(h.requests.length, 2); assert.equal(h.node("Count").textContent, "1 unread");
    assert.equal(h.node("ReadAll").disabled, true);
  });
}

test("feed notifications malformed lists and foreign read receipts fail closed", async () => {
  for (const result of [null, { notifications: [], unreadCount: -1, nextCursor: null },
    page([row(10), row(10)]), page([row(10, false, { id: "bad" })]),
    page([row(10, false, { createdAt: "bad" })]), page([row(10)], 1, ID(99))]) {
    const h = harness(); h.open.click(); await h.resolve(result);
    assert.equal(h.readers().length, 0); assert.equal(h.node("ReadAll").disabled, true);
    assert.equal(h.node("Retry").hidden, false);
  }
  const h = harness(); h.open.click(); await h.resolve(page([row(10)]));
  h.readers()[0].click(); await h.resolve({ notification: row(99, true) });
  assert.equal(h.node("Count").textContent, "1 unread"); assert.equal(h.node("Retry").hidden, false);
});

for (const finish of ["resolve", "reject"]) {
  test("feed notifications account change discards old GET " + finish + " and permits new owner", async () => {
    const h = harness(); h.open.click();
    h.setAuth(auth(2)); assert.equal(h.node("Panel").hidden, true); assert.equal(h.node("List").textContent, "");
    h.open.click(); await h.resolve(page([row(20)]), 1);
    if (finish === "resolve") await h.resolve(page([row(10)]), 0); else await h.reject(500, 0);
    assert.match(h.node("List").textContent, /Synthetic title 20/);
    assert.doesNotMatch(h.root.textContent, /Synthetic title 10/);
    assert.equal(h.node("Panel").getAttribute("aria-busy"), "false");
    h.readers()[0].click(); assert.equal(h.requests.at(-1).owner, ID(2));
  });
}

test("feed notifications same-account logout/login discards late GET even with identical token", async () => {
  const h = harness(); h.open.click(); h.setAuth(null); h.setAuth(auth());
  h.open.click(); await h.resolve(page([row(20)]), 1); await h.resolve(page([row(10)]), 0);
  assert.match(h.node("List").textContent, /Synthetic title 20/);
  assert.doesNotMatch(h.root.textContent, /Synthetic title 10/);
});

test("feed notifications close/reopen ignores late GET; Escape restores bell focus", async () => {
  const h = harness(); h.open.click();
  const cancelled = h.node("Panel").fire("keydown", { key: "Escape" });
  assert.equal(cancelled.defaultPrevented, true); assert.equal(h.document.activeElement, h.open);
  h.open.click(); await h.resolve(page([row(20)]), 1); await h.resolve(page([row(10)]), 0);
  assert.match(h.node("List").textContent, /Synthetic title 20/);
  assert.doesNotMatch(h.root.textContent, /Synthetic title 10/);
});

test("feed notifications close/reopen does not replay pending PATCH or apply its stale receipt", async () => {
  const h = harness(); h.open.click(); await h.resolve(page([row(10)]));
  h.readers()[0].click(); h.node("Close").click(); h.open.click();
  assert.equal(h.requests.length, 2);
  await h.resolve({ notification: row(10, true) }, 1);
  assert.equal(h.node("List").textContent, ""); assert.equal(h.node("Count").textContent, "");
  h.node("Refresh").click(); await h.resolve(page([row(20)]));
  assert.match(h.node("List").textContent, /Synthetic title 20/);
});

test("feed notifications stale PATCH cannot release new-account pending mutation or overwrite DOM", async () => {
  const h = harness(); h.open.click(); await h.resolve(page([row(10)]));
  h.readers()[0].click(); h.setAuth(auth(2)); h.open.click(); await h.resolve(page([row(20)]), 2);
  h.readers()[0].click(); await h.resolve({ notification: row(10, true) }, 1);
  assert.equal(h.node("Panel").getAttribute("aria-busy"), "true");
  assert.equal(h.node("Count").textContent, "1 unread");
  await h.resolve({ notification: row(20, true) }, 3);
  assert.equal(h.node("Count").textContent, "0 unread");
  assert.doesNotMatch(h.root.textContent, /Synthetic title 10/);
});

test("feed notifications silent token replacement or retained row cannot send stale action", async () => {
  const h = harness(); h.open.click(); await h.resolve(page([row(10)]));
  const button = h.readers()[0]; h.setAuth(auth(1, "replacement"), false); button.click();
  assert.equal(h.requests.length, 1); assert.equal(h.node("Panel").hidden, true);
  button.fire("click"); assert.equal(h.requests.length, 1);
});

test("feed notifications storage and duplicate auth events clear private DOM and ownership", async () => {
  const h = harness(); h.open.click(); await h.resolve(page([row(10)]));
  h.emit("storage", { key: "unrelated" }); assert.equal(h.node("Panel").hidden, false);
  h.emit("lumina:authchange"); assert.equal(h.node("Panel").hidden, true);
  h.open.click(); await h.resolve(page([row(20)]));
  h.emit("storage", { key: null });
  assert.equal(h.node("List").textContent, ""); assert.equal(h.node("Count").textContent, "");
});

test("feed notifications Tab wraps, locale changes make no requests, icons are fixed local assets", async () => {
  const h = harness(); h.open.click(); await h.resolve(page());
  h.node("Close").focus();
  assert.equal(h.node("Panel").fire("keydown", { key: "Tab", shiftKey: true }).defaultPrevented, true);
  assert.equal(h.document.activeElement, h.node("Refresh"));
  assert.equal(h.node("Panel").fire("keydown", { key: "Tab" }).defaultPrevented, true);
  assert.equal(h.document.activeElement, h.node("Close"));
  h.document.documentElement.lang = "ja-JP"; h.emit("lumina:localechange");
  assert.equal(h.node("Heading").textContent, "\u901A\u77E5"); assert.equal(h.requests.length, 1);
  for (const img of h.root.querySelectorAll("img")) {
    assert.match(img.src, /^\/assets\/icons\/lucide\/(?:bell|x|check|check-check|refresh-cw|chevron-down)\.svg$/);
    assert.equal(img.alt, ""); assert.equal(img.width, 20); assert.equal(img.height, 20);
    assert.equal(img.getAttribute("aria-hidden"), "true");
  }
});

test("feed notifications disconnected root cannot dispatch later mutation", async () => {
  const h = harness(); h.open.click(); await h.resolve(page([row(10)]));
  h.readers()[0].click(); const retained = h.node("ReadAll");
  h.root.remove(); await h.resolve({ notification: row(10, true) });
  retained.fire("click"); assert.equal(h.requests.length, 2);
});
