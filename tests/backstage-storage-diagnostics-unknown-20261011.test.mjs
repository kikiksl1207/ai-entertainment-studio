import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// Execute actual functions with synthetic DOM/transport; never bootstrap auth.
const sourceFile = process.env.BACKSTAGE_STORAGE_DIAGNOSTICS_SOURCE_FILE ||
  new URL('../backstage.js', import.meta.url);
const sourceBytes = await readFile(sourceFile);
const source = sourceBytes.toString('utf8');
export const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
export const caseCount = 9;
export const baselineCaseCount = 2;
const expectedPin = process.env.BACKSTAGE_STORAGE_DIAGNOSTICS_SOURCE_SHA256;
if (expectedPin !== undefined) {
  assert.match(expectedPin, /^[a-f0-9]{64}$/i);
  assert.equal(sourceSha256, expectedPin.toLowerCase(), 'select exact source bytes');
}

const functionNames = [
  'escapeHtml', 'formatCount', 'storageConfiguredLabel', 'storageBooleanLabel',
  'objectStorageSignal', 'renderObjectStorageDiagnostics',
  'renderObjectStorageDiagnosticsFallback', 'loadObjectStorageDiagnostics',
];
const definitions = functionNames.map(name => {
  const pattern = new RegExp(
    '^(?:async )?function ' + name + '\\([^\\n]*\\) \\{\\r?\\n[\\s\\S]*?^\\}', 'gm',
  );
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, 'extract one actual ' + name);
  return matches[0][0];
});
export const functionPins = Object.fromEntries(functionNames.map((name, index) => [
  name, createHash('sha256').update(definitions[index]).digest('hex'),
]));
const actualSource = definitions.join('\n') +
  '\n({ renderObjectStorageDiagnostics, renderObjectStorageDiagnosticsFallback, loadObjectStorageDiagnostics });';
const nodeNames = [
  'objectStorageReason', 'objectStorageDiagnosticGrid', 'objectStorageUploadStats',
  'objectStorageActions', 'objectStoragePolicy',
];
const PATH = '/backstage/operations/object-storage/diagnostics';
const UNKNOWN = '\uD655\uC778 \uBD88\uAC00';

function node() {
  const classes = new Set();
  return {
    innerHTML: '', textContent: '',
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      },
    },
  };
}

function fixture({ without = null } = {}) {
  const nodes = Object.fromEntries(nodeNames.map(name => [name, node()]));
  const counters = { requests: 0, warnings: 0, external: 0 };
  const buttonStates = [];
  let disabled = false;
  let respond = () => { throw new Error('synthetic diagnostic read unavailable'); };
  const refreshButton = {
    get disabled() { return disabled; },
    set disabled(value) { disabled = value; buttonStates.push(value); },
  };
  const denyExternal = () => {
    counters.external += 1;
    throw new Error('synthetic fixture forbids external execution');
  };
  const context = {
    ...nodes,
    ...(without ? { [without]: null } : {}),
    objectStorageRefreshButton: refreshButton,
    beginBackstageSectionRead(section, loader) {
      assert.equal(section, 'overview');
      assert.equal(loader, 'object-storage');
      return { isCurrent: () => true };
    },
    adminApiPath(path) {
      assert.equal(path, PATH);
      return '/admin/api/v1' + path;
    },
    async backstageFetch(path, options) {
      assert.equal(path, '/admin/api/v1' + PATH);
      assert.equal(options.auth, true);
      if (options.isCurrent !== undefined) assert.equal(options.isCurrent(), true);
      counters.requests += 1;
      return respond();
    },
    console: { warn() { counters.warnings += 1; } },
    fetch: denyExternal, XMLHttpRequest: denyExternal, WebSocket: denyExternal,
    apiFetch: denyExternal, require: denyExternal,
  };
  const functions = runInNewContext(actualSource, context, {
    timeout: 1000, filename: 'actual-backstage-storage-diagnostics-functions.js',
  });
  return {
    ...functions, nodes, counters, buttonStates, refreshButton,
    respondWith(callback) { respond = callback; },
  };
}

function diagnostic({ configured = true, counts = [0, 0, 0, 0] } = {}) {
  return {
    reason: 'Synthetic diagnostic response',
    environment: {
      storageProvider: 'r2', directUploadMode: configured ? 's3_compatible_presigned_put' : 'metadata_only',
      endpointConfigured: true, bucketConfigured: configured,
      publicBaseUrlConfigured: configured, accessKeyConfigured: configured,
      secretKeyConfigured: configured,
    },
    recentUserImageUploads24h: {
      total: counts[0], pendingUpload: counts[1],
      uploaded: counts[2], failedOrUnconfirmed: counts[3],
    },
    warnings: [], nextActions: [], policy: { secretsReturned: false },
  };
}

function assertUnknown(view) {
  const nodes = view.nodes;
  assert.equal((nodes.objectStorageUploadStats.innerHTML.match(/<dd>/g) || []).length, 4);
  assert.equal(
    (nodes.objectStorageUploadStats.innerHTML.match(/<dd>\uD655\uC778 \uBD88\uAC00<\/dd>/g) || []).length,
    4, 'failed read must not invent zero upload counts',
  );
  assert.equal(
    (nodes.objectStorageDiagnosticGrid.innerHTML.match(/<strong>\uD655\uC778 \uBD88\uAC00<\/strong>/g) || []).length,
    4, 'failed read must not invent missing or disabled configuration',
  );
  assert.doesNotMatch(nodes.objectStorageDiagnosticGrid.innerHTML, /missing|disabled|configured/);
  assert.equal(nodes.objectStoragePolicy.textContent, '\uBBFC\uAC10 \uAC12 \uBC18\uD658 \uC815\uCC45: ' + UNKNOWN);
  assert.equal(nodes.objectStorageReason.classList.contains('is-ready'), false);
  assert.equal(nodes.objectStorageReason.classList.contains('is-warning'), true);
  assert.match(nodes.objectStorageActions.innerHTML, /\uC9C4\uB2E8 API \uC751\uB2F5/);
  assert.equal(view.counters.external, 0);
}

test('[baseline-fallback] first failed read stays unknown instead of zero, missing and safe', () => {
  const view = fixture();
  view.renderObjectStorageDiagnosticsFallback();
  assertUnknown(view);
  assert.equal(view.counters.requests, 0);
});

test('[baseline-fallback] failed read replaces prior confirmed state without fabricated values', () => {
  const view = fixture();
  view.renderObjectStorageDiagnostics(diagnostic({ counts: [7, 3, 2, 2] }));
  assert.equal(view.nodes.objectStorageReason.classList.contains('is-ready'), true);
  view.renderObjectStorageDiagnosticsFallback();
  assertUnknown(view);
  assert.doesNotMatch(view.nodes.objectStorageUploadStats.innerHTML, /<dd>[0-9]+<\/dd>/);
});

test('actual normal renderer retains explicit zero counts and false configuration flags', () => {
  const view = fixture();
  view.renderObjectStorageDiagnostics(diagnostic({ configured: false }));
  assert.equal((view.nodes.objectStorageUploadStats.innerHTML.match(/<dd>0<\/dd>/g) || []).length, 4);
  assert.match(view.nodes.objectStorageDiagnosticGrid.innerHTML, /<strong>metadata-only<\/strong>/);
  assert.match(view.nodes.objectStorageDiagnosticGrid.innerHTML, /<strong>missing<\/strong>/);
  assert.match(view.nodes.objectStoragePolicy.textContent, /\uC548\uC804/);
  assert.equal(view.counters.requests, 0);
});

test('actual normal renderer retains positive counts and configured ready state', () => {
  const view = fixture();
  view.renderObjectStorageDiagnostics(diagnostic({ counts: [8, 1, 6, 1] }));
  assert.equal(view.nodes.objectStorageReason.classList.contains('is-ready'), true);
  assert.equal(view.nodes.objectStorageReason.classList.contains('is-warning'), false);
  assert.match(view.nodes.objectStorageDiagnosticGrid.innerHTML, /<strong>configured<\/strong>/);
  assert.deepEqual(
    [...view.nodes.objectStorageUploadStats.innerHTML.matchAll(/<dd>([0-9]+)<\/dd>/g)].map(match => match[1]),
    ['8', '1', '6', '1'],
  );
});

test('actual loader failed read renders unknown and restores the refresh button in finally', async () => {
  const view = fixture();
  await view.loadObjectStorageDiagnostics();
  assertUnknown(view);
  assert.equal(view.counters.requests, 1);
  assert.equal(view.counters.warnings, 1);
  assert.deepEqual(view.buttonStates, [true, false]);
  assert.equal(view.refreshButton.disabled, false);
});

test('explicit retry after failure restores actual normal zero counts without automatic requests', async () => {
  const view = fixture();
  await view.loadObjectStorageDiagnostics();
  assertUnknown(view);
  assert.equal(view.counters.requests, 1);
  view.respondWith(() => diagnostic());
  await view.loadObjectStorageDiagnostics();
  assert.equal(view.counters.requests, 2);
  assert.equal((view.nodes.objectStorageUploadStats.innerHTML.match(/<dd>0<\/dd>/g) || []).length, 4);
  assert.equal(view.nodes.objectStorageReason.classList.contains('is-ready'), true);
  assert.match(view.nodes.objectStoragePolicy.textContent, /\uC548\uC804/);
  assert.deepEqual(view.buttonStates, [true, false, true, false]);
  assert.equal(view.counters.external, 0);
});

test('actual loader keeps refresh disabled while its synthetic request remains pending', async () => {
  const view = fixture();
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  view.respondWith(() => pending);
  const task = view.loadObjectStorageDiagnostics();
  assert.equal(view.counters.requests, 1);
  assert.equal(view.refreshButton.disabled, true);
  assert.deepEqual(view.buttonStates, [true]);
  resolve(diagnostic());
  await task;
  assert.equal(view.refreshButton.disabled, false);
  assert.deepEqual(view.buttonStates, [true, false]);
});

test('fallback with any absent display dependency preserves the existing all-or-nothing DOM boundary', () => {
  for (const without of nodeNames) {
    const view = fixture({ without });
    view.nodes.objectStorageReason.classList.add('is-ready');
    view.nodes.objectStoragePolicy.textContent = 'synthetic prior state';
    const before = JSON.stringify(Object.fromEntries(nodeNames.map(name => [
      name, [view.nodes[name].innerHTML, view.nodes[name].textContent],
    ])));
    view.renderObjectStorageDiagnosticsFallback();
    assert.equal(
      JSON.stringify(Object.fromEntries(nodeNames.map(name => [
        name, [view.nodes[name].innerHTML, view.nodes[name].textContent],
      ]))),
      before,
    );
    assert.equal(view.nodes.objectStorageReason.classList.contains('is-ready'), true);
    assert.equal(view.counters.requests, 0);
    assert.equal(view.counters.external, 0);
  }
});

test('actual loader success followed by failure removes stale ready and safe display', async () => {
  const view = fixture();
  view.respondWith(() => diagnostic({ counts: [4, 1, 2, 1] }));
  await view.loadObjectStorageDiagnostics();
  assert.equal(view.nodes.objectStorageReason.classList.contains('is-ready'), true);
  view.respondWith(() => { throw new Error('synthetic unavailable'); });
  await view.loadObjectStorageDiagnostics();
  assertUnknown(view);
  assert.equal(view.counters.requests, 2);
  assert.equal(view.counters.warnings, 1);
  assert.deepEqual(view.buttonStates, [true, false, true, false]);
});
