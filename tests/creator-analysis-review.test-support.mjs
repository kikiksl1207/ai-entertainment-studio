import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import vm from 'node:vm';

export const script = readFileSync(new URL('../pages/creator-analysis-review.js', import.meta.url), 'utf8');
const studioScript = readFileSync(new URL('../pages/creator-studio.js', import.meta.url), 'utf8');
const bridgeEnd = studioScript.indexOf('  window.LuminaCreatorManuscript = {');
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
    approval: 'not_approved', memoryApproved: false, budget: { usageUnobserved: false },
    profileRecovery: { available: false, mode: 'local_settings_only' }, ...overrides };
}
export function makeRecoverableJob(overrides = {}) {
  return makeJob({ status: 'failed', phase: 'finalizing', semanticCompleted: false,
    errorCode: 'analysis_profile_draft_unavailable',
    progress: { ...makeJob().progress, coverageComplete: false },
    profileRecovery: { available: true, mode: 'local_settings_only' }, ...overrides });
}
export function makeGenerationResponse() {
  return { workId: ids.work, analysis: { id: ids.job }, profile: {
    id: '55555555-5555-4555-8555-555555555555', status: 'draft', sourceFingerprint: sourceHash, draftFingerprint: 'b'.repeat(64),
    draftSettings: { schemaVersion: 'creator-generation-profile-v1', kind: 'story',
      sections: ['writing_style', 'scene_scale', 'canon', 'timeline', 'narrative_devices', 'branch_behavior', 'visual_direction', 'visual_cast']
        .map(key => ({ key, decision: 'proposed', value: { summary: 'Local settings draft, not approved.', observations: ['Previous AI interpretation.'],
          ...(key === 'writing_style' ? { categories: [{ category: 'sentence_rhythm', observations: ['Previous style interpretation.'] }], imitationBoundary: 'approved_work_only' } : {}),
          ...(key === 'branch_behavior' ? { selectedChoiceMustMateriallyDiverge: true, maximumSuggestedChoices: 3 } : {}) },
          evidence: [{ summary: 'Original analysis evidence.' }] })) }
  } };
}
export function makeVisualGenerationResponse({ characters = [{ name: 'Mira', appearance: 'Silver hair and a green coat.' }], visualBible = {
  era: 'Near-future city', artStyle: 'Ink illustration', palette: 'Green and silver', prohibited: ['No logos', 'No modern cars']
} } = {}) {
  const value = makeGenerationResponse();
  value.profile.draftSettings.sections.find(section => section.key === 'visual_direction').value.visualBible = visualBible;
  value.profile.draftSettings.sections.find(section => section.key === 'visual_cast').value.characters = characters;
  return value;
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
    this.ownText = '';
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      }
    };
  }
  get isConnected() { return this.root || Boolean(this.parent?.isConnected); }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.ownText = String(value); }
  append(...items) { items.forEach(item => { item.parent = this; this.children.push(item); }); }
  replaceChildren(...items) { this.children.forEach(child => { child.parent = null; }); this.children = []; this.ownText = ''; this.append(...items); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; } }
  setCustomValidity(value) { this.validationMessage = value; }
  reportValidity() { return !this.validationMessage; }
  scrollIntoView() {}
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);
    const matches = (element, part) => {
      const attribute = part.match(/^\[([^=]+)="([^"]+)"\]$/);
      if (attribute) {
        const key = attribute[1].replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return attribute[1].startsWith('data-') ? element.dataset[key] === attribute[2] : element.attributes[attribute[1]] === attribute[2];
      }
      if (part.startsWith('.')) return (element.className || '').split(' ').includes(part.slice(1)) || element.classList.contains(part.slice(1));
      return element.tagName === part.toUpperCase();
    };
    return selector.split(/\s+/).reduce((parents, part) => parents.flatMap(parent => descendants(parent).filter(child => matches(child, part))), [this]);
  }
  focus() {}
  async fire(type = 'click') { if (!this.disabled) for (const handler of this.listeners[type] || []) await handler({ target: this }); }
}

export function createHarness({ job = makeJob(), rows = [makeEvidence()], storage = new Map(), receipt = true, handler, generationProfile, realApi = false } = {}) {
  const analysisIds = ['writerAnalysis', ...['Version', 'State', 'Progress', 'Counts', 'Start', 'Check', 'Recover', 'RecoverState', 'Boundary', 'Views', 'Semantic', 'Structural', 'Empty', 'Evidence', 'Pages', 'Previous', 'Next', 'PageCount'].map(name => 'writerAnalysis' + name)];
  const generationIds = ['Entry', 'ReviewOpen', 'ReviewState', 'Modal', 'Eyebrow', 'Title', 'Intro', 'Status', 'Sections', 'Close', 'Cancel', 'Save', 'Approve'].map(name => 'writerGeneration' + name);
  const elements = Object.fromEntries([...analysisIds, ...generationIds,
    'writerManuscriptBody', 'writerAnalysisRestore', 'writerAnalysisRestoreState'].map(id => [id, new Element()]));
  elements.writerGenerationModal.classList.add('is-hidden');
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
    if (options.method === 'POST' && path.endsWith('/recover-profile')) {
      currentJob = { ...currentJob, status: 'completed', phase: 'completed', semanticCompleted: true, errorCode: null,
        progress: { ...currentJob.progress, coverageComplete: true }, profileRecovery: { available: false, mode: 'local_settings_only' } };
      return response(currentJob);
    }
    if (generationProfile && path.endsWith('/generation-profile') && (!options.method || options.method === 'GET')) return response(generationProfile);
    if (generationProfile && path.endsWith('/generation-profile') && options.method === 'PATCH') {
      generationProfile = { ...generationProfile, profile: { ...generationProfile.profile, draftSettings: JSON.parse(options.body).settings } };
      return response(generationProfile);
    }
    if (generationProfile && path.endsWith('/generation-profile/approve') && options.method === 'POST') {
      generationProfile = { ...generationProfile, profile: { ...generationProfile.profile,
        status: 'approved', approvedSettings: generationProfile.profile.draftSettings } };
      return response(generationProfile);
    }
    if (path.includes(`/stories/${ids.work}/manuscripts?`)) return response({ workId: ids.work,
      items: [{ id: ids.manuscript, workId: ids.work, version: 3, locale: selected.sourceLocale, contentHash: sourceHash }],
      hasMore: false, nextCursor: null });
    if (path.includes(`/manuscripts/${ids.manuscript}/analyses?`)) return response({ manuscriptVersionId: ids.manuscript,
      items: [currentJob], hasMore: false, nextCursor: null });
    const source = path.match(/\/evidence\/([^/]+)\/source$/);
    if (source) return response({ evidenceId: source[1], manuscriptVersionId: ids.manuscript, sourceLocale: selected.sourceLocale,
      reviewRequired: true, citations: [{ ...citation, quote: quoteText }] });
    const url = new URL(path, 'https://fixture.invalid');
    const cursor = url.searchParams.get('cursor');
    const view = url.searchParams.get('view');
    const visibleRows = currentRows.filter(row => view === 'semantic' ? row.provenance === 'semantic_candidate' :
      view === 'structural' ? row.provenance !== 'semantic_candidate' : true);
    const start = cursor ? visibleRows.findIndex(row => row.id === cursor) + 1 : 0;
    const evidence = visibleRows.slice(start, start + 100), hasMore = start + evidence.length < visibleRows.length;
    const endCursor = evidence.at(-1)?.id || cursor;
    return response({ job: currentJob, view, totalCount: visibleRows.length, evidence, bounded: true, hasMore, nextCursor: hasMore ? endCursor : null, endCursor,
      review: { status: 'not_approved', fullyReviewed: false, publicationApproved: false, memoryApproved: false } });
  };
  const api = {
    identity: () => ({ ...identity }), isCurrent: value => value?.ownerId === identity.ownerId && value?.epoch === identity.epoch,
    fetch: async (path, options) => {
      // Match the actual studio bridge's one JSON serialization before transport.
      options = { ...options, headers: { ...options.headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined };
      const call = { path, options }; calls.push(call);
      return handler ? handler(call, defaultRoute, screen) : defaultRoute(path, options);
    }
  };
  const window = { LuminaCreatorStudioApi: api, LuminaCreatorManuscript: { context: () => ({ ...selected }), receipt: () => receipt ? receiptValue() : null },
    luminaI18n: { t: key => `${locale}:${key}`, getLocale: () => locale }, addEventListener: (type, fn) => (listeners[type] ||= []).push(fn) };
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
    receive: (options, value = receiptValue()) => window.LuminaCreatorAnalysis.receive(value, options)
  };
  if (realApi) {
    if (bridgeEnd < 0) throw new Error('Studio API bridge boundary missing');
    // Execute the real bridge initialization, stopping before unrelated page initialization.
    vm.runInNewContext(studioScript.slice(0, bridgeEnd) + '\n})();', {
      window, document, DOMException, AbortController,
      localStorage: { getItem: key => key === 'lumina_auth' ? JSON.stringify({ accessToken: 'local-fixture-token', user: { id: identity.ownerId } }) : null },
      fetch: async (url, options) => {
        const target = new URL(url), call = { path: target.pathname + target.search, options }; calls.push(call);
        return handler ? handler(call, defaultRoute, screen) : defaultRoute(call.path, options);
      }, setTimeout, clearTimeout
    }, { filename: 'creator-studio-api-bridge.js' });
  }
  vm.runInNewContext(script, { window, document, sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID }, URLSearchParams, AbortController, queueMicrotask, structuredClone,
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { intervals.set(++timerId, fn); return timerId; } }, { filename: 'creator-analysis-review.js' });
  return screen;
}

export const element = (screen, suffix) => screen.elements['writerAnalysis' + suffix];
export async function click(screen, suffix) { await element(screen, suffix).fire(); await screen.flush(); }
export const evidenceItems = screen => element(screen, 'Evidence').children;
