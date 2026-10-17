'use strict';

// Portable CI admission; the four B2B5 actual-source prefix fixtures/oracles are unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vm = require('node:vm');
const { test } = require('node:test');

const variant = 'candidate';
const APP = {
  size: 430404,
  sha256: '5f5b2bd6e568a80d14bbf7c522a0b7e038dc3d116471bfc2bed92cb2c8ad8028',
  blob: '4e9e2f1861574d25bf6b7bfd9d61a1bd9966adb3'
};
const PARSER = { size: 9112572,
  sha256: '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675' };
const norm = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
assert.equal(process.argv.length, 2, 'INPUT_FILENAME_ONLY');
assert.equal(typeof process.argv[1], 'string', 'INPUT_FILENAME_REQUIRED');
assert.equal(norm(process.argv[1]), norm(__filename), 'INPUT_EXACT_TEST_FILENAME');
assert.equal(norm(fs.realpathSync.native(__filename)), norm(__filename), 'INPUT_TEST_REALPATH');

function pinned(file, pin, canonicalSource = false) {
  assert.equal(path.isAbsolute(file), true, 'INPUT_ABSOLUTE');
  const real = fs.realpathSync.native(file);
  assert.equal(norm(real), norm(file), 'INPUT_EXACT_REALPATH');
  const stat = fs.statSync(real);
  assert.equal(stat.isFile() && stat.size > 0 && stat.size <= pin.size * (canonicalSource ? 2 : 1),
    true, 'INPUT_BOUNDED_REGULAR_SIZE');
  const raw = fs.readFileSync(real);
  assert.equal(raw.length, stat.size, 'INPUT_READ_SIZE');
  let bytes = raw;
  if (canonicalSource) {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    assert.equal(text.startsWith('\uFEFF'), false, 'INPUT_NO_BOM');
    assert.equal(Buffer.from(text, 'utf8').equals(raw), true, 'INPUT_RAW_UTF8_ROUNDTRIP');
    const withoutPairs = text.replace(/\r\n/g, '');
    assert.equal(withoutPairs.includes('\r'), false, 'INPUT_NO_BARE_CR');
    assert.equal(text.includes('\r\n') && withoutPairs.includes('\n'), false, 'INPUT_UNIFORM_EOL');
    bytes = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
  }
  assert.equal(bytes.length, pin.size, 'INPUT_EXACT_CANONICAL_SIZE');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, 'INPUT_EXACT_SHA256');
  return { real, bytes };
}

const admittedApp = pinned(path.resolve(__dirname, '../app.js'), APP, true);
assert.equal(createHash('sha1').update('blob ' + admittedApp.bytes.length + '\0').update(admittedApp.bytes).digest('hex'),
  APP.blob, 'INPUT_EXACT_GIT_BLOB');
const app = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(admittedApp.bytes);
const parser = pinned(path.resolve(__dirname, '../server/node_modules/typescript/lib/typescript.js'), PARSER);
const ts = require(parser.real);
const parsed = ts.createSourceFile('actual-app.js', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(parsed.parseDiagnostics.length, 0, 'ACTUAL_SOURCE_SYNTAX');
const names = ['init', 'initI18n', 'syncLateNavigationUI'];
const declarations = new Map(names.map(name => [name, []]));
function visit(node) {
  if (ts.isFunctionDeclaration(node) && declarations.has(node.name?.text)) declarations.get(node.name.text).push(node);
  ts.forEachChild(node, visit);
}
visit(parsed);
for (const name of names) assert.equal(declarations.get(name).length, 1, 'UNIQUE_ACTUAL_FUNCTION:' + name);
const init = declarations.get('init')[0];
const publicBoundary = init.body.statements.flatMap(statement => ts.isVariableStatement(statement)
  ? [...statement.declarationList.declarations] : []).filter(declaration => {
  const value = declaration.initializer;
  return declaration.name.getText(parsed) === 'apiArtists' && value && ts.isAwaitExpression(value)
    && ts.isCallExpression(value.expression) && value.expression.expression.getText(parsed) === 'apiFetch'
    && value.expression.arguments.length === 1 && ts.isStringLiteral(value.expression.arguments[0])
    && value.expression.arguments[0].text === '/api/v1/artists';
});
assert.equal(publicBoundary.length, 1, 'ACTUAL_PUBLIC_ARTISTS_AWAIT');
const selected = names.map(name => {
  const node = declarations.get(name)[0];
  assert.equal(node.parent === parsed, true, 'TOP_LEVEL_ACTUAL_FUNCTION');
  return app.slice(node.getStart(parsed), node.end);
}).join('\n');
const emitted = ts.transpileModule(selected, { reportDiagnostics: true, compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, newLine: ts.NewLineKind.LineFeed
} });
assert.equal((emitted.diagnostics || []).filter(value => value.category === ts.DiagnosticCategory.Error).length, 0,
  'SELECTED_DECLARATIONS_SYNTAX');
const actual = new vm.Script(emitted.outputText + '\n' +
  'globalThis.__bootstrapQA = { init, initI18n, syncLateNavigationUI };', { filename: 'actual-bootstrap-functions.js' });
const LOCAL = 'en-US', SERVER = 'ja-JP', LOCALE_KEY = 'synthetic-locale-preference';
const flush = async () => { for (let i = 0; i < 32; ++i) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ pathname = '/', hash = '#login', search = '', loggedIn = true,
  holdSettings = false, missingLocation = false } = {}) {
  const effects = { fixtureFaults: 0, settings: 0, wallet: 0, publicCalls: 0, preferenceWrites: 0,
    authWrites: 0, authRemoves: 0, refresh: 0, nativeFetch: 0, timers: 0, events: [], modals: [] };
  const settings = deferred(), boundary = deferred(), stop = Object.freeze({ owned: 'public-artists-prefix-stop' });
  const settingsValue = { settings: { locale: SERVER } };
  let run = null;
  const checked = callback => (...args) => {
    try { return callback(...args); } catch (error) { effects.fixtureFaults++; throw error; }
  };
  const forbidden = label => checked(() => { throw new Error('FORBIDDEN_FIXTURE_OPERATION:' + label); });
  const record = label => checked(() => { effects.events.push(label); });
  const body = { classList: { contains: checked(value => { assert.equal(value, 'page-creator-studio'); return false; }) } };
  const document = { body, documentElement: { lang: 'ko-KR' } };
  const location = { pathname, hash, search };
  const window = { luminaI18n: { apply: checked(value => { assert.equal(value, body); effects.events.push('late-translate'); }) },
    history: { replaceState: checked((state, title, url) => {
      assert.equal(state, null); assert.equal(title, ''); assert.equal(url, location.pathname + location.search);
      effects.events.push('consume-fragment'); location.hash = '';
    }) } };
  if (!missingLocation) window.location = location;
  const context = vm.createContext({ window, document, _currentLocale: 'ko-KR',
    I18N_LOCALES: Object.freeze([LOCAL, SERVER]), I18N_STORAGE_KEY: LOCALE_KEY,
    detectLocale: checked(() => { effects.events.push('detect'); return LOCAL; }),
    normalizeLocale: checked(value => { assert.equal(value, SERVER); return value; }),
    applyI18n: record('apply'), isLoggedIn: checked(() => loggedIn),
    localStorage: { getItem: forbidden('storage-read'),
      setItem: checked((key, value) => {
        if (key !== LOCALE_KEY) { effects.authWrites++; throw new Error('AUTH_WRITE'); }
        assert.equal(value, SERVER); effects.preferenceWrites++;
      }), removeItem: checked(() => { effects.authRemoves++; throw new Error('AUTH_REMOVE'); }) },
    setAuth: checked(() => { effects.authWrites++; throw new Error('SET_AUTH'); }),
    clearAuth: checked(() => { effects.authRemoves++; throw new Error('CLEAR_AUTH'); }),
    refreshAuthOnce: checked(() => { effects.refresh++; throw new Error('REFRESH'); }),
    fetch: checked(() => { effects.nativeFetch++; throw new Error('NATIVE_FETCH'); }),
    setTimeout: checked(() => { effects.timers++; throw new Error('TIMER'); }), setInterval: forbidden('interval'),
    loadWallet: checked(() => { effects.wallet++; effects.events.push('wallet'); }),
    openAuthModal: checked(tab => { assert(['login', 'forgot'].includes(tab)); effects.modals.push(tab); }),
    apiFetch: checked((route, options) => {
      if (route === '/api/v1/me/settings') {
        assert(options && options.auth === true); assert.equal(Object.keys(options).join(','), 'auth');
        effects.settings++; effects.events.push('settings');
        return holdSettings ? settings.promise : Promise.resolve(settingsValue);
      }
      assert.equal(route, '/api/v1/artists', 'ONLY_OWNED_PUBLIC_BOUNDARY');
      assert.equal(options, undefined); assert.equal(effects.publicCalls, 0);
      effects.publicCalls++; effects.events.push('public-boundary'); return boundary.promise;
    })
  });
  for (const name of ['normalizePublicDiscoveryNavigation', 'createAuthModal', 'bindAuthHeaderEvents', 'updateAuthUI',
    'activateCurrentNavItem', 'bindContentProtection', 'bindShareButtons', 'initMypagePage', 'captureReferralFromURL',
    'openAuthBridgeFixtureIfNeeded']) context[name] = record(name);
  context.handleKakaoCallback = checked(async () => { effects.events.push('kakao'); });
  context.handleNaverCallback = checked(async () => { effects.events.push('naver'); });
  actual.runInContext(context, { timeout: 2000 });
  const api = context.__bootstrapQA;
  assert.equal(Object.keys(api).join(','), 'init,initI18n,syncLateNavigationUI');
  function start() {
    assert.equal(run, null);
    run = { done: false, observed: null };
    run.observed = api.init().then(value => { run.done = true; return { kind: 'fulfilled', value }; },
      error => { run.done = true; return { kind: 'rejected', error }; });
  }
  function cleanEffects() {
    assert.equal(effects.fixtureFaults, 0, 'STICKY_FIXTURE_FAULT');
    for (const key of ['authWrites', 'authRemoves', 'refresh', 'nativeFetch', 'timers']) assert.equal(effects[key], 0, key);
    for (const name of ['detect', 'apply']) assert.equal(effects.events.filter(value => value === name).length, 1, name);
    assert.equal(document.documentElement.lang, context._currentLocale);
  }
  async function endPrefix() {
    assert(run); settings.resolve(settingsValue); await flush();
    assert.equal(effects.publicCalls, 1, 'WHOLE_INIT_REACHED_OWNED_PUBLIC_AWAIT');
    assert.equal(run.done, false, 'OWNED_PUBLIC_AWAIT_REMAINS_PENDING');
    assert.deepEqual(effects.events.slice(-3), ['kakao', 'naver', 'public-boundary']);
    const ui = ['normalizePublicDiscoveryNavigation', 'createAuthModal', 'bindAuthHeaderEvents', 'updateAuthUI',
      'activateCurrentNavItem', 'bindContentProtection', 'bindShareButtons'];
    assert.deepEqual(effects.events.slice(effects.events.indexOf(ui[0]), effects.events.indexOf(ui[0]) + ui.length), ui);
    for (const name of ['normalizePublicDiscoveryNavigation', 'createAuthModal', 'bindAuthHeaderEvents',
      'bindContentProtection', 'bindShareButtons', 'initMypagePage', 'captureReferralFromURL']) {
      assert.equal(effects.events.filter(value => value === name).length, 1, 'ACTUAL_PREFIX_CALLED:' + name);
    }
    boundary.reject(stop);
    const outcome = await run.observed;
    assert.equal(outcome.kind, 'rejected'); assert.equal(outcome.error, stop, 'EXACT_OWNED_PUBLIC_SENTINEL');
    cleanEffects();
  }
  async function cleanup() {
    settings.resolve(settingsValue); await flush();
    if (effects.publicCalls) { boundary.reject(stop); if (run) await run.observed; }
  }
  return { effects, api, location, document, start, endPrefix, cleanEffects, cleanup,
    locale: () => context._currentLocale };
}

async function use(group, options, callback) {
  const f = fixture(options);
  try { return await callback(f); }
  finally { try { await f.cleanup(); } finally { group.fixtureFaults += f.effects.fixtureFaults; } }
}
function group(name, label, callback) {
  test(name, async t => {
    const state = { fixtureFaults: 0, witness: false };
    try { await callback(state); }
    finally { t.diagnostic(JSON.stringify({ contract: 'explicit-login-bootstrap-v1', variant, case: label,
      semanticOriginalWitness: state.witness, fixtureFaults: state.fixtureFaults })); }
  });
}
function bootstrapWitness(f) {
  assert.equal(f.effects.settings, variant === 'original' ? 1 : 0, 'ADMITTED_SETTINGS_EFFECTS');
  assert.equal(f.effects.wallet, variant === 'original' ? 1 : 0, 'ADMITTED_WALLET_EFFECTS');
  assert.equal(f.effects.preferenceWrites, variant === 'original' ? 1 : 0);
  assert.equal(f.locale(), variant === 'original' ? SERVER : LOCAL);
  assert.equal(f.document.documentElement.lang, f.locale());
  f.cleanEffects();
}

group('explicit root login bootstrap skips authenticated settings and initial wallet', 'explicit-root', async state => {
  await use(state, {}, async f => {
    f.start(); await f.endPrefix(); bootstrapWitness(f);
    assert.deepEqual(f.effects.modals, [], 'BOOTSTRAP_IS_NOT_HUMAN_LOGIN');
    state.witness = variant === 'original';
    assert.equal(f.effects.settings === 0 && f.effects.wallet === 0, true,
      'EXPLICIT_LOGIN_BOOTSTRAP_AUTH_READS_SUPPRESSED');
  });
});
group('fragment consumption during the first await preserves the explicit login decision', 'consumed-fragment', async state => {
  await use(state, { holdSettings: true }, async f => {
    f.start(); assert.equal(f.effects.wallet, 0); assert.equal(f.effects.publicCalls, 0);
    f.api.syncLateNavigationUI();
    assert.equal(f.location.hash, ''); assert.deepEqual(f.effects.modals, ['login']);
    assert.equal(f.effects.events.filter(value => value === 'consume-fragment').length, 1);
    await f.endPrefix(); bootstrapWitness(f);
    state.witness = variant === 'original';
    assert.equal(f.effects.settings === 0 && f.effects.wallet === 0, true,
      'EXPLICIT_LOGIN_BOOTSTRAP_CAPTURE_SURVIVES_FRAGMENT');
  });
});
group('ordinary root and nonmatching entry locations preserve authenticated bootstrap', 'ordinary-bootstrap', async state => {
  for (const options of [{ hash: '' }, { hash: '#forgot' }, { hash: '#LOGIN' }, { hash: '#login-extra' },
    { pathname: '/other/', hash: '#login' }, { pathname: '/index.html', hash: '#login' },
    { hash: '', search: '?login=1' }, { missingLocation: true }, { hash: '', loggedIn: false }]) {
    await use(state, options, async f => {
      f.start(); f.api.syncLateNavigationUI(); await f.endPrefix();
      const authenticated = options.loggedIn !== false;
      assert.equal(f.effects.settings, authenticated ? 1 : 0); assert.equal(f.effects.wallet, authenticated ? 1 : 0);
      assert.equal(f.effects.preferenceWrites, authenticated ? 1 : 0); assert.equal(f.locale(), authenticated ? SERVER : LOCAL);
      assert.deepEqual(f.effects.modals, options.hash === '#forgot' ? ['forgot'] : []);
    });
  }
});
group('default i18n sync and explicit local-only initialization preserve their contracts', 'i18n-contract', async state => {
  for (const explicitTrue of [false, true]) await use(state, {}, async f => {
    if (explicitTrue) await f.api.initI18n(true); else await f.api.initI18n();
    f.cleanEffects(); assert.equal(f.effects.settings, 1); assert.equal(f.effects.preferenceWrites, 1);
    assert.equal(f.locale(), SERVER); assert.equal(f.document.documentElement.lang, SERVER);
    assert.equal(f.effects.wallet, 0); assert.equal(f.effects.publicCalls, 0);
  });
  await use(state, { loggedIn: false }, async f => {
    await f.api.initI18n(); f.cleanEffects(); assert.equal(f.effects.settings, 0);
    assert.equal(f.effects.preferenceWrites, 0); assert.equal(f.locale(), LOCAL);
  });
  await use(state, {}, async f => {
    await f.api.initI18n(false); f.cleanEffects();
    assert.equal(f.effects.settings, variant === 'original' ? 1 : 0);
    assert.equal(f.effects.preferenceWrites, variant === 'original' ? 1 : 0);
    assert.equal(f.locale(), variant === 'original' ? SERVER : LOCAL);
    assert.equal(f.document.documentElement.lang, f.locale());
    assert.equal(f.effects.wallet, 0); assert.equal(f.effects.publicCalls, 0);
    state.witness = variant === 'original';
    assert.equal(f.effects.settings === 0 && f.effects.preferenceWrites === 0 && f.locale() === LOCAL, true,
      'EXPLICIT_LOGIN_I18N_LOCAL_ONLY');
  });
});
