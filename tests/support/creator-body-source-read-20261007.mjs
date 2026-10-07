import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';

const root = new URL('../../', import.meta.url);
export const sourcePath = process.env.CREATOR_BODY_SOURCE_READ_SOURCE || new URL('pages/creator-body-trial.js', root);
export const previewPath = process.env.CREATOR_BODY_SOURCE_READ_PREVIEW || new URL('pages/creator-body-preview.js', root);
export const source = readFileSync(sourcePath, 'utf8');
const previewSource = readFileSync(previewPath, 'utf8');
export const sourceSha = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
export const previewSha = createHash('sha256').update(readFileSync(previewPath)).digest('hex');
export const clone = value => JSON.parse(JSON.stringify(value));
export const id = value => `${String(value).padStart(8, '0')}-1111-4111-8111-${String(value).padStart(12, '0')}`;
export const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
export const privateMarker = 'SYNTHETIC_SOURCE_PRIVATE_NOT_EVENT_APPROVAL';
export const permissionFlags = ['generationStarted', 'imageGenerationStarted', 'publicationStarted', 'sharedReuseAuthorized',
  'generatedEventApprovalSupported', 'generatedEventReadProofAvailable', 'chatCurrentIdentityClaimed', 'readerMemoryApplied'];
export const target = (locale = 'en', workId = id(1)) => ({ workId, locale });
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export const response = (value, status = 200, extra = {}) => ({
  status, headers: { get: () => null }, text: async () => JSON.stringify(value), ...extra
});
export const approvalState = (workId = id(1)) => ({
  contract: 'story-author-body-trial-state-v1', workId, state: 'approval_recorded', readOnly: true,
  generationAuthorized: false, currentAuthorizationVerified: false, imageGenerationStarted: false,
  approval: { id: id(7), expiresAt: '2099-12-31T23:59:59.000Z' },
  budget: { knownActualCostKrw: '0.250001', reservedMaximumCostKrw: '4000.000000', committedCostKrw: '4000.250001',
    approvedBudgetKrw: '10000.000000', remainingBudgetKrw: '5999.749999', requestCount: 2, pendingCount: 1,
    unknownCostCount: 0, verifiedSharedReuseCount: 0, evidenceReadyForBudgetCheck: true }
});
export const preview = (workId = id(1), locale = 'en') => ({
  contract: 'story-author-body-preview-v1', workId, locale, readOnly: true, imageGenerationStarted: false,
  progress: { progressId: id(2), revision: 7, status: 'active', storyVersion: 3, currentBeatPosition: 1,
    scene: { id: id(3), isGenerated: true, title: 'Saved synthetic scene', endingType: null,
      beats: [{ id: id(4), position: 1, type: 'paragraph', content: 'Saved body.\r\n  Exact spacing.' }] },
    choices: [{ id: id(5), label: 'Original route', routeKind: 'writer_original' },
      { id: id(6), label: 'AI route', routeKind: 'generation_required' }] }
});
export const bodyReview = (locale = 'en', approvalBasis = 'human_review') => ({
  id: id(10), locale, version: 2, decision: 'approve', approvalBasis,
  styleReviewed: approvalBasis === 'human_review', charactersReviewed: approvalBasis === 'human_review',
  timelineReviewed: approvalBasis === 'human_review', createdAt: '2026-10-07T00:00:00.000Z', withdrawnAt: null,
  applicability: 'current'
});
export function preparation(locale = 'en', workId = id(1)) {
  const digest = 'a'.repeat(64);
  return { contract: 'story-author-body-memory-preparation-v1', workId, locale, readOnly: true,
    ...Object.fromEntries(permissionFlags.map(key => [key, false])), state: 'reviewable', bodyReviewable: true,
    target: { progressId: id(2), progressRevision: 7, sceneId: id(3), sourceBindingHash: digest, bodyChecksum: digest, ending: false },
    sourcePins: { releaseId: id(11), releaseChecksum: digest, releaseVersion: 3, releaseRevision: 4,
      manuscriptVersionId: id(12), manuscriptHash: digest, routeNodeId: id(13), routeHash: digest, routeStepHash: digest,
      sourceRouteNodeId: id(14), sourceRouteHash: digest, continuationId: id(15), materializedHash: digest },
    participantReference: { id: id(16), artistId: id(17), participantFingerprint: digest }, latestBodyReview: bodyReview(locale) };
}
export const withheld = state => ({ state, releaseVersion: null, progressRevision: null, bodyReview: null });
export const projected = (review = bodyReview()) => ({ state: 'reviewable', releaseVersion: 3, progressRevision: 7,
  bodyReview: review ? { decision: review.decision, approvalBasis: review.approvalBasis, applicability: review.applicability } : null });
export const originalReceipt = () => ({ contract: 'story-author-body-trial-choice-v1', progressId: id(2),
  revisionAfterRequest: 8, status: 'active', generationStarted: false, imageGenerationStarted: false, idempotentReplay: false });

export function library(extra = {}) {
  const effects = { storage: 0, timer: 0, network: 0, key: 0, auth: 0, dispatch: 0 };
  const forbidden = kind => () => { effects[kind]++; throw new Error(`Forbidden unit effect: ${kind}`); };
  const storage = { getItem: forbidden('storage'), setItem: forbidden('storage'), removeItem: forbidden('storage') };
  const window = { localStorage: storage, sessionStorage: storage, crypto: { randomUUID: forbidden('key') },
    getAuth: forbidden('auth'), fetch: forbidden('network'), setTimeout: forbidden('timer'), setInterval: forbidden('timer'),
    ...extra.window };
  const vm = createContext({ window, TextEncoder, TextDecoder, AbortController,
    fetch: forbidden('network'), setTimeout: forbidden('timer'), setInterval: forbidden('timer'),
    ...extra.globals });
  runInContext(previewSource, vm, { filename: String(previewPath) });
  runInContext(source, vm, { filename: String(sourcePath) });
  return { api: window.LuminaCreatorBodyTrial, previewApi: window.LuminaCreatorBodyPreview, effects, vm, window };
}

export function screen(handler = ({ reply }) => reply(), settings = {}) {
  let owner = { ownerId: id(8), epoch: 1 }, workId = id(1), locale = 'en', language = 'en', shown = true, authorized = true;
  const calls = [], states = [], lib = library();
  const controller = lib.api.createController({
    fetch: async (url, options) => {
      const kind = url.includes('/memory-preparation?') ? 'source' : url.endsWith('/body-trial-state') ? 'state' :
        url.includes('/body-preview?') ? 'preview' : url.endsWith('/read-beats') ? 'read' : 'choice';
      const call = { url, options, kind, target: target(locale, workId) }; calls.push(call);
      const reply = () => response(kind === 'state' ? approvalState(workId) : kind === 'preview' ? preview(workId, locale) :
        kind === 'source' ? preparation(locale, workId) : originalReceipt());
      return handler({ ...call, calls, reply });
    }, identity: () => owner, isCurrent: value => authorized && owner?.ownerId === value?.ownerId && owner?.epoch === value?.epoch,
    context: () => ({ workId, locale }), locale: () => language, visible: () => shown,
    onChange: value => states.push(clone(value)), onDispatch: () => { lib.effects.dispatch++; },
    makeIdempotencyKey: () => { lib.effects.key++; return 'source-read-test-0001'; }, ...settings
  });
  return { ...lib, ...controller, calls, states, set: {
    owner: value => { owner = value; }, work: value => { workId = value; }, locale: value => { locale = value; },
    language: value => { language = value; }, shown: value => { shown = value; }, authorized: value => { authorized = value; }
  } };
}

class UnitElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.hidden = false;
    this.disabled = false; this.attributes = {}; this.listeners = new Map(); this.ownText = ''; this.value = '';
    this.classList = { contains: name => this.className?.split(' ').includes(name) }; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.ownText = ''; this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, fn) { const listeners = this.listeners.get(name) || []; listeners.push(fn); this.listeners.set(name, listeners); }
  async click() { if (this.disabled) return; for (const listener of this.listeners.get('click') || []) await listener({ target: this }); }
}

export function mounted(locale = 'en', sourceValue = preparation(locale)) {
  const host = new UnitElement('section'), shell = new UnitElement('main'), section = new UnitElement('section');
  const work = new UnitElement('select'), language = new UnitElement('select');
  work.value = id(1); language.value = locale; section.className = 'is-active';
  const fixed = { studioShell: shell, 'writer-manuscript': section, writerManuscriptWork: work, writerManuscriptLocale: language };
  const find = (node, key) => node.id === key ? node : node.children.map(child => find(child, key)).find(Boolean);
  const document = { documentElement: { lang: locale }, visibilityState: 'visible', createElement: tag => new UnitElement(tag),
    getElementById: key => fixed[key] || find(host, key), addEventListener() {} };
  const calls = [], storage = { reads: 0, writes: 0 };
  const owner = { ownerId: id(8), epoch: 1 };
  const lib = library({ globals: { document }, window: {
    // The pre-existing mount deadline timer is disabled, not treated as source polling.
    setTimeout: undefined, clearTimeout: undefined, addEventListener() {},
    sessionStorage: { getItem() { storage.reads++; return null; }, setItem() { storage.writes++; throw new Error('No journal writes'); } },
    LuminaCreatorStudioApi: { identity: () => owner, isCurrent: value => value.ownerId === owner.ownerId && value.epoch === owner.epoch,
      fetch: async (url, options) => { calls.push({ url, options }); return response(url.includes('/memory-preparation?') ? sourceValue :
        url.endsWith('/body-trial-state') ? approvalState() : preview(id(1), locale)); } }
  } });
  const controller = lib.api.mount(host);
  return { ...lib, controller, calls, storage, host, element: key => document.getElementById(key) };
}
