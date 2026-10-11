import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// Only extracted production functions run against synthetic DOM and RAM reads.
const sourceFile = process.env.BACKSTAGE_STORAGE_MODE_SOURCE_FILE ||
  process.env.BACKSTAGE_STORAGE_DIAGNOSTICS_SOURCE_FILE ||
  new URL('../backstage.js', import.meta.url);
const sourceBytes = await readFile(sourceFile);
const source = sourceBytes.toString('utf8');
export const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
export const caseCount = 10;
export const baselineCaseCount = 2;
const expectedPin = process.env.BACKSTAGE_STORAGE_MODE_SOURCE_SHA256 ??
  process.env.BACKSTAGE_STORAGE_DIAGNOSTICS_SOURCE_SHA256;
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

function fixture() {
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
    ...nodes, objectStorageRefreshButton: refreshButton,
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
      if (options.isCurrent !== undefined) {
        assert.equal(typeof options.isCurrent, 'function');
        assert.equal(options.isCurrent(), true);
      } else {
        // Frozen a632 loader uses auth-only; ROOT's shared hunk adds currentness.
        assert.deepEqual(Object.keys(options), ['auth']);
      }
      counters.requests += 1;
      return respond();
    },
    console: { warn() { counters.warnings += 1; } },
    fetch: denyExternal, XMLHttpRequest: denyExternal, WebSocket: denyExternal,
    apiFetch: denyExternal, require: denyExternal,
  };
  const functions = runInNewContext(actualSource, context, {
    timeout: 1000, filename: 'actual-backstage-storage-mode-functions.js',
  });
  return {
    ...functions, nodes, counters, buttonStates, refreshButton,
    respondWith(callback) { respond = callback; },
  };
}

function diagnostic(provider = 's3', environment = {}) {
  const direct = provider === 's3' || provider === 'r2';
  return {
    reason: provider === 'local' ? 'local_metadata_only' :
      direct ? 'direct_upload_ready' : 'unsupported_storage_provider',
    environment: {
      storageProvider: provider,
      directUploadMode: direct ? 's3_compatible_presigned_put' : 'metadata_only',
      bucketConfigured: true, endpointConfigured: true,
      publicBaseUrlConfigured: true, accessKeyConfigured: true,
      secretKeyConfigured: true, ...environment,
    },
    recentUserImageUploads24h: {
      total: 0, pendingUpload: 0, uploaded: 0, failedOrUnconfirmed: 0,
    },
    warnings: [], nextActions: [], policy: { secretsReturned: false },
  };
}

function renderUnchanged(view, data) {
  const before = JSON.stringify(data);
  view.renderObjectStorageDiagnostics(data);
  assert.equal(JSON.stringify(data), before, 'render must not mutate its response');
  assert.equal(view.counters.requests, 0);
  assert.equal(view.counters.external, 0);
}

function assertMode(view, label, ready) {
  assert.ok(view.nodes.objectStorageDiagnosticGrid.innerHTML.includes(
    '<span>Direct upload</span><strong>' + label + '</strong>',
  ), 'render the exact mode label');
  assert.equal(view.nodes.objectStorageReason.classList.contains('is-ready'), ready);
  assert.equal(view.nodes.objectStorageReason.classList.contains('is-warning'), !ready);
  if (!ready) {
    assert.doesNotMatch(view.nodes.objectStorageReason.textContent, /^direct upload ready:/);
  }
  assert.equal(view.counters.external, 0);
}

function assertZeroCounts(view) {
  assert.equal(
    (view.nodes.objectStorageUploadStats.innerHTML.match(/<dd>0<\/dd>/g) || []).length,
    4, 'explicit successful zero counts stay zero',
  );
}

function assertUnknownFallback(view) {
  assert.equal(
    view.nodes.objectStorageDiagnosticGrid.innerHTML.split('<strong>' + UNKNOWN + '</strong>').length - 1,
    4,
  );
  assert.equal(
    view.nodes.objectStorageUploadStats.innerHTML.split('<dd>' + UNKNOWN + '</dd>').length - 1,
    4,
  );
  assert.doesNotMatch(view.nodes.objectStorageDiagnosticGrid.innerHTML, /enabled|disabled|metadata-only|configured|missing/);
  assert.doesNotMatch(view.nodes.objectStorageUploadStats.innerHTML, /<dd>[0-9]+<\/dd>/);
  assert.equal(view.nodes.objectStoragePolicy.textContent,
    '\uBBFC\uAC10 \uAC12 \uBC18\uD658 \uC815\uCC45: ' + UNKNOWN);
  assert.equal(view.nodes.objectStorageReason.classList.contains('is-ready'), false);
  assert.equal(view.nodes.objectStorageReason.classList.contains('is-warning'), true);
  assert.equal(view.counters.external, 0);
}

test('[baseline-mode] local metadata_only never means enabled or ready even with all flags configured', () => {
  const view = fixture();
  renderUnchanged(view, diagnostic('local'));
  assertMode(view, 'metadata-only', false);
  assert.match(view.nodes.objectStorageReason.textContent, /^metadata-only: local_metadata_only$/);
  assertZeroCounts(view);
});

test('metadata_only keeps explicit false configuration and legitimate zero counts', () => {
  const view = fixture();
  renderUnchanged(view, diagnostic('local', {
    bucketConfigured: false, endpointConfigured: false, publicBaseUrlConfigured: false,
    accessKeyConfigured: false, secretKeyConfigured: false,
  }));
  assertMode(view, 'metadata-only', false);
  assert.match(view.nodes.objectStorageReason.textContent, /^public URL missing:/);
  assert.match(view.nodes.objectStorageDiagnosticGrid.innerHTML, /<strong>missing<\/strong>/);
  assert.match(view.nodes.objectStoragePolicy.textContent, /\uC548\uC804/);
  assertZeroCounts(view);
});

test('exact s3 mode is enabled and ready without requiring an R2 endpoint', () => {
  const view = fixture();
  renderUnchanged(view, diagnostic('s3', { endpointConfigured: false }));
  assertMode(view, 'enabled', true);
  assert.match(view.nodes.objectStorageReason.textContent, /^direct upload ready:/);
  assertZeroCounts(view);
});

test('exact r2 mode is enabled and ready with its endpoint configured', () => {
  const view = fixture();
  renderUnchanged(view, diagnostic('r2'));
  assertMode(view, 'enabled', true);
  assert.match(view.nodes.objectStorageReason.textContent, /^direct upload ready:/);
  assertZeroCounts(view);
});

test('the direct mode string cannot enable local, missing or unsupported providers', () => {
  for (const provider of ['local', undefined, null, '', 'other', 'S3', 'r2 ']) {
    const view = fixture();
    renderUnchanged(view, diagnostic('s3', { storageProvider: provider }));
    assertMode(view, 'unknown', false);
    assert.match(view.nodes.objectStorageReason.textContent, /^direct upload mode unknown:/);
  }
});

test('[baseline-mode] missing, unsupported and legacy boolean modes are unknown rather than enabled or disabled', () => {
  // Previous boolean fixtures do not match the service's string mode contract.
  for (const mode of [undefined, null, '', 'other', 'metadata_only ', 'S3_COMPATIBLE_PRESIGNED_PUT', true, false, 1, {}, []]) {
    const view = fixture();
    renderUnchanged(view, diagnostic('s3', { directUploadMode: mode }));
    assertMode(view, 'unknown', false);
    assert.match(view.nodes.objectStorageReason.textContent, /^direct upload mode unknown:/);
    assert.doesNotMatch(view.nodes.objectStorageDiagnosticGrid.innerHTML, /<strong>disabled<\/strong>/);
  }
});

test('every existing required configuration flag still prevents a ready signal when false', () => {
  for (const key of ['bucketConfigured', 'publicBaseUrlConfigured', 'accessKeyConfigured', 'secretKeyConfigured']) {
    const view = fixture();
    renderUnchanged(view, diagnostic('s3', { [key]: false }));
    assertMode(view, 'enabled', false);
    assert.match(view.nodes.objectStorageReason.textContent,
      key === 'publicBaseUrlConfigured' ? /^public URL missing:/ : /^direct upload env incomplete:/);
  }
});

test('R2 endpoint strictness and existing endpoint warning precedence are preserved', () => {
  for (const endpoint of [false, null, undefined]) {
    const view = fixture();
    renderUnchanged(view, diagnostic('r2', { endpointConfigured: endpoint }));
    assertMode(view, 'enabled', false);
    assert.match(view.nodes.objectStorageReason.textContent,
      endpoint === false ? /^R2 endpoint missing:/ : /^direct upload env incomplete:/);
  }
  const view = fixture();
  const data = diagnostic('s3');
  data.reason = 'r2_endpoint_missing';
  renderUnchanged(view, data);
  assertMode(view, 'enabled', false);
  assert.match(view.nodes.objectStorageReason.textContent, /^R2 endpoint missing:/);
});

test('a failure fallback replaces a prior valid ready result with unknown values', () => {
  const view = fixture();
  renderUnchanged(view, diagnostic('r2'));
  assertMode(view, 'enabled', true);
  view.renderObjectStorageDiagnosticsFallback();
  assertUnknownFallback(view);
  assert.equal(view.counters.requests, 0);
});

test('the actual loader preserves auth-read and finally behavior through failure, explicit retry and later failure', async () => {
  const view = fixture();
  await view.loadObjectStorageDiagnostics();
  assertUnknownFallback(view);
  assert.equal(view.counters.requests, 1);
  assert.equal(view.counters.warnings, 1);
  assert.deepEqual(view.buttonStates, [true, false]);
  view.respondWith(() => diagnostic('r2'));
  await view.loadObjectStorageDiagnostics();
  assertMode(view, 'enabled', true);
  assertZeroCounts(view);
  assert.equal(view.counters.requests, 2);
  view.respondWith(() => { throw new Error('synthetic retry unavailable'); });
  await view.loadObjectStorageDiagnostics();
  assertUnknownFallback(view);
  assert.equal(view.counters.requests, 3);
  assert.equal(view.counters.warnings, 2);
  assert.deepEqual(view.buttonStates, [true, false, true, false, true, false]);
  assert.equal(view.refreshButton.disabled, false);
});
