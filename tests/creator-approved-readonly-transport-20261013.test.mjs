import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../pages/creator-approved-readonly-transport.js", import.meta.url), "utf8");
const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
const work = "33333333-3333-4333-8333-333333333333";
const path = "/api/v1/me/creator-studio/stories/" + work +
  "/generation-profile/approved-section-bytes?measurement=json-utf8-v1";
const authA = { accessToken: "synthetic.A.token", user: { id: ownerA }, refreshToken: "unused.synthetic.refresh" };
const authB = { accessToken: "synthetic.B.token", user: { id: ownerB } };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ auth = authA, send = async () => ({ status: 200 }), create = true } = {}) {
  const values = new Map();
  if (auth !== null) values.set("lumina_auth", JSON.stringify(auth));
  const reads = [], writes = [], calls = [], listeners = new Map();
  let storageFails = false;
  const storage = {
    getItem(key) {
      reads.push(key);
      if (storageFails) throw new Error("synthetic private storage error");
      return values.get(key) ?? null;
    },
    setItem(...args) { writes.push(["set", ...args]); },
    removeItem(...args) { writes.push(["remove", ...args]); },
    clear() { writes.push(["clear"]); }
  };
  const eventTarget = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { for (const listener of [...(listeners.get(event.type) || [])]) listener(event); }
  };
  const nativeFetch = (url, options) => { calls.push({ url, options }); return send(url, options); };
  const window = { ...eventTarget, localStorage: storage, fetch: nativeFetch };
  const context = vm.createContext({ window, AbortController });
  vm.runInContext(source, context, { filename: "creator-approved-readonly-transport.js" });
  const exported = window.LuminaCreatorApprovedReadonlyTransport;
  const adapter = create ? exported.create({ storage, fetch: nativeFetch, eventTarget }) : null;
  return {
    adapter, exported, window, values, reads, writes, calls, listeners,
    setAuth(auth) { if (auth === null) values.delete("lumina_auth"); else values.set("lumina_auth", JSON.stringify(auth)); },
    emit(type, fields = {}) { eventTarget.dispatchEvent({ type, ...fields }); },
    failStorage(value) { storageFails = value; }
  };
}

function request(f, overrides = {}) {
  return {
    method: "GET", identity: f.adapter.identity(), token: f.adapter.getAuth()?.accessToken,
    _retried: true, cache: "no-store", headers: { "Cache-Control": "no-store", Accept: "application/json" },
    signal: new AbortController().signal, ...overrides
  };
}

function rejectsCode(promise, code) {
  return assert.rejects(promise, error => error.code === code && error.message === "Readonly transport unavailable");
}

test("Factory exports only a reusable facade without installation, migration, writes, or automatic GET", () => {
  const f = fixture({ create: false });
  assert.deepEqual(Object.keys(f.exported), ["create", "createCatalog"]);
  assert.equal(f.window.getAuth, undefined);
  assert.equal(f.window.LuminaCreatorStudioApi, undefined);
  assert.equal(f.calls.length, 0);
  assert.equal(f.reads.length, 0);
  const adapter = f.exported.create();
  assert.deepEqual(Object.keys(adapter), ["getAuth", "identity", "isCurrent", "fetch", "dispose"]);
  assert.equal(f.calls.length, 0);
  assert.equal(f.reads.length, 0);
  assert.equal(f.writes.length, 0);
  adapter.dispose();
});

test("Exact widget GET shape constructs fixed bearer headers and returns the unread raw response", async () => {
  const response = { status: 200, get body() { throw new Error("body must remain unread"); },
    json() { throw new Error("JSON must remain unread"); }, text() { throw new Error("text must remain unread"); } };
  const f = fixture({ send: async () => response });
  const options = request(f);
  assert.equal(Object.hasOwn(options, "auth"), false);
  assert.equal(await f.adapter.fetch(path, options), response);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.url, "https://api.lumina-stage.com" + path);
  assert.equal(call.options.method, "GET");
  assert.equal(call.options.credentials, "omit");
  assert.equal(call.options.redirect, "error");
  assert.equal(call.options.referrerPolicy, "no-referrer");
  assert.equal(call.options.cache, "no-store");
  assert.equal(call.options.headers.Authorization, "Bearer synthetic.A.token");
  assert.equal(call.options.headers.Accept, "application/json");
  assert.equal(call.options.headers["Cache-Control"], "no-store");
  assert.deepEqual(Object.keys(call.options.headers).sort(), ["Accept", "Authorization", "Cache-Control"]);
  assert.equal(Object.hasOwn(call.options, "body"), false);
  assert.equal(Object.hasOwn(call.options, "identity"), false);
  assert.equal(Object.hasOwn(call.options, "token"), false);
  assert.equal(f.writes.length, 0);
  f.adapter.dispose();
});

test("Absolute origins, invalid work UUIDs, and every non-section endpoint fail before fetch", async () => {
  const f = fixture();
  for (const wrong of ["https://api.lumina-stage.com" + path, "https://foreign.invalid" + path, "//foreign.invalid" + path,
    path.replace(work, "not-a-uuid"), path.replace(work, "%33" + work.slice(1)),
    path.replace("approved-section-bytes", "approved-wire"), path.replace("/me/", "/ME/"),
    "/api/v1/wallet", path + "/", path + "\n"]) {
    await rejectsCode(f.adapter.fetch(wrong, request(f)), "invalid_request");
  }
  assert.equal(f.calls.length, 0);
  f.adapter.dispose();
});

test("Missing, duplicate, foreign, locale, choice, and fragment query variations are rejected", async () => {
  const f = fixture();
  const base = path.split("?")[0];
  for (const wrong of [base, base + "?measurement=gzip-base64-v1", path + "&measurement=json-utf8-v1",
    path + "&locale=ko", path + "&choiceId=" + work, path + "&x=1", path + "#work",
    base + "?locale=ko&measurement=json-utf8-v1", base + "?MEASUREMENT=json-utf8-v1",
    base + "?measurement=json%2Dutf8%2Dv1"]) {
    await rejectsCode(f.adapter.fetch(wrong, request(f)), "invalid_request");
  }
  assert.equal(f.calls.length, 0);
  f.adapter.dispose();
});

test("Methods, bodies, caller authorization overrides, retry flags, and cookie options cannot widen GET", async () => {
  const f = fixture();
  for (const override of [{ method: "POST" }, { method: "HEAD" }, { method: "get" }, { body: null }, { body: undefined },
    { formData: {} }, { credentials: "include" }, { _retried: false }, { auth: false }, { cache: "default" },
    { headers: { Accept: "application/json", "Cache-Control": "no-store", Authorization: "Bearer foreign" } },
    { headers: { Accept: "text/plain", "Cache-Control": "no-store" } }, { signal: null }]) {
    await rejectsCode(f.adapter.fetch(path, request(f, override)), "invalid_request");
  }
  assert.equal(f.calls.length, 0);
  f.adapter.dispose();
});

test("Canonical auth yields only UUID owner and bearer token, never legacy storage or refresh authority", async () => {
  const f = fixture();
  const auth = f.adapter.getAuth();
  assert.deepEqual(Object.keys(auth).sort(), ["accessToken", "user"]);
  assert.deepEqual(Object.keys(auth.user), ["id"]);
  assert.equal(auth.user.id, ownerA);
  assert.equal(auth.accessToken, authA.accessToken);
  assert.equal(Object.isFrozen(auth), true);
  assert.equal(Object.isFrozen(auth.user), true);
  assert.deepEqual(Object.keys(f.adapter.identity()).sort(), ["epoch", "ownerId"]);
  for (const alias of [{ access_token: "synthetic.alias", viewer: { userId: ownerA } },
    { token: "synthetic.alias", user: { id: ownerA } }, { tokens: { accessToken: "synthetic.alias" }, user: { id: ownerA } }]) {
    f.setAuth(alias);
    assert.equal(f.adapter.getAuth().accessToken, "synthetic.alias");
  }
  for (const invalid of [null, {}, { refreshToken: "refresh.only", user: { id: ownerA } },
    { accessToken: "synthetic.token", user: { email: "synthetic@example.invalid" } },
    { accessToken: "synthetic.token", user: { id: "not-a-uuid" } },
    { accessToken: "synthetic.token", user: { id: ownerA + "\n" } },
    { accessToken: "token\r\ninjected", user: { id: ownerA } },
    { accessToken: "synthetic.token\n", user: { id: ownerA } },
    { accessToken: "x".repeat(8193), user: { id: ownerA } }, true, []]) {
    f.setAuth(invalid);
    assert.equal(f.adapter.getAuth(), null);
    assert.equal(f.adapter.identity(), null);
    await rejectsCode(f.adapter.fetch(path, request(f)), "unauthenticated");
  }
  f.values.set("lumina.session", JSON.stringify(authA));
  f.values.delete("lumina_auth");
  assert.equal(f.adapter.getAuth(), null);
  assert.equal(f.reads.every(key => key === "lumina_auth"), true);
  assert.equal(f.writes.length, 0);
  assert.equal(f.calls.length, 0);
  f.adapter.dispose();
});

test("A raw 401 returns once without refresh, retry, response reads, logout, or storage mutation", async () => {
  const response = { status: 401, json() { throw new Error("no response parsing"); } };
  const f = fixture({ send: async () => response });
  const before = f.adapter.identity();
  assert.equal(await f.adapter.fetch(path, request(f)), response);
  assert.equal(f.calls.length, 1);
  assert.equal(f.adapter.isCurrent(before), true);
  assert.equal(f.writes.length, 0);
  assert.equal(f.calls.every(call => call.url === "https://api.lumina-stage.com" + path), true);
  f.adapter.dispose();
});

test("Owner or access-token replacement before dispatch rejects the captured identity and token", async () => {
  for (const replacement of [authB, { ...authA, accessToken: "synthetic.rotated.token" }]) {
    const f = fixture();
    const old = request(f);
    f.setAuth(replacement);
    assert.equal(f.adapter.isCurrent(old.identity), false);
    await rejectsCode(f.adapter.fetch(path, old), "stale");
    assert.equal(f.calls.length, 0);
    const current = f.adapter.identity();
    await rejectsCode(f.adapter.fetch(path, request(f, { identity: current, token: "foreign.token" })), "stale");
    assert.equal(f.calls.length, 0);
    f.adapter.dispose();
  }
});

test("Native storage A-B-A invalidation settles old requests and cancels late bodies without accepting old epochs", async () => {
  const wait = deferred();
  let canceled = 0;
  const f = fixture({ send: () => wait.promise });
  const old = request(f);
  const pending = f.adapter.fetch(path, old);
  const rejected = rejectsCode(pending, "stale");
  f.setAuth(authB); f.emit("storage", { key: "lumina_auth" });
  f.setAuth(authA); f.emit("storage", { key: "lumina_auth" });
  await rejected;
  assert.equal(f.adapter.isCurrent(old.identity), false);
  assert.equal(f.adapter.identity().epoch > old.identity.epoch, true);
  assert.equal(f.calls[0].options.signal.aborted, true);
  wait.resolve({ body: { cancel() { ++canceled; return Promise.reject(new Error("synthetic cancel rejection")); } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(canceled, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.writes.length, 0);
  f.adapter.dispose();
});

test("Same-value logout-login and auth-expired events retire identities while unrelated storage does not", () => {
  const f = fixture();
  const old = f.adapter.identity();
  f.emit("storage", { key: "unrelated.synthetic.preference" });
  assert.equal(f.adapter.isCurrent(old), true);
  f.setAuth(null); f.emit("lumina:authchange");
  f.setAuth(authA); f.emit("lumina:authchange");
  assert.equal(f.adapter.isCurrent(old), false);
  const restored = f.adapter.identity();
  f.emit("lumina:authchange");
  assert.equal(f.adapter.isCurrent(restored), false);
  const beforeExpired = f.adapter.identity();
  f.emit("lumina:auth-expired");
  assert.equal(f.adapter.isCurrent(beforeExpired), false);
  const beforeClear = f.adapter.identity();
  f.emit("storage", { key: null });
  assert.equal(f.adapter.isCurrent(beforeClear), false);
  assert.equal(f.calls.length, 0);
  f.adapter.dispose();
});

test("Dispose and pagehide remove owned listeners, settle pending calls, and reject all late or future results", async () => {
  for (const pagehide of [false, true]) {
    const wait = deferred();
    let canceled = 0;
    const f = fixture({ send: () => wait.promise });
    const options = request(f);
    const pending = f.adapter.fetch(path, options);
    const rejected = rejectsCode(pending, "disposed");
    if (pagehide) f.emit("pagehide"); else f.adapter.dispose();
    await rejected;
    assert.equal([...f.listeners.values()].every(group => group.size === 0), true);
    assert.equal(f.adapter.identity(), null);
    assert.equal(f.adapter.getAuth(), null);
    assert.equal(f.adapter.isCurrent(options.identity), false);
    await rejectsCode(f.adapter.fetch(path, options), "disposed");
    assert.equal(f.calls.length, 1);
    wait.resolve({ body: { cancel() { ++canceled; } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(canceled, 1);
    f.adapter.dispose();
  }
});

test("Storage failures and caller abort fail closed, consume late rejection, and never expose foreign errors", async () => {
  const wait = deferred();
  const f = fixture({ send: () => wait.promise });
  const old = f.adapter.identity();
  f.failStorage(true);
  assert.equal(f.adapter.getAuth(), null);
  assert.equal(f.adapter.isCurrent(old), false);
  await rejectsCode(f.adapter.fetch(path, request(f)), "unauthenticated");
  assert.equal(f.calls.length, 0);
  f.failStorage(false);
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await rejectsCode(f.adapter.fetch(path, request(f, { signal: alreadyAborted.signal })), "stale");
  assert.equal(f.calls.length, 0);
  const abort = new AbortController();
  const unhandled = [];
  const monitor = error => unhandled.push(error);
  process.on("unhandledRejection", monitor);
  try {
    const pending = f.adapter.fetch(path, request(f, { signal: abort.signal }));
    const rejected = rejectsCode(pending, "stale");
    abort.abort();
    await rejected;
    assert.equal(f.calls[0].options.signal.aborted, true);
    wait.reject(new Error("synthetic foreign private failure"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(unhandled.length, 0);
    assert.equal(f.calls.length, 1);
    assert.equal(f.writes.length, 0);
  } finally {
    process.removeListener("unhandledRejection", monitor);
    f.adapter.dispose();
  }
  const failed = fixture({ send: () => { throw new Error("synthetic private native failure"); } });
  await rejectsCode(failed.adapter.fetch(path, request(failed)), "transport");
  assert.equal(failed.calls.length, 1);
  assert.equal(failed.writes.length, 0);
  failed.adapter.dispose();
});
