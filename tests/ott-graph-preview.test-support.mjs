// Local transport/DOM fixtures only. These are not public works, films, or PG/JWT evidence.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

export const ids = {
  manifest: '11111111-1111-4111-8111-111111111111',
  progress: '22222222-2222-4222-8222-222222222222',
  preview: '33333333-3333-4333-8333-333333333333',
  A: '44444444-4444-4444-8444-444444444444',
  B: '55555555-5555-4555-8555-555555555555',
  C: '66666666-6666-4666-8666-666666666666',
  D: '77777777-7777-4777-8777-777777777777',
  version: '88888888-8888-4888-8888-888888888888'
};
export const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
export const ownerAuth = { accessToken: 'local-owner-token', refreshToken: 'local-owner-refresh', user: { id: 'local-owner' } };
const root = '/api/v1/me/ott-media';
export const ok = data => ({ status: 200, ok: true, json: async () => structuredClone(data) });
// Match the committed HttpExceptionFilter wire envelope, not the service's thrown body.
export const failure = (status, code = ({ 400: 'OTT_INVALID', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
  404: 'OTT_NOT_FOUND', 409: 'OTT_NOT_READY', 410: 'OTT_EXPIRED', 503: 'OTT_STORAGE_UNAVAILABLE' })[status] || 'INTERNAL_SERVER_ERROR') => ({
  status, ok: false, json: async () => ({ success: false, error: {
    code, statusCode: status, message: 'PRIVATE_DIAGNOSTIC_DO_NOT_DISPLAY',
    path: '/private-fixture-only', requestId: 'private-fixture-request'
  } })
});
export const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
export function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

export function graphServer({ locale = 'en', node = 'A', revision = 0, position, status = 'active', longLabels = false } = {}) {
  const states = new Map();
  const receipts = new Map();
  const nodes = {
    A: { startMs: 100, endMs: 700, choices: ['B', 'C', 'D'] },
    B: { startMs: 300, endMs: 1400, choices: ['D'] },
    C: { startMs: 400, endMs: 1500, choices: ['D'] },
    D: { startMs: 800, endMs: 1700, choices: [] }
  };
  const labels = { ko: '다음 장면 선택', en: 'Choose the next scene', ja: '次のシーンを選ぶ', 'zh-Hans': '选择下一场景', 'zh-Hant': '選擇下一場景' };
  const pinId = value => ids.preview.slice(0, -1) + (locales.indexOf(value) + 1);
  const progressId = value => ids.progress.slice(0, -1) + (locales.indexOf(value) + 1);
  function projection(value, snapshot) {
    const s = snapshot || states.get(value);
    const spec = nodes[s.node];
    return { progressId: progressId(value), previewId: pinId(value), manifestId: ids.manifest, graphRevision: 7,
      locale: value, revision: s.revision, status: s.status, positionMs: s.positionMs, idempotentReplay: false,
      visibility: 'private', source: 'authored_uploaded_clips',
      validation: { allReferencedPins: 'valid', bytes: 'current_scene', wholeGraphBytes: 'not_checked' },
      node: { key: s.node, clip: { fileId: ids[s.node], mediaVersionId: ids.version, startMs: spec.startMs, endMs: spec.endMs },
        choices: spec.choices.map(key => ({ key, label: `${labels[value]} ${key}${longLabels ? (' ' + labels[value]).repeat(8) : ''}` })),
        ending: s.node === 'D' ? { key: 'local-ending', label: `${labels[value]} D` } : null },
      subtitles: [{ locale: value, status: 'available', cues: [{ startMs: spec.startMs, endMs: spec.endMs, text: `LOCAL QA ONLY ${value}` }] }],
      availableSubtitleLocales: [value],
      browserPlayback: { sessionPath: `${root}/files/${ids[s.node]}/playback-session`, method: 'POST', mode: 'secure_http_only_cookie' } };
  }
  for (const value of locales) states.set(value, { node, revision, status, positionMs: position ?? nodes[node].startMs });
  const manifest = { manifestId: ids.manifest, workId: ids.version, graphRevision: 7, checksum: 'local-checksum', visibility: 'private',
    readiness: { previewReadyByLocale: Object.fromEntries(locales.map(value => [value, true])), issues: [], fiveLocaleReady: false, publication: 'not_authorized' } };
  function handle(call) {
    const path = new URL(call.url).pathname;
    const body = call.options.body ? JSON.parse(call.options.body) : null;
    if (path === `${root}/playback-manifests/${ids.manifest}`) return ok(manifest);
    if (path === `${root}/playback-manifests/${ids.manifest}/preview-pins`) return ok({ previewId: pinId(body.locale), manifestId: ids.manifest, graphRevision: 7, checksum: manifest.checksum, locale: body.locale, visibility: 'private', publication: 'not_authorized' });
    const value = locales.find(value => path.includes(pinId(value)) || path.includes(progressId(value)));
    if (path.includes('/playback-previews/') && path.endsWith('/progress')) return value ? ok(projection(value)) : failure(404);
    if (path.includes('/playback-progress/') && call.options.method === 'GET') return value ? ok(projection(value)) : failure(404);
    if (path.includes('/playback-progress/')) {
      const key = call.options.headers['Idempotency-Key'];
      if (receipts.has(key)) return ok({ ...receipts.get(key), idempotentReplay: true });
      const s = states.get(value);
      if (!s || s.revision !== body.expectedRevision || s.node !== body.nodeKey || body.manifestId !== ids.manifest) return failure(409, 'OTT_CONFLICT');
      if (path.endsWith('/choices')) {
        if (!nodes[s.node].choices.includes(body.choiceKey)) return failure(400, 'OTT_INVALID');
        s.node = body.choiceKey;
        s.positionMs = nodes[s.node].startMs;
        s.status = 'active';
      } else {
        s.positionMs = body.positionMs;
        s.status = s.node === 'D' && s.positionMs === nodes.D.endMs ? 'completed' : 'active';
      }
      s.revision++;
      const result = projection(value);
      result.validation.bytes = path.endsWith('/position') ? 'not_checked' : 'current_and_target';
      receipts.set(key, result);
      return ok(result);
    }
    const fileId = Object.values(ids).find(id => path === `${root}/files/${id}/playback-session`);
    if (fileId) return ok({ playback: { path: `/api/v1/ott-media/private-files/${fileId}/delivery`, mode: 'secure_http_only_cookie', rangeSupported: true, expiresAt: new Date(Date.now() + 60000).toISOString() } });
    throw new Error(`Unexpected local fixture request: ${path}`);
  }
  return { handle, states, receipts, manifest, projection, pinId, progressId, locale };
}

class Element {
  constructor(tag = 'div', id = '') { this.tagName = tag; this.id = id; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.hidden = false; this.disabled = false; this.isConnected = true; this.classList = { toggle() {} }; }
  addEventListener(type, handler, options = {}) { this.listeners.set(type, [...(this.listeners.get(type) || []), { handler, once: options.once }]); }
  fire(type, event = {}) { const list = this.listeners.get(type) || []; this.listeners.set(type, list.filter(item => !item.once)); for (const { handler } of list) handler(event); }
  append(child) { this.children.push(child); child.parent = this; child.isConnected = this.isConnected; }
  replaceChildren(...children) { for (const child of this.children) child.isConnected = false; this.children = []; for (const child of children) this.append(child); }
  replaceWith(child) { this.isConnected = false; if (this.onReplace) this.onReplace(child); }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelectorAll(tag) { return this.children.filter(child => child.tagName === tag); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) || null; }
  removeAttribute(key) { this.attributes.delete(key); }
  set src(value) { this.setAttribute('src', value); }
  get src() { return this.getAttribute('src') || ''; }
}
class Video extends Element {
  constructor() { super('video', 'privateVideo'); this.currentTime = 0; this.duration = 2; this.paused = true; }
  play() { this.paused = false; this.fire('play'); return Promise.resolve(); }
  pause() { if (!this.paused) { this.paused = true; this.fire('pause'); } }
  load() { this.currentTime = 0; }
}

export function browser({ server = graphServer(), search = `?manifestId=${ids.manifest}`, locale = 'en', signedIn = true, protocol = 'https:', storage = new Map(), intercept } = {}) {
  const html = readFileSync(new URL('../ott-private-preview/index.html', import.meta.url), 'utf8');
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element('div', id)]));
  const installVideo = value => { elements.privateVideo = value; value.onReplace = installVideo; };
  installVideo(new Video());
  const events = new Element();
  const document = { hidden: false, title: '', documentElement: {}, getElementById: id => elements[id],
    createElement: tag => tag === 'video' ? new Video() : new Element(tag), addEventListener: events.addEventListener.bind(events) };
  const data = new Map([['lumina_locale', locale], ...(signedIn ? [['lumina_auth', JSON.stringify(ownerAuth)]] : [])]);
  const localStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const timers = new Map();
  let timerId = 0;
  const calls = [];
  const blobs = new Map();
  const revoked = [];
  let now = Date.now();
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = { document, location: { search, protocol }, localStorage, sessionStorage, URLSearchParams, AbortController, Blob, crypto: webcrypto, console, Date: ClockDate,
    URL: { createObjectURL: value => { const url = `blob:local-${blobs.size}`; blobs.set(url, value); return url; }, revokeObjectURL: value => revoked.push(value) },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; }, clearTimeout: id => timers.delete(id), setInterval: callback => { events.interval = callback; },
    window: { LUMINA_API_BASE: 'https://api.local.test', addEventListener: events.addEventListener.bind(events) },
    fetch: async (url, options) => { const call = { url, options }; calls.push(call); return (await intercept?.(call, server)) ?? server.handle(call); } };
  vm.runInNewContext(readFileSync(new URL('../pages/ott-graph-preview.js', import.meta.url), 'utf8'), context);
  return { elements, events, document, data, calls, timers, blobs, revoked, storage, server,
    advanceTime(ms) { now += ms; }, now: () => now,
    get video() { return elements.privateVideo; },
    choices: () => elements.graphChoices.children,
    commands: () => calls.filter(call => /\/(position|choices)$/.test(call.url)),
    runTimer(delay) { const entry = [...timers].find(([, timer]) => timer.delay === delay); if (!entry) throw new Error(`Missing timer ${delay}`); timers.delete(entry[0]); entry[1].callback(); },
    async play() { elements.previewStart.fire('click'); await flush(); elements.privateVideo.fire('loadedmetadata'); elements.privateVideo.fire('seeked'); await flush(); }
  };
}
