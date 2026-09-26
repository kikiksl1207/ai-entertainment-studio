import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../pages/creator-studio.js', import.meta.url), 'utf8');

function createElement() {
  const classes = new Set();
  return {
    hidden: false, disabled: false, textContent: '', innerHTML: '', value: '', style: {}, dataset: {},
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name)
    },
    addEventListener() {}, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    replaceChildren() { this.innerHTML = ''; }, scrollTo() {}
  };
}

async function boot({ artists = [], summary = {}, preview = {}, payout = {}, wallet = { cachedBalance: '0' },
  walletStatus = 200, settlementStatus = 200, previewGate = null } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const conversionButton = createElement();
  conversionButton.disabled = true;
  const slotFill = createElement();
  const document = {
    body: createElement(), documentElement: { ...createElement(), lang: 'ko' },
    getElementById: element,
    querySelectorAll() { return []; },
    querySelector(selector) {
      if (selector === '#studioSlotBar span') return slotFill;
      if (selector === '[data-action="settlement-conversion"]') return conversionButton;
      return null;
    },
    addEventListener() {}
  };
  let auth = JSON.stringify({ accessToken: 'test-token', user: { id: 'user-1', email: 'creator@example.test' } });
  const calls = [];
  const fetch = async url => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === '/api/v1/me/creator-studio') return { ok: true, status: 200, json: async () => ({ access: { enabled: true }, artists, summary }) };
    if (path === '/api/v1/wallet') return { ok: walletStatus === 200, status: walletStatus, json: async () => wallet };
    if (path.endsWith('/settlement-preview')) return previewGate || { ok: settlementStatus === 200, status: settlementStatus, json: async () => preview };
    if (path.endsWith('/payout-summary')) return { ok: true, status: 200, json: async () => payout };
    if (path.endsWith('/settlement-conversions')) return { ok: true, status: 200, json: async () => ({ items: [] }) };
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };
  const context = {
    window: { addEventListener() {} }, document, fetch, URL, URLSearchParams, AbortController,
    DOMException, FormData, Blob, TextEncoder, TextDecoder,
    localStorage: { getItem: key => key === 'lumina_auth' ? auth : null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null },
    location: { hash: '' }, history: { replaceState() {} },
    setTimeout: () => 1, clearTimeout() {}, Date, Math, console
  };
  vm.runInNewContext(script, context, { filename: 'creator-studio.js' });
  for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));
  return { element, conversionButton, slotFill, calls,
    switchAccount() { auth = JSON.stringify({ accessToken: 'other-token', user: { id: 'user-2', email: 'other@example.test' } }); } };
}

test('public creator markup contains no sample account activity or enabled placeholder actions', () => {
  for (const sample of ['1,284', '205,440', '420L', 'Studio Lumi', '윤세린', '하윤아', '박도아', 'IMG-024']) {
    assert.ok(!html.includes(sample), `${sample} must not be public fallback content`);
  }
  assert.doesNotMatch(html, /data-action="toast"|data-action="tone"/);
  assert.match(html, /id="studioProfileSaveButton" disabled/);
  assert.match(html, /data-action="settlement-conversion" disabled/);
  assert.match(html, /id="writerManuscriptBody"/);
  assert.match(html, /id="storyIntakeForm"/);
});

test('authenticated empty account stays empty across artists, media, and settlement', async () => {
  const page = await boot({
    summary: { ownedArtistCount: 0, activeArtistCount: 0, openImageRequestCount: 0, usedSlots: 0, slotLimit: 10 },
    preview: { totals: { creatorShareKrw: '0' }, items: [] },
    payout: { policy: { hidePayoutRow: true }, totals: {} }
  });
  assert.equal(page.element('studioMetricArtists').textContent, '0명');
  assert.match(page.element('studioArtistCards').innerHTML, /연결된 아티스트가 없습니다/);
  assert.match(page.element('studioMediaGrid').innerHTML, /공개 이미지가 없습니다/);
  assert.match(page.element('studioArtistRows').innerHTML, /colspan="3"/);
  assert.equal(page.element('studioMetricSettlement').textContent, '0원');
  assert.equal(page.element('studioMetricLumina').textContent, '0L');
  assert.match(page.element('studioSettlementRows').innerHTML, /내역이 없습니다/);
  assert.equal(page.conversionButton.disabled, true);
  assert.equal(page.element('studioProfileSaveButton').disabled, true);
});

test('authenticated projections render only returned artist, asset, and payout values', async () => {
  const page = await boot({
    artists: [{ artist: { id: 'a-1', displayName: '실제 아티스트', status: 'active',
      publicProfile: { tagline: '실제 소개' }, assets: [{ id: 'asset-1', assetType: 'image', url: '/real.png', usageType: 'cover' }] },
      imageRequests: { open: 2 } }],
    summary: { ownedArtistCount: 1, activeArtistCount: 1, openImageRequestCount: 2, usedSlots: 1, slotLimit: 10 },
    preview: { totals: { creatorShareKrw: '1234', grossRevenueKrw: '2000', riskReserveKrw: '100' }, items: [] },
    wallet: { cachedBalance: '420.5' },
    payout: { policy: { hidePayoutRow: false }, totals: { grossLumina: '90', eligibleLumina: '80',
      grossAmount: { amount: '1234', currency: 'KRW' }, taxAmount: { amount: '40', currency: 'KRW' },
      netAmount: { amount: '1194', currency: 'KRW' }, currency: 'KRW' } }
  });
  assert.match(page.element('studioArtistCards').innerHTML, /실제 아티스트/);
  assert.match(page.element('studioMediaGrid').innerHTML, /\/real\.png/);
  assert.match(page.element('studioArtistRows').innerHTML, /2건/);
  assert.equal(page.element('studioMetricSettlement').textContent, '1,234원');
  assert.equal(page.element('studioMetricLumina').textContent, '420.5L');
  assert.equal(page.element('studioPayoutTaxKrw').textContent, '40원');
  assert.equal(page.element('studioPayoutNetKrw').textContent, '1,194원');
  assert.equal(page.conversionButton.disabled, true, 'preview does not provide a settlementKey');
  assert.ok(page.calls.includes('/api/v1/me/creator-studio/payout-summary'));
});

test('unavailable settlement does not retain a sample amount or enable conversion', async () => {
  const page = await boot({ settlementStatus: 503, walletStatus: 503 });
  assert.equal(page.element('studioMetricSettlement').textContent, '조회 불가');
  assert.equal(page.element('studioMetricLumina').textContent, '조회 불가');
  assert.match(page.element('studioSettlementRows').innerHTML, /불러오지 못했습니다/);
  assert.equal(page.conversionButton.disabled, true);
});

test('late settlement response from a previous account is ignored', async () => {
  let resolvePreview;
  const previewGate = new Promise(resolve => { resolvePreview = resolve; });
  const page = await boot({ previewGate });
  page.switchAccount();
  resolvePreview({ ok: true, status: 200, json: async () => ({ totals: { creatorShareKrw: '999999' }, items: [] }) });
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.element('studioMetricSettlement').textContent, '');
  assert.equal(page.conversionButton.disabled, true);
});
