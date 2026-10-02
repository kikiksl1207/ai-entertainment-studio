import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/character-detail.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../character-detail/index.html', import.meta.url), 'utf8');

function detailFixture(shortforms, status = 'public') {
  const block = { hidden: true };
  const root = () => ({ innerHTML: '', hidden: false, dataset: {}, style: {}, setAttribute() {}, classList: { add() {}, toggle() {} } });
  const roots = Object.fromEntries([
    'detailHero', 'detailIntro', 'detailMeta', 'detailGallery', 'detailShorts', 'detailProfile',
    'detailCta', 'detailTagNavigation', 'detailChatSection', 'detailBodySection',
    'detailCtaSection', 'detailTagSection', 'detailChatSelect', 'chatStartLink',
  ].map(id => [id, root()]));
  roots.detailHero.querySelector = () => null;
  roots.detailGallery.closest = () => ({ classList: { toggle() {} } });
  roots.detailGallery.addEventListener = () => {};
  roots.detailShorts.closest = () => block;
  const artist = {
    slug: 'test-artist', publicName: 'Test Artist', status, type: 'Artist', tier: 'main',
    images: { thumb: '/portrait.jpg' }, gallery: [], profile: {}, tags: [],
    shorts: [{ title: 'Coming soon', metric: 'Preparing' }],
  };
  const calls = [];
  const window = {
    location: { search: '?slug=test-artist' },
    addEventListener() {},
  };
  const document = {
    documentElement: { style: { setProperty() {} } },
    getElementById: id => roots[id] || null,
    querySelector: () => null,
  };
  runInNewContext(source, {
    window, document, URLSearchParams,
    statusMeta: { public: { className: 'is-public', label: 'Public' }, secret: { className: 'is-secret', label: 'Secret' } },
    getCharacterBySlug: slug => slug === artist.slug ? artist : null,
    _artists: [artist], publicArtistsFromApi: () => [artist],
    shouldKeepLocalGallery: () => true,
    mediaStyle: path => path ? ` style="background-image:url('${path}')"` : '',
    feedEscapeHtml: value => value,
    apiFetch: async path => {
      calls.push(path);
      return path === '/api/v1/shortforms' ? shortforms : {
        id: 'artist-id', slug: artist.slug, status: status === 'public' ? 'active' : 'planned',
      };
    },
    console: { warn() {} },
  });
  return { artist, block, calls, shortsRoot: roots.detailShorts, render: () => window.renderCharacterDetail() };
}

const video = { assetType: 'video', mimeType: 'video/mp4', url: '/media/real-short.mp4' };
const image = { assetType: 'image', mimeType: 'image/jpeg', url: '/media/real-short.jpg' };
const published = { status: 'published', artist: { slug: 'test-artist' }, title: 'Real performance', assets: [video, image] };

test('shorts section starts hidden and title-only or unplayable entries never reveal it', async () => {
  assert.match(html, /<div class="detail-shorts-block" hidden>/);
  for (const response of [[], [
    { ...published, assets: [image] },
    { ...published, status: 'draft' },
    { ...published, artist: { slug: 'another-artist' } },
    { ...published, assets: [{ ...video, url: 'javascript:alert(1)' }] },
  ], null]) {
    const view = detailFixture(response);
    view.render();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.block.hidden, true);
    assert.equal(view.shortsRoot.innerHTML, '');
    assert.ok(view.calls.includes('/api/v1/shortforms'));
  }
});

test('published public video keeps a card with a playable navigation target', async () => {
  const view = detailFixture([{ ...published, title: '<Performance>' }]);
  view.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.block.hidden, false);
  assert.match(view.shortsRoot.innerHTML, /class="detail-short-card" href="\/media\/real-short\.mp4"/);
  assert.match(view.shortsRoot.innerHTML, /background-image:url\('\/media\/real-short\.jpg'\)/);
  assert.match(view.shortsRoot.innerHTML, /&lt;Performance&gt;/);
  assert.doesNotMatch(view.shortsRoot.innerHTML, /Coming soon/);
});

test('non-public artist never requests or shows shorts', async () => {
  const view = detailFixture([published], 'secret');
  view.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.block.hidden, true);
  assert.ok(!view.calls.includes('/api/v1/shortforms'));
});
