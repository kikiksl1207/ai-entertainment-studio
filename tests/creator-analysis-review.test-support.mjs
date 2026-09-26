import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import vm from 'node:vm';

export const script = readFileSync(new URL('../pages/creator-analysis-review.js', import.meta.url), 'utf8');
export const ids = {
  work: '11111111-1111-4111-8111-111111111111',
  manuscript: '22222222-2222-4222-8222-222222222222',
  job: '33333333-3333-4333-8333-333333333333'
};
export const sourceHash = 'a'.repeat(64);
export const quoteText = '<script>Local test quotation, not a real manuscript.</script>';
export const evidenceId = index => `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`;
export const citation = { partIndex: 0, partKey: 'fixture-part', paragraphIndex: 0, start: 0, end: quoteText.length, quoteHash: createHash('sha256').update(quoteText).digest('hex') };

export function makeJob(overrides = {}) {
  return { id: ids.job, manuscriptVersionId: ids.manuscript, analysisVersion: 1,
    status: 'completed', kind: 'semantic_extraction_v1', sourceLocale: 'ko', sourceContentHash: sourceHash,
    phase: 'completed', semanticCompleted: true, evidenceCount: 1, partCount: 1, counts: {},
    progress: { totalParagraphs: 1, plannedParagraphs: 1, completedParagraphs: 1, plannedChunks: 1, completedChunks: 1, coverageComplete: true },
    approval: 'not_approved', memoryApproved: false, budget: { usageUnobserved: false }, ...overrides };
}
export function makeEvidence(index = 0, overrides = {}) {
  return { id: evidenceId(index), evidenceType: 'scene', sourcePartKey: 'fixture-part', sourceParagraphIndex: 0,
    provenance: 'semantic_candidate', sourceLocale: 'ko', reviewRequired: true,
    title: `Local fixture ${index + 1}`, observation: '<b>Untrusted fixture observation, not a public work.</b>',
    interpretation: 'model_inference', factualTruthApproved: false, citations: [{ ...citation }], ...overrides };
}
export const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(data) });
export const failure = (code, status = 409) => response({ success: false, error: { code, message: 'Private diagnostic must not render', details: {} } }, status);
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.hidden = false; this.disabled = false; this.value = '';
    this.dataset = {}; this.children = []; this.parent = null; this.listeners = {}; this.attributes = {};
    this.ownText = ''; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  get isConnected() { return this.root || Boolean(this.parent?.isConnected); }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.ownText = String(value); }
  append(...items) { items.forEach(item => { item.parent = this; this.children.push(item); }); }
  replaceChildren(...items) { this.children.forEach(child => { child.parent = null; }); this.children = []; this.ownText = ''; this.append(...items); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  async fire(type = 'click') { if (!this.disabled) for (const handler of this.listeners[type] || []) await handler({ target: this }); }
}

export function createHarness({ job = makeJob(), rows = [makeEvidence()], storage = new Map(), receipt = true, handler } = {}) {
  const analysisIds = ['writerAnalysis', ...['Version', 'State', 'Progress', 'Counts', 'Start', 'Check', 'Boundary', 'Evidence', 'Pages', 'Previous', 'Next', 'PageCount'].map(name => 'writerAnalysis' + name)];
  const generationIds = ['Entry', 'ReviewOpen', 'ReviewState', 'Modal', 'Eyebrow', 'Title', 'Intro', 'Status', 'Sections', 'Close', 'Cancel', 'Save', 'Approve'].map(name => 'writerGeneration' + name);
  const elements = Object.fromEntries([...analysisIds, ...generationIds, 'writerManuscriptBody'].map(id => [id, new Element()]));
  Object.values(elements).forEach(element => { element.root = true; });
  let identity = { ownerId: 'fixture-owner', epoch: 1 };
  let selected = { workId: ids.work, sourceLocale: 'ko' };
  let currentJob = job;
  let currentRows = rows;
  let locale = 'en-US';
  const calls = [], timers = new Map(), intervals = new Map(), listeners = {}, docListeners = {};
  let timerId = 0;
  const receiptValue = () => ({ id: ids.manuscript, ...selected, sourceLocale: selected.sourceLocale, version: 3, contentHash: sourceHash, identity: { ...identity } });
  const defaultRoute = (path, options) => {
    if (options.method === 'POST' && path.endsWith('/analyses')) return response(currentJob);
    const source = path.match(/\/evidence\/([^/]+)\/source$/);
    if (source) return response({ evidenceId: source[1], manuscriptVersionId: ids.manuscript, sourceLocale: selected.sourceLocale,
      reviewRequired: true, citations: [{ ...citation, quote: quoteText }] });
    const cursor = new URL(path, 'https://fixture.invalid').searchParams.get('cursor');
    const start = cursor ? currentRows.findIndex(row => row.id === cursor) + 1 : 0;
    const evidence = currentRows.slice(start, start + 100), hasMore = start + evidence.length < currentRows.length;
    const endCursor = evidence.at(-1)?.id || cursor;
    return response({ job: currentJob, evidence, bounded: true, hasMore, nextCursor: hasMore ? endCursor : null, endCursor,
      review: { status: 'not_approved', fullyReviewed: false, publicationApproved: false, memoryApproved: false } });
  };
  const api = {
    identity: () => ({ ...identity }), isCurrent: value => value?.ownerId === identity.ownerId && value?.epoch === identity.epoch,
    fetch: async (path, options) => {
      const call = { path, options }; calls.push(call);
      return handler ? handler(call, defaultRoute, screen) : defaultRoute(path, options);
    }
  };
  const window = { LuminaCreatorStudioApi: api, LuminaCreatorManuscript: { context: () => ({ ...selected }), receipt: () => receipt ? receiptValue() : null },
    luminaI18n: { t: key => `${locale}:${key}` }, addEventListener: (type, fn) => (listeners[type] ||= []).push(fn) };
  const document = { hidden: false, body: { style: {} }, getElementById: id => elements[id], querySelector: () => null, createElement: tag => new Element(tag),
    addEventListener: (type, fn) => (docListeners[type] ||= []).push(fn) };
  const screen = { elements, calls, storage, window, document, timers,
    posts: () => calls.filter(call => call.options.method === 'POST'),
    emit: (type, event = {}) => (listeners[type] || []).forEach(fn => fn(event)),
    setIdentity: value => { identity = value; }, setContext: value => { selected = { ...selected, ...value }; },
    setJob: value => { currentJob = value; }, setRows: value => { currentRows = value; },
    setLocale: value => { locale = value; screen.emit('lumina:localechange'); },
    tickIdentity: () => intervals.forEach(fn => fn()),
    runPoll: async () => { const match = [...timers].find(([, value]) => value.ms >= 2500 && value.ms < 12000);
      if (match) { timers.delete(match[0]); await match[1].fn(); } await screen.flush(); },
    flush: async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); },
    receive: () => window.LuminaCreatorAnalysis.receive(receiptValue())
  };
  vm.runInNewContext(script, { window, document, sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID }, URLSearchParams, AbortController, queueMicrotask,
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { intervals.set(++timerId, fn); return timerId; } }, { filename: 'creator-analysis-review.js' });
  return screen;
}

export const element = (screen, suffix) => screen.elements['writerAnalysis' + suffix];
export async function click(screen, suffix) { await element(screen, suffix).fire(); await screen.flush(); }
export const evidenceItems = screen => element(screen, 'Evidence').children;
