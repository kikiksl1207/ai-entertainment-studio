import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const context = {
  window: {},
  document: { readyState: 'loading', addEventListener() {} },
};

vm.runInNewContext(readFileSync(`${root}/data/characters.js`, 'utf8'), context);
vm.runInNewContext(readFileSync(`${root}/data/character-chat-tones.js`, 'utf8'), context);

const pageSource = readFileSync(`${root}/pages/character-chat.js`, 'utf8');
const initMarker = '  if (document.readyState === "loading") {';
assert.ok(pageSource.includes(initMarker), 'chat initialization marker is missing');
vm.runInNewContext(
  pageSource.replace(initMarker, `  window.__chatEntryTest = { shouldPreferLocalStarters, buildStarterOptions, getDmListCharacters, loadDmArtistList };\n${initMarker}`),
  context,
);

const { characters, chatTones, getChatTone } = context.window.LuminaStaticData;
const { shouldPreferLocalStarters, buildStarterOptions, getDmListCharacters, loadDmArtistList } = context.window.__chatEntryTest;
const affectedSlugs = [
  'nam-ian',
  'jang-taegeon',
  'bae-seongpil',
  'jung-doyun',
  'lim-jaeguk',
  'cha-mawang',
  'seo-ika',
  'baek-toga',
  'kwon-bandong',
];
const genericGreeting = getChatTone('missing-artist').welcomeMessage;
const genericStarterLabels = getChatTone('missing-artist').starters.map((starter) => starter.label);

test('every public artist has an explicit chat-entry tone', () => {
  const publicArtists = characters.filter((artist) => artist.status === 'public');
  assert.equal(publicArtists.length, 25);
  for (const artist of publicArtists) {
    assert.ok(Object.hasOwn(chatTones, artist.slug), `${artist.slug}: missing chat tone`);
  }
});

test('chat list includes every public artist and excludes unpublished entries', () => {
  const listed = getDmListCharacters();
  assert.deepEqual(Array.from(listed, (artist) => artist.slug),
    Array.from(characters.filter((artist) => artist.status === 'public'), (artist) => artist.slug));
  characters.push({ slug: 'private-test-artist', status: 'pending' });
  try {
    assert.equal(getDmListCharacters().some((artist) => artist.slug === 'private-test-artist'), false);
  } finally {
    characters.pop();
  }
});

test('public chat list uses the published API boundary, not local seed records', async () => {
  context.window.location = { hostname: 'www.lumina-stage.com' };
  assert.equal(getDmListCharacters().length, 0);
  const published = characters.filter((artist) => artist.status === 'public');
  context.apiFetch = async () => [
    ...published.map((artist) => ({ slug: artist.slug, status: 'active' })),
    { slug: 'withheld-artist', status: 'planned' },
  ];
  context.publicArtistsFromApi = (rows) => rows
    .filter((row) => row.status === 'active')
    .map((row) => ({ slug: row.slug, status: 'public' }));
  await loadDmArtistList();
  assert.deepEqual(Array.from(getDmListCharacters(), (artist) => artist.slug),
    Array.from(published, (artist) => artist.slug));
});

test('the nine new entries have distinct greetings and usable artist-specific starters', () => {
  const greetings = new Set();
  for (const slug of affectedSlugs) {
    const tone = chatTones[slug];
    assert.ok(tone, `${slug}: missing tone`);
    assert.notEqual(tone.welcomeMessage, genericGreeting, `${slug}: generic greeting`);
    assert.ok(tone.statusLine && tone.lastMessagePreview, `${slug}: missing entry copy`);
    assert.equal(tone.starters.length, 4, `${slug}: starter count`);
    assert.deepEqual(Array.from(tone.starters, (starter) => starter.key), ['A', 'B', 'C', 'D']);
    for (const starter of tone.starters) {
      assert.ok(starter.label && starter.message, `${slug}: empty starter`);
      assert.ok(!genericStarterLabels.includes(starter.label), `${slug}: generic starter`);
    }
    greetings.add(tone.welcomeMessage);
    assert.equal(buildStarterOptions([], slug).length, 4, `${slug}: local starter fallback`);
  }
  assert.equal(greetings.size, affectedSlugs.length);
});

test('only the nine affected artists prefer local starters over the default API set', () => {
  for (const slug of affectedSlugs) {
    assert.equal(shouldPreferLocalStarters(slug, { id: `${slug}-soft-start-1` }), true, slug);
    assert.equal(shouldPreferLocalStarters(slug, { id: `${slug}-custom-start-1` }), false, slug);
  }
  assert.equal(shouldPreferLocalStarters('ha-yuna', { id: 'ha-yuna-soft-start-1' }), false);
  assert.equal(shouldPreferLocalStarters('missing-artist', { id: 'missing-artist-soft-start-1' }), false);
});

test('public chat entry paths do not show sample room status matrices', () => {
  for (const path of ['character-chat.html', 'character-chat/index.html']) {
    const html = readFileSync(`${root}/${path}`, 'utf8');
    assert.doesNotMatch(html, /premium-chat-hub-state-matrix|방 상태 표시 안내/, path);
    assert.match(html, /id="premiumChatRoomsList"/, path);
  }
});

test('sample chat image threads are unavailable from public URL flags', () => {
  assert.doesNotMatch(pageSource, /imagefixture=1/);
  assert.match(pageSource, /return h === "localhost" \|\| h === "127\.0\.0\.1"/);
});

