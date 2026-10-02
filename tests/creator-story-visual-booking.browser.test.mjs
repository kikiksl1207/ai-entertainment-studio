import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Main must explicitly opt in. Importing this file does not load or launch a browser.
const enabled = process.env.CREATOR_VISUAL_BOOKING_BROWSER_QA === '1';
const smoke = process.env.CREATOR_VISUAL_BOOKING_BROWSER_SMOKE === '1';
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = 'E:/Codex/LuminaStage/qa-artifacts/20261001-creator-visual-booking';
const evidencePath = join(artifacts, smoke ? 'creator-booking-smoke-evidence.json' : 'creator-booking-evidence.json');
const progressPath = join(artifacts, smoke ? 'creator-booking-smoke-progress.log' : 'creator-booking-progress.log');
const tracePath = join(artifacts, smoke ? 'creator-booking-smoke-trace.zip' : 'creator-booking-trace.zip');
const temp = 'E:/Codex/LuminaStage/qa-tmp/20261001-creator-visual-booking';
const browsers = 'E:/Codex/LuminaStage/qa-browsers';
const playwrightBundle = 'C:/Users/kim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const origin = 'http://creator-booking-fixture.invalid';
const entryPath = '/creator-studio/';
const scriptPath = '/pages/creator-story-visual-booking.js';
const cssPath = '/pages/creator-story-visual-booking.css';
const catalogPath = '/api/v1/me/creator-studio/stories';
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const widths = [390, 400, 1280];
const workId = '10000000-0000-4000-8000-000000000001';
const secondWorkId = '10000000-0000-4000-8000-000000000002';
const privateWorkId = '10000000-0000-4000-8000-000000000003';
const releaseId = '20000000-0000-4000-8000-000000000001';
const secondReleaseId = '20000000-0000-4000-8000-000000000002';
const generationId = '30000000-0000-4000-8000-000000000001';
const secondGenerationId = '30000000-0000-4000-8000-000000000002';
const catalogCursor = '40000000-0000-4000-8000-000000000001';
const longScene = `scene-${'very-long-scene-key-'.repeat(9)}`.slice(0, 160);
const checksum = 'e'.repeat(64);
const privateDiagnostic = 'FIXTURE_PRIVATE_DIAGNOSTIC_MUST_NOT_DISPLAY';
const baseItem = {
  generationId, sourceSceneKey: longScene, status: 'failed', attemptCount: 0,
  reason: 'changed', canReprepare: true, reviewSha256: 'a'.repeat(64),
  currentBookingIdentitySha256: 'b'.repeat(64), bookedIdentitySha256: 'c'.repeat(64),
  promptSha256: 'd'.repeat(64), promptText: privateDiagnostic, providerRequest: privateDiagnostic,
};
const baseReview = { workId, releaseId, releaseChecksum: checksum, eligible: true,
  items: [baseItem], nextAfterId: null };
const titles = {
  ko: '\uC608\uC57D \uAE30\uC900 \uAC80\uD1A0 \uC791\uD488',
  en: 'Booking review title', ja: '\u4E88\u7D04\u57FA\u6E96\u306E\u78BA\u8A8D\u4F5C\u54C1',
  'zh-Hans': '\u9884\u7EA6\u57FA\u51C6\u5BA1\u6838\u4F5C\u54C1',
  'zh-Hant': '\u9810\u7D04\u57FA\u6E96\u5BE9\u6838\u4F5C\u54C1',
};
const doneMessages = {
  ko: '\uC608\uC57D\uC744 \uC7AC\uC900\uBE44\uD588\uC2B5\uB2C8\uB2E4.',
  en: 'Booking reprepared.', ja: '\u4E88\u7D04\u3092\u518D\u6E96\u5099\u3057\u307E\u3057\u305F\u3002',
  'zh-Hans': '\u9884\u7EA6\u5DF2\u91CD\u65B0\u51C6\u5907\u3002',
  'zh-Hant': '\u9810\u7D04\u5DF2\u91CD\u65B0\u6E96\u5099\u3002',
};
const catalog = [
  { workId, slug: `published-${'long-work-slug-'.repeat(12)}`, title: { value: titles.ko },
    publication: { status: 'published', published: true, activeReleaseId: releaseId } },
  { workId: secondWorkId, slug: 'second-work', title: { value: 'Second synthetic work' },
    publication: { status: 'published', published: true, activeReleaseId: secondReleaseId } },
  { workId: privateWorkId, slug: 'private-work', title: { value: 'Private synthetic work' },
    publication: { status: 'private', published: false, activeReleaseId: null } },
];
const expectedPost = {
  generationId, releaseId, releaseChecksum: checksum, sourceSceneKey: longScene,
  promptSha256: baseItem.promptSha256, expectedReviewSha256: baseItem.reviewSha256,
  expectedCurrentBookingIdentitySha256: baseItem.currentBookingIdentitySha256, confirmedResume: true,
};

function bootstrap(config) {
  const qa = window.__creatorBookingQa = {
    ...config, ownerId: 'synthetic-writer-one', epoch: 1, calls: [], pending: [], forbidden: [],
    hold: null, failure: null, corrupt: null, receiptCorrupt: null, catalogPagination: false,
    catalogCycle: false, catalogCorrupt: null, bookingPagination: false, nextChecksum: null, sequence: 0,
  };
  const identity = () => ({ ownerId: qa.ownerId, epoch: qa.epoch });
  const isCurrent = value => Boolean(value?.ownerId && value.ownerId === qa.ownerId && value.epoch === qa.epoch);
  const response = (data, status) => ({ ok: status >= 200 && status < 300, status,
    json: async () => structuredClone(data) });
  const forbid = message => { qa.forbidden.push(message); throw new Error(message); };
  // All application API calls must use the mock, including errors and delayed responses.
  window.fetch = async () => forbid('Native fetch is forbidden in this fixture');
  window.LuminaCreatorStudioApi = {
    identity, isCurrent,
    fetch: async (url, options = {}) => {
      const address = new URL(url, location.href);
      const method = options.method || 'GET';
      const parts = address.pathname.split('/');
      let kind;
      if (address.origin !== location.origin) return forbid('External API origin');
      if (method === 'GET' && address.pathname === qa.catalogPath) kind = 'catalog';
      else if (method === 'GET' && address.pathname.startsWith(qa.catalogPath + '/') &&
        parts.length === 8 && parts[7] === 'visual-bookings') kind = 'review';
      else if (method === 'POST' && address.pathname.startsWith(qa.catalogPath + '/') &&
        parts.length === 9 && parts[7] === 'visual-bookings' && parts[8] === 'reprepare') kind = 'post';
      else return forbid('Unexpected API route or mutation: ' + method + ' ' + address.pathname);
      const call = {
        id: ++qa.sequence, url: address.pathname + address.search, method, kind,
        body: options.body ? structuredClone(options.body) : null,
        identity: options.identity ? structuredClone(options.identity) : null,
        retried: options._retried === true, completed: false,
      };
      qa.calls.push(call);
      if (!options.identity) return forbid('Every creator API request must bind ownerId/epoch');
      if (!isCurrent(options.identity)) {
        call.completed = true;
        throw new DOMException('Context changed', 'AbortError');
      }
      let data;
      let status = kind === 'post' ? 201 : 200;
      if (kind === 'catalog') {
        const locale = address.searchParams.get('locale');
        if (!qa.locales.includes(locale) || address.searchParams.get('limit') !== '30') {
          return forbid('Catalog requires a supported locale and limit=30');
        }
        const cursor = address.searchParams.get('cursor');
        if (cursor && cursor !== qa.catalogCursor) return forbid('Unknown catalog cursor');
        const items = structuredClone(qa.catalog);
        items[0].title.value = qa.titles[locale];
        data = { items: qa.catalogPagination ? (cursor ? items.slice(1) : items.slice(0, 1)) : items,
          nextCursor: qa.catalogPagination && (!cursor || qa.catalogCycle) ? qa.catalogCursor : null };
        if (qa.catalogCorrupt === 'title') delete data.items[0].title.value;
        if (qa.catalogCorrupt === 'release-missing') delete data.items[0].publication.activeReleaseId;
        if (qa.catalogCorrupt === 'release-invalid') data.items[0].publication.activeReleaseId = 'not-a-release';
        if (qa.catalogCorrupt === 'duplicate') data.items.push(structuredClone(data.items[0]));
        if (qa.catalogCorrupt === 'oversize') data.items = Array.from({ length: 31 }, () => structuredClone(data.items[0]));
        if (qa.catalogCorrupt === 'cursor-invalid') data.nextCursor = 'not-a-cursor';
      } else if (kind === 'review') {
        const targetId = parts[6];
        if (![qa.workId, qa.secondWorkId].includes(targetId)) return forbid('Private or unknown work was read');
        data = structuredClone(qa.review);
        if (targetId === qa.secondWorkId) {
          data.workId = qa.secondWorkId;
          data.releaseId = qa.secondReleaseId;
          data.items[0].generationId = qa.secondGenerationId;
          data.items[0].sourceSceneKey = 'second-work-scene';
        }
        if (qa.bookingPagination) {
          if (address.searchParams.has('afterId')) {
            if (address.searchParams.get('afterId') !== qa.generationId) return forbid('Unknown booking cursor');
            data.items = [{ ...data.items[0], generationId: qa.secondGenerationId, sourceSceneKey: 'scene-next' }];
            data.releaseChecksum = qa.nextChecksum || data.releaseChecksum;
            data.nextAfterId = null;
          } else data.nextAfterId = qa.generationId;
        }
        if (qa.corrupt === 'work') data.workId = qa.secondWorkId;
        if (qa.corrupt === 'release') data.releaseId = qa.secondReleaseId;
        if (qa.corrupt === 'checksum') data.releaseChecksum = 'not-a-checksum';
        if (qa.corrupt === 'uppercase-hash') data.items[0].reviewSha256 = 'A'.repeat(64);
        if (qa.corrupt === 'scene') data.items[0].sourceSceneKey = 's'.repeat(161);
        if (qa.corrupt === 'attempt') data.items[0].attemptCount = -1;
        if (qa.corrupt === 'duplicate') data.items.push(structuredClone(data.items[0]));
        if (qa.corrupt === 'inconsistent-gate') data.items[0].status = 'blocked';
        if (qa.corrupt === 'unsupported') { data.eligible = false; data.items = []; data.nextAfterId = null; }
      } else {
        if (parts[6] !== qa.workId) return forbid('Unexpected mutation target');
        const body = options.body;
        data = { workId: parts[6], releaseId: body.releaseId, releaseChecksum: body.releaseChecksum,
          generationId: body.generationId, sourceSceneKey: body.sourceSceneKey, status: 'pending',
          bookingIdentitySha256: body.expectedCurrentBookingIdentitySha256, generationStarted: false };
        if (qa.receiptCorrupt === 'work') data.workId = qa.secondWorkId;
        if (qa.receiptCorrupt === 'release') data.releaseId = qa.secondReleaseId;
        if (qa.receiptCorrupt === 'identity') data.bookingIdentitySha256 = 'f'.repeat(64);
        if (qa.receiptCorrupt === 'started') data.generationStarted = true;
      }
      if (qa.failure?.kind === kind) {
        status = qa.failure.status;
        data = { code: qa.privateDiagnostic, message: qa.privateDiagnostic,
          details: '<img src=x onerror="window.__privateExecuted=true">' };
      }
      // Capture before waiting, and ignore aborts deliberately to exercise stale-result rejection.
      const captured = structuredClone(data);
      if (qa.hold === kind) await new Promise(release => qa.pending.push({ id: call.id, kind, release }));
      call.completed = true;
      call.status = status;
      return response(captured, status);
    },
  };
  qa.setLocale = value => { document.documentElement.lang = value; };
  qa.switchOwner = ownerId => {
    qa.ownerId = ownerId; qa.epoch++;
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new Event('focus'));
  };
  qa.navigate = sectionId => {
    document.querySelectorAll('.studio-section').forEach(section => section.classList.toggle('is-active', section.id === sectionId));
    document.querySelectorAll('.studio-nav [data-section]').forEach(button => button.classList.toggle('is-active', button.dataset.section === sectionId));
  };
  qa.release = kind => {
    const pending = qa.pending.filter(item => item.kind === kind);
    qa.pending = qa.pending.filter(item => item.kind !== kind);
    pending.forEach(item => item.release());
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.remove('is-booting');
    document.getElementById('studioAccessGate').hidden = true;
    document.getElementById('studioShell').hidden = false;
    qa.navigate('writer-manuscript');
    const host = document.getElementById('writerVisualBooking');
    if (!host || !document.getElementById('writer-manuscript').contains(host)) throw new Error('Real writer booking host is missing');
    const api = window.LuminaCreatorVisualBooking;
    if (typeof api?.createController !== 'function' || typeof api?.mount !== 'function') throw new Error('Writer booking exports are missing');
    if (!host.querySelector('[data-writer-booking-action]')) qa.controller = api.mount(host);
    document.querySelectorAll('.studio-nav [data-section]').forEach(button =>
      button.addEventListener('click', () => qa.navigate(button.dataset.section)));
  });
}

const host = page => page.locator('#writerVisualBooking');
const action = (page, name) => host(page).locator(`[data-writer-booking-action="${name}"]`);
const workSelect = page => host(page).locator('[data-writer-booking-work]');
const item = (page, id = generationId) => host(page).locator(`[data-writer-booking-item="${id}"]`);
const ack = page => host(page).locator('[data-writer-booking-ack]');
const dialog = page => host(page).locator('dialog[open]');
const posts = page => page.evaluate(() => window.__creatorBookingQa.calls.filter(call => call.method === 'POST'));
const calls = (page, kind) => page.evaluate(kind => window.__creatorBookingQa.calls.filter(call => call.kind === kind), kind);

async function flush(page) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function waitForReply(page, kind, previousCount) {
  await page.waitForFunction(({ kind, previousCount }) => {
    const requests = window.__creatorBookingQa.calls.filter(call => call.kind === kind);
    return requests.length > previousCount && requests.slice(previousCount).every(call => call.completed);
  }, { kind, previousCount });
  await flush(page);
}

async function readAction(page, name, kind) {
  const previousCount = (await calls(page, kind)).length;
  await action(page, name).click();
  await waitForReply(page, kind, previousCount);
}

async function refreshCatalog(page) {
  await readAction(page, 'catalog', 'catalog');
  await workSelect(page).locator(`option[value="${workId}"]`).waitFor({ state: 'attached' });
  assert.equal(await workSelect(page).isEnabled(), true);
}

async function load(page, id = workId) {
  const before = (await calls(page, 'review')).length;
  await workSelect(page).selectOption(id);
  assert.equal((await calls(page, 'review')).length, before, 'selecting a work must not read bookings implicitly');
  await readAction(page, 'load', 'review');
  await item(page, id === workId ? generationId : secondGenerationId).waitFor();
}

async function approve(page) {
  await item(page).check();
  assert.equal(await ack(page).isChecked(), false);
  assert.equal(await action(page, 'prepare').isDisabled(), true);
  await ack(page).check();
  await action(page, 'prepare').click();
  await dialog(page).waitFor();
  assert.equal((await posts(page)).length, 0, 'opening confirmation must not mutate');
}

async function assertGated(page) {
  await flush(page);
  assert.equal(await dialog(page).count(), 0);
  assert.equal(await host(page).locator('[data-writer-booking-ack]:enabled').count(), 0);
  assert.equal(await host(page).locator('[data-writer-booking-action="prepare"]:enabled').count(), 0);
  assert.equal(await host(page).locator('[data-writer-booking-action="confirm"]:enabled').count(), 0);
}

async function assertFit(page, width) {
  const geometry = await host(page).evaluate((element, width) => {
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const nodes = [element, ...element.querySelectorAll('button,select,dd,strong,label,p,h3,h4,summary')].filter(visible);
    const failures = [];
    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      if (box.left < -1 || box.right > width + 1) failures.push(`${node.tagName}: outside viewport`);
      if (node.tagName !== 'SELECT' && node.scrollWidth > node.clientWidth + 2) failures.push(`${node.tagName}: horizontal overflow`);
    }
    const modal = element.querySelector('dialog[open]');
    const dialogContrast = [];
    if (modal) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = value => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
        return [red, green, blue, alpha / 255];
      };
      const paint = (front, back) => [...front.slice(0, 3).map((channel, index) =>
        channel * front[3] + back[index] * (1 - front[3])), 1];
      const background = node => {
        const layers = [];
        for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
          const layer = rgba(getComputedStyle(ancestor).backgroundColor);
          layers.push(layer);
          if (layer[3] === 1) break;
        }
        return layers.reduceRight((back, front) => paint(front, back), [255, 255, 255, 1]);
      };
      const luminance = color => color.slice(0, 3).map(channel => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
      for (const node of [...modal.querySelectorAll('button,p,dt,dd,label,h4')].filter(visible)) {
        const foreground = getComputedStyle(node).color;
        const back = background(node);
        const frontLuminance = luminance(paint(rgba(foreground), back));
        const backLuminance = luminance(back);
        dialogContrast.push({ tag: node.tagName, action: node.dataset.writerBookingAction || null,
          text: node.textContent.trim().slice(0, 80), foreground, background: back.slice(0, 3),
          ratio: (Math.max(frontLuminance, backLuminance) + 0.05) / (Math.min(frontLuminance, backLuminance) + 0.05) });
      }
    }
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth, host: element.getBoundingClientRect().toJSON(), failures,
      dialog: modal ? { ...modal.getBoundingClientRect().toJSON(), scrollWidth: modal.scrollWidth, clientWidth: modal.clientWidth } : null,
      dialogButtons: modal ? [...modal.querySelectorAll('button')].map(node => node.getBoundingClientRect().toJSON()) : [], dialogContrast };
  }, width);
  assert.ok(geometry.host.width > 250 && geometry.host.height > 150, JSON.stringify(geometry));
  assert.ok(geometry.documentWidth <= width + 1 && geometry.bodyWidth <= width + 1, JSON.stringify(geometry));
  assert.deepEqual(geometry.failures, [], JSON.stringify(geometry));
  if (geometry.dialog) {
    const box = geometry.dialog;
    assert.ok(box.left >= -1 && box.right <= width + 1 && box.top >= -1 && box.bottom <= geometry.viewport.height + 1, JSON.stringify(geometry));
    assert.ok(box.scrollWidth <= box.clientWidth + 2, JSON.stringify(geometry));
    geometry.dialogButtons.forEach(button => assert.ok(button.left >= box.left - 1 && button.right <= box.right + 1, JSON.stringify(geometry)));
    assert.ok(geometry.dialogContrast.some(node => node.action === 'confirm'), 'confirm button must be contrast-checked');
    assert.ok(geometry.dialogContrast.some(node => node.action === 'cancel'), 'cancel button must be contrast-checked');
    assert.ok(geometry.dialogContrast.some(node => node.tag === 'P') && geometry.dialogContrast.some(node => node.tag === 'DT'), 'dialog prose and labels must be contrast-checked');
    for (const node of geometry.dialogContrast) assert.ok(node.ratio >= 4.5,
      `dialog ${node.tag} ${node.action || node.text} contrast ${node.ratio.toFixed(2)} < 4.5: ${JSON.stringify(node)}`);
  }
  return geometry;
}

async function assertQuarantined(page, errors, network) {
  assert.deepEqual(errors, [], 'fixture must not produce page errors');
  assert.deepEqual(await page.evaluate(() => window.__creatorBookingQa.forbidden), []);
  assert.deepEqual(network.filter(request => request.method !== 'GET' || /\/(?:admin|api)\//.test(new URL(request.url).pathname)), []);
  assert.equal(await page.evaluate(() => window.__privateExecuted === true), false);
  assert.ok(!(await host(page).innerText()).includes(privateDiagnostic), 'private provider/error fields must never be rendered');
  assert.equal(await page.evaluate(value => [...Object.values(localStorage), ...Object.values(sessionStorage)]
    .some(stored => stored.includes(value)), privateDiagnostic), false);
}

async function fixture(context, width) {
  const actualEntry = await readFile(join(root, 'creator-studio/index.html'), 'utf8');
  assert.ok(actualEntry.includes('id="writerVisualBooking"'), 'main must integrate the real booking host first');
  assert.ok(actualEntry.includes(cssPath), 'main must link the real booking CSS first');
  // Preserve the actual shell, writer section, markup and styles, excluding unrelated scripts.
  const html = actualEntry.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<\/body\s*>/i, `<script src="${scriptPath}"></script></body>`);
  const page = await context.newPage();
  const errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.addInitScript(bootstrap, {
    catalogPath, catalog, review: baseReview, locales, titles, workId, secondWorkId, secondReleaseId,
    generationId, secondGenerationId, catalogCursor, privateDiagnostic,
  });
  await page.route('**/*', async route => {
    const request = route.request(), address = new URL(request.url());
    network.push({ url: address.href, method: request.method() });
    if (address.origin !== origin || request.method() !== 'GET') return route.abort();
    if (address.pathname === entryPath) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    const extension = extname(address.pathname);
    const mime = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    if (!mime[extension] || (extension === '.js' && address.pathname !== scriptPath)) return route.abort();
    const file = resolve(root, decodeURIComponent(address.pathname).replace(/^\/+/, ''));
    const local = relative(root, file);
    if (local.startsWith('..') || /^[A-Za-z]:/.test(local)) return route.abort();
    try { await route.fulfill({ status: 200, contentType: mime[extension], body: await readFile(file) }); }
    catch { await route.fulfill({ status: 404, body: '' }); }
  });
  try {
    await page.goto(origin + entryPath);
    await action(page, 'catalog').waitFor();
    await flush(page);
    assert.equal((await calls(page, 'catalog')).length, 0, 'mount must not automatically read the catalog');
    assert.equal(await workSelect(page).isDisabled(), true);
    await refreshCatalog(page);
    await workSelect(page).locator(`option[value="${workId}"]`).waitFor({ state: 'attached' });
    assert.equal(await page.locator('#studioShell').isVisible(), true);
    assert.equal(await page.locator('#writer-manuscript').evaluate(section => section.classList.contains('is-active')), true);
    assert.equal(await page.locator('#writer-manuscript #writerVisualBooking').count(), 1);
    assert.equal(await host(page).isVisible(), true);
    assert.equal(await workSelect(page).locator(`option[value="${privateWorkId}"]`).count(), 0);
    assert.equal(await page.evaluate(() => typeof window.LuminaCreatorVisualBooking.createController), 'function');
    assert.equal(await page.evaluate(() => typeof window.LuminaCreatorVisualBooking.mount), 'function');
    return { page, errors, network };
  } catch (error) { await page.close(); throw error; }
}

async function evidence(evidenceList, name, fixtureResult, detail = {}) {
  const { page, errors, network } = fixtureResult;
  await assertQuarantined(page, errors, network);
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true });
  evidenceList.push({ scenario: name, passed: true, ...detail, calls: await page.evaluate(() => window.__creatorBookingQa.calls), errors, network });
  await writeFile(evidencePath, JSON.stringify(evidenceList, null, 2));
  await appendFile(progressPath, `PASS ${name}\n`);
  process.stdout.write(`PASS ${name}\n`);
}

async function failure(evidenceList, name, fixtureResult, error) {
  const { page, errors, network } = fixtureResult;
  const screenshot = join(artifacts, `${name}-failure.png`);
  const state = await page.evaluate(() => ({ calls: window.__creatorBookingQa.calls,
    activeElement: { tag: document.activeElement?.tagName, id: document.activeElement?.id,
      focus: document.activeElement?.dataset.writerBookingFocus },
    status: document.querySelector('#writerVisualBooking [role="status"]')?.textContent })).catch(() => ({}));
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  evidenceList.push({ scenario: name, passed: false, message: error.message, stack: error.stack, screenshot, ...state, errors, network });
  await writeFile(evidencePath, JSON.stringify(evidenceList, null, 2));
  await appendFile(progressPath, `FAIL ${name}: ${error.message}\n`);
  process.stdout.write(`FAIL ${name}: ${error.message}\n`);
  throw error;
}

test('isolated creator visual booking: locales, layout, exact single POST, fail-closed gates and context invalidation',
  { skip: !enabled, timeout: 480_000 }, async () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
    process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
    process.env.TEMP = temp;
    process.env.TMP = temp;
    process.env.TMPDIR = temp;
    for (const directory of [artifacts, temp, join(artifacts, 'downloads')]) await mkdir(directory, { recursive: true });
    await writeFile(progressPath, '');
    const { chromium } = createRequire(import.meta.url)(playwrightBundle);
    const context = await chromium.launchPersistentContext(join(temp, 'profile'), {
      headless: true, viewport: { width: 1280, height: 900 }, acceptDownloads: false, serviceWorkers: 'block',
      ...(process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
      env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
      downloadsPath: join(artifacts, 'downloads'), tracesDir: join(temp, 'traces'),
      args: [`--disk-cache-dir=${join(temp, 'cache')}`, `--crash-dumps-dir=${join(artifacts, 'crashes')}`],
    });
    const results = [];
    try {
      // Explicit PNG evidence covers visuals; omit repeated full-shell snapshots from the trace.
      await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
      assert.equal(longScene.length, 160);
      for (const width of smoke ? [390] : widths) for (const locale of smoke ? ['ko'] : locales) {
        const result = await fixture(context, width);
        const { page } = result;
        try {
          const koreanLabel = await action(page, 'catalog').innerText();
          const catalogCount = (await calls(page, 'catalog')).length;
          await page.evaluate(locale => window.__creatorBookingQa.setLocale(locale), locale);
          if (locale !== 'ko') await page.waitForFunction(previous =>
            document.querySelector('#writerVisualBooking [data-writer-booking-action="catalog"]').textContent.trim() !== previous.trim(), koreanLabel);
          assert.equal((await calls(page, 'catalog')).length, catalogCount, 'locale mutation must not implicitly refresh the catalog');
          await refreshCatalog(page);
          const latestCatalog = (await calls(page, 'catalog')).at(-1);
          const catalogUrl = new URL(latestCatalog.url, origin);
          assert.equal(catalogUrl.searchParams.get('locale'), locale);
          assert.equal(catalogUrl.searchParams.get('limit'), '30');
          assert.ok((await workSelect(page).locator(`option[value="${workId}"]`).innerText()).includes(titles[locale]));
          await load(page);
          assert.equal((await posts(page)).length, 0);
          assert.equal(await item(page).getAttribute('type'), 'radio');
          const details = host(page).locator('details summary');
          if (await details.count()) await details.first().click();
          const reviewGeometry = await assertFit(page, width);
          await page.screenshot({ path: join(artifacts, `creator-booking-review-${width}-${locale}.png`), fullPage: true });
          await approve(page);
          assert.equal(await ack(page).getAttribute('type'), 'checkbox');
          assert.ok((await dialog(page).innerText()).includes(longScene));
          assert.ok((await dialog(page).innerText()).includes(releaseId));
          const dialogGeometry = await assertFit(page, width);
          await page.screenshot({ path: join(artifacts, `creator-booking-confirm-${width}-${locale}.png`) });
          await action(page, 'cancel').click();
          assert.equal(await dialog(page).count(), 0);
          assert.equal(await ack(page).isChecked(), false);
          assert.equal(await action(page, 'prepare').isDisabled(), true);
          assert.equal(await ack(page).evaluate(node => node === document.activeElement), true, 'cancel must return keyboard focus to acknowledgement');
          await approve(page);
          await action(page, 'confirm').focus();
          await page.keyboard.press('Escape');
          assert.equal(await dialog(page).count(), 0);
          assert.equal(await ack(page).isChecked(), false);
          assert.equal(await ack(page).evaluate(node => node === document.activeElement), true, 'Escape must return keyboard focus to acknowledgement');
          await approve(page);
          await page.evaluate(() => {
            const qa = window.__creatorBookingQa;
            qa.hold = 'post';
            qa.oldConfirm = document.querySelector('#writerVisualBooking [data-writer-booking-action="confirm"]').cloneNode(true);
          });
          await action(page, 'confirm').click();
          await page.waitForFunction(() => window.__creatorBookingQa.pending.some(pending => pending.kind === 'post'));
          assert.equal((await posts(page)).length, 1);
          assert.equal(await dialog(page).count(), 0);
          assert.equal(await workSelect(page).isDisabled(), true);
          assert.equal(await ack(page).count(), 0);
          // Replaying a stale revision while the request is unresolved must not send a second POST.
          await page.evaluate(() => {
            const button = window.__creatorBookingQa.oldConfirm;
            document.getElementById('writerVisualBooking').append(button);
            button.click(); button.remove();
          });
          assert.equal((await posts(page)).length, 1);
          await page.evaluate(() => { const qa = window.__creatorBookingQa; qa.hold = null; qa.release('post'); });
          await waitForReply(page, 'post', 0);
          assert.equal(await workSelect(page).isEnabled(), true);
          const mutations = await posts(page);
          assert.equal(mutations.length, 1);
          assert.equal(mutations[0].url, `${catalogPath}/${workId}/visual-bookings/reprepare`);
          assert.deepEqual(mutations[0].body, expectedPost);
          assert.deepEqual(mutations[0].identity, { ownerId: 'synthetic-writer-one', epoch: 1 });
          assert.equal(mutations[0].retried, true, 'mutation must disable the API adapter automatic 401 retry');
          assert.ok((await host(page).locator('[role="status"]').innerText()).startsWith(doneMessages[locale]));
          assert.equal(await host(page).locator('.writer-booking-state.is-error').count(), 0);
          assert.equal(await action(page, 'load').evaluate(node => node === document.activeElement), true, 'completed request must return keyboard focus to load');
          await assertGated(page);
          await assertFit(page, width);
          await evidence(results, `creator-booking-prepared-${width}-${locale}`, result, { reviewGeometry, dialogGeometry });
        } catch (error) { await failure(results, `creator-booking-prepared-${width}-${locale}`, result, error); }
        finally { await page.close(); }
      }

      if (smoke) return;
      for (const mode of ['401', '503', 'title', 'release-missing', 'release-invalid', 'duplicate', 'oversize', 'cursor-invalid', 'cursor-cycle']) {
        const result = await fixture(context, 400);
        const { page } = result;
        try {
          await load(page); await approve(page); await page.keyboard.press('Escape');
          await page.evaluate(mode => {
            const qa = window.__creatorBookingQa;
            if (/^\d+$/.test(mode)) qa.failure = { kind: 'catalog', status: Number(mode) };
            else if (mode === 'cursor-cycle') { qa.catalogPagination = true; qa.catalogCycle = true; }
            else qa.catalogCorrupt = mode;
          }, mode);
          await readAction(page, 'catalog', 'catalog');
          await assertGated(page);
          assert.equal(await workSelect(page).isDisabled(), true);
          assert.equal(await workSelect(page).locator(`option[value="${workId}"]`).count(), 0);
          assert.equal(await host(page).locator('.writer-booking-state.is-error').count(), 1);
          assert.equal((await posts(page)).length, 0);
          await evidence(results, `creator-booking-catalog-invalid-${mode}`, result);
        } catch (error) { await failure(results, `creator-booking-catalog-invalid-${mode}`, result, error); }
        finally { await page.close(); }
      }

      for (const mode of ['review-401', 'review-503', 'work', 'release', 'checksum', 'uppercase-hash',
        'scene', 'attempt', 'duplicate', 'inconsistent-gate', 'unsupported']) {
        const result = await fixture(context, 400);
        const { page } = result;
        try {
          await load(page); await approve(page); await action(page, 'cancel').click();
          await page.evaluate(mode => {
            const qa = window.__creatorBookingQa;
            if (mode.startsWith('review-')) qa.failure = { kind: 'review', status: Number(mode.slice(7)) };
            else qa.corrupt = mode;
          }, mode);
          await readAction(page, 'load', 'review');
          await assertGated(page);
          assert.equal(await item(page).count(), 0, 'invalid and unsupported replies must clear the old selected review');
          assert.equal((await posts(page)).length, 0);
          await evidence(results, `creator-booking-gate-${mode}`, result);
        } catch (error) { await failure(results, `creator-booking-gate-${mode}`, result, error); }
        finally { await page.close(); }
      }

      for (const reason of ['current', 'blocked', 'in_progress', 'attempted', 'asset_present', 'source_changed']) {
        const result = await fixture(context, 400);
        const { page } = result;
        try {
          await page.evaluate(reason => {
            const entry = window.__creatorBookingQa.review.items[0];
            entry.reason = reason; entry.canReprepare = false;
            entry.reviewSha256 = null; entry.currentBookingIdentitySha256 = null;
            if (reason === 'in_progress') entry.status = 'generating';
            if (reason === 'asset_present') entry.status = 'ready';
            if (['attempted', 'asset_present'].includes(reason)) entry.attemptCount = 1;
          }, reason);
          await load(page); await item(page).check();
          await assertGated(page);
          assert.equal((await posts(page)).length, 0);
          await evidence(results, `creator-booking-blocked-${reason}`, result);
        } catch (error) { await failure(results, `creator-booking-blocked-${reason}`, result, error); }
        finally { await page.close(); }
      }

      const privateSelection = await fixture(context, 400);
      try {
        const { page } = privateSelection;
        await load(page); await approve(page);
        const previousReads = (await calls(page, 'review')).length;
        await page.evaluate(privateWorkId => {
          const select = document.querySelector('[data-writer-booking-work]');
          select.append(new Option('Forged private target', privateWorkId));
          select.value = privateWorkId;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          const load = document.querySelector('#writerVisualBooking [data-writer-booking-action="load"]');
          load.disabled = false; load.click();
        }, privateWorkId);
        await assertGated(page);
        assert.equal((await calls(page, 'review')).length, previousReads, 'private work cannot bypass catalog membership');
        assert.equal((await posts(page)).length, 0);
        await evidence(results, 'creator-booking-private-selection', privateSelection);
      } catch (error) { await failure(results, 'creator-booking-private-selection', privateSelection, error); }
      finally { await privateSelection.page.close(); }

      for (const mode of ['catalog-401', 'catalog-503', 'release-changed', 'private', 'unpublished']) {
        const result = await fixture(context, 400);
        const { page } = result;
        try {
          await load(page); await approve(page);
          await page.evaluate(mode => {
            const qa = window.__creatorBookingQa, publication = qa.catalog[0].publication;
            if (mode.startsWith('catalog-')) qa.failure = { kind: 'catalog', status: Number(mode.slice(8)) };
            if (mode === 'release-changed') publication.activeReleaseId = qa.secondReleaseId;
            if (mode === 'private') { publication.status = 'private'; publication.published = false; publication.activeReleaseId = null; }
            if (mode === 'unpublished') publication.published = false;
          }, mode);
          const previousCount = (await calls(page, 'catalog')).length;
          await action(page, 'confirm').click();
          await waitForReply(page, 'catalog', previousCount);
          await assertGated(page);
          assert.equal((await posts(page)).length, 0, 'catalog/active-publication revalidation must gate the POST');
          await evidence(results, `creator-booking-preconfirm-${mode}`, result);
        } catch (error) { await failure(results, `creator-booking-preconfirm-${mode}`, result, error); }
        finally { await page.close(); }
      }

      for (const mode of ['401', '403', '409', '503', 'work', 'release', 'identity', 'started']) {
        const result = await fixture(context, 400);
        const { page } = result;
        try {
          await load(page); await approve(page);
          const before = await host(page).locator('[role="status"]').innerText();
          await page.evaluate(mode => {
            const qa = window.__creatorBookingQa;
            if (/^\d+$/.test(mode)) qa.failure = { kind: 'post', status: Number(mode) };
            else qa.receiptCorrupt = mode;
          }, mode);
          await action(page, 'confirm').click();
          await waitForReply(page, 'post', 0);
          await assertGated(page);
          assert.equal((await posts(page)).length, 1, 'uncertain/invalid responses must not retry a mutation');
          assert.equal(await host(page).locator('.writer-booking-state.is-error').count(), 1);
          assert.equal(await action(page, 'load').evaluate(node => node === document.activeElement), true, 'failed request must return keyboard focus to load');
          assert.ok(!(await host(page).locator('[role="status"]').innerText()).startsWith(doneMessages.ko));
          assert.notEqual(await host(page).locator('[role="status"]').innerText(), before);
          await refreshCatalog(page);
          assert.equal((await posts(page)).length, 1, 'refresh must not replay a mutation');
          await evidence(results, `creator-booking-receipt-${mode}`, result);
        } catch (error) { await failure(results, `creator-booking-receipt-${mode}`, result, error); }
        finally { await page.close(); }
      }

      for (const mode of ['work', 'manuscript', 'locale', 'locale-service', 'owner', 'logout', 'invalid-epoch', 'section', 'shell', 'catalog']) {
        const result = await fixture(context, 390);
        const { page } = result;
        try {
          await load(page); await approve(page);
          await page.evaluate(mode => {
            const qa = window.__creatorBookingQa;
            qa.staleConfirm = document.querySelector('#writerVisualBooking [data-writer-booking-action="confirm"]');
            if (mode === 'work') {
              const select = document.querySelector('[data-writer-booking-work]');
              select.value = qa.secondWorkId; select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (mode === 'manuscript') document.getElementById('writerManuscriptWork').dispatchEvent(new Event('change', { bubbles: true }));
            if (mode === 'locale') qa.setLocale('en');
            if (mode === 'locale-service') { window.luminaI18n = { getLocale: () => 'ja' }; qa.setLocale('en'); }
            if (mode === 'owner') qa.switchOwner('synthetic-writer-two');
            if (mode === 'logout') qa.switchOwner(null);
            if (mode === 'invalid-epoch') { qa.epoch = 'invalid'; window.dispatchEvent(new Event('focus')); }
            if (mode === 'section') qa.navigate('dashboard');
            if (mode === 'shell') document.getElementById('studioShell').hidden = true;
            if (mode === 'catalog') document.querySelector('#writerVisualBooking [data-writer-booking-action="catalog"]').click();
          }, mode);
          await page.waitForFunction(() => !document.querySelector('#writerVisualBooking dialog[open]'));
          await assertGated(page);
          await page.evaluate(() => window.__creatorBookingQa.staleConfirm.click());
          await flush(page);
          assert.equal((await posts(page)).length, 0, 'stale dialog controls must not mutate the new context');
          if (mode === 'locale-service') {
            await refreshCatalog(page);
            assert.equal(new URL((await calls(page, 'catalog')).at(-1).url, origin).searchParams.get('locale'), 'ja');
          }
          if (mode === 'section' || mode === 'shell') {
            await page.evaluate(() => {
              document.getElementById('studioShell').hidden = false;
              window.__creatorBookingQa.navigate('writer-manuscript');
            });
            await flush(page);
            await assertGated(page);
          }
          await evidence(results, `creator-booking-context-${mode}`, result);
        } catch (error) { await failure(results, `creator-booking-context-${mode}`, result, error); }
        finally { await page.close(); }
      }

      for (const boundary of ['review', 'catalog', 'post']) {
        const result = await fixture(context, 400);
        const { page } = result;
        try {
          await load(page);
          if (boundary !== 'review') await approve(page);
          await page.evaluate(boundary => { window.__creatorBookingQa.hold = boundary; }, boundary);
          await action(page, boundary === 'review' ? 'load' : 'confirm').click();
          await page.waitForFunction(boundary => window.__creatorBookingQa.pending.some(pending => pending.kind === boundary), boundary);
          await page.evaluate(() => window.__creatorBookingQa.switchOwner('synthetic-writer-two'));
          await assertGated(page);
          await page.evaluate(boundary => {
            const qa = window.__creatorBookingQa; qa.hold = null; qa.release(boundary);
          }, boundary);
          await flush(page);
          await assertGated(page);
          assert.equal(await item(page).count(), 0, 'late replies must not restore the previous owner review');
          assert.equal((await posts(page)).length, boundary === 'post' ? 1 : 0);
          assert.ok(!(await host(page).locator('[role="status"]').innerText()).startsWith(doneMessages.ko));
          await evidence(results, `creator-booking-late-owner-${boundary}`, result);
        } catch (error) { await failure(results, `creator-booking-late-owner-${boundary}`, result, error); }
        finally { await page.close(); }
      }

      const pagedCatalog = await fixture(context, 400);
      try {
        const { page } = pagedCatalog;
        await page.evaluate(() => { window.__creatorBookingQa.catalogPagination = true; });
        await refreshCatalog(page);
        const requests = await calls(page, 'catalog');
        assert.equal(new URL(requests.at(-1).url, origin).searchParams.get('cursor'), catalogCursor);
        assert.equal(await workSelect(page).locator(`option[value="${secondWorkId}"]`).count(), 1);
        assert.equal(await workSelect(page).locator(`option[value="${privateWorkId}"]`).count(), 0);
        await load(page, secondWorkId);
        assert.equal((await posts(page)).length, 0);
        await assertFit(page, 400);
        await evidence(results, 'creator-booking-catalog-cursor', pagedCatalog);
      } catch (error) { await failure(results, 'creator-booking-catalog-cursor', pagedCatalog, error); }
      finally { await pagedCatalog.page.close(); }

      for (const mode of ['paging', 'checksum-change']) {
        const result = await fixture(context, 390);
        const { page } = result;
        try {
          await page.evaluate(() => { window.__creatorBookingQa.bookingPagination = true; });
          await load(page); await approve(page); await page.keyboard.press('Escape');
          if (mode === 'checksum-change') await page.evaluate(() => { window.__creatorBookingQa.nextChecksum = 'f'.repeat(64); });
          await readAction(page, 'next', 'review');
          if (mode === 'checksum-change') await assertGated(page);
          else {
            await item(page, secondGenerationId).waitFor();
            assert.equal(await ack(page).count(), 0);
            await readAction(page, 'previous', 'review');
            await item(page).waitFor();
            assert.equal(await item(page).isChecked(), false);
            await item(page).check();
            assert.equal(await ack(page).isChecked(), false);
            assert.equal(await action(page, 'prepare').isDisabled(), true);
            const requests = await calls(page, 'review');
            assert.equal(new URL(requests.at(-2).url, origin).searchParams.get('afterId'), generationId);
            assert.equal(new URL(requests.at(-1).url, origin).searchParams.has('afterId'), false);
          }
          assert.equal((await posts(page)).length, 0);
          await assertFit(page, 390);
          await evidence(results, `creator-booking-${mode}`, result);
        } catch (error) { await failure(results, `creator-booking-${mode}`, result, error); }
        finally { await page.close(); }
      }

      const lateWork = await fixture(context, 400);
      try {
        const { page } = lateWork;
        await load(page);
        await page.evaluate(() => { window.__creatorBookingQa.hold = 'review'; });
        await action(page, 'load').click();
        await page.waitForFunction(() => window.__creatorBookingQa.pending.some(pending => pending.kind === 'review'));
        await page.evaluate(() => {
          const qa = window.__creatorBookingQa; qa.hold = null; qa.setLocale('en');
        });
        await flush(page);
        await refreshCatalog(page);
        await load(page, secondWorkId);
        await page.evaluate(() => window.__creatorBookingQa.release('review'));
        await flush(page);
        assert.equal(await workSelect(page).inputValue(), secondWorkId);
        assert.equal(await item(page).count(), 0);
        assert.equal(await item(page, secondGenerationId).count(), 1);
        assert.equal(await item(page, secondGenerationId).isChecked(), false);
        assert.equal((await posts(page)).length, 0);
        await evidence(results, 'creator-booking-late-work-and-locale', lateWork);
      } catch (error) { await failure(results, 'creator-booking-late-work-and-locale', lateWork, error); }
      finally { await lateWork.page.close(); }

      const externalFocus = await fixture(context, 400);
      try {
        const { page } = externalFocus;
        await load(page); await approve(page);
        await page.evaluate(() => { window.__creatorBookingQa.hold = 'post'; });
        await action(page, 'confirm').click();
        await page.waitForFunction(() => window.__creatorBookingQa.pending.some(pending => pending.kind === 'post'));
        const outsideControl = page.locator('.studio-nav [data-section="writer-manuscript"]');
        await outsideControl.focus();
        await page.evaluate(() => { const qa = window.__creatorBookingQa; qa.hold = null; qa.release('post'); });
        await waitForReply(page, 'post', 0);
        assert.equal(await outsideControl.evaluate(node => node === document.activeElement), true, 'late result must not steal focus from an external control');
        assert.ok((await host(page).locator('[role="status"]').innerText()).startsWith(doneMessages.ko));
        assert.equal((await posts(page)).length, 1);
        await evidence(results, 'creator-booking-preserve-external-focus', externalFocus);
      } catch (error) { await failure(results, 'creator-booking-preserve-external-focus', externalFocus, error); }
      finally { await externalFocus.page.close(); }
    } finally {
      try { await writeFile(evidencePath, JSON.stringify(results, null, 2)); }
      finally {
        try { await context.tracing.stop({ path: tracePath }); }
        finally { await context.close(); }
      }
    }
    const failed = results.filter(result => !result.passed).map(result => ({ scenario: result.scenario, message: result.message }));
    assert.deepEqual(failed, [], `${failed.length} browser scenarios failed; see creator-booking-evidence.json and failure screenshots`);
  });
