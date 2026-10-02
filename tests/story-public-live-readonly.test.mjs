import assert from 'node:assert/strict';
import { test } from 'node:test';

const api = process.env.LUMINA_LIVE_API_URL;

async function read(path) {
  const response = await fetch(new URL(path, api), { signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, `${path} HTTP status`);
  return response.json();
}

test('published stories expose an ordered manuscript and three-choice first release',
  { skip: !api, timeout: 120_000 }, async () => {
    const catalog = await read('/api/v1/stories?locale=ko&limit=12');
    assert.ok(Array.isArray(catalog.items) && catalog.items.length >= 5);
    for (const item of catalog.items) {
      const detail = await read(`/api/v1/stories/${encodeURIComponent(item.slug)}?locale=ko`);
      assert.equal(detail.id, item.id);
      assert.ok(detail.title?.value && detail.author?.displayName && detail.cover?.publicAssetPath,
        `${item.slug} public metadata`);
      assert.ok(Array.isArray(detail.parts) && detail.parts.length > 0, `${item.slug} has parts`);
      assert.deepEqual(detail.parts.map(part => part.position),
        Array.from({ length: detail.parts.length }, (_, index) => index + 1),
        `${item.slug} part ordering`);
      assert.equal(new Set(detail.parts.map(part => part.id)).size, detail.parts.length,
        `${item.slug} part identifiers`);
      assert.equal(detail.releaseCapability?.fixedChoices, 3, `${item.slug} choice policy`);
      assert.equal(detail.releaseCapability?.aiGenerationEnabled, true, `${item.slug} AI capability`);
    }
  });

test('author search finds every public story credited to Lumina',
  { skip: !api, timeout: 120_000 }, async () => {
    const catalog = await read('/api/v1/stories?locale=ko&limit=12');
    const credited = [];
    for (const item of catalog.items) {
      const detail = await read(`/api/v1/stories/${encodeURIComponent(item.slug)}?locale=ko`);
      if (detail.author?.displayName === '루미나') credited.push(item.id);
    }
    const searched = await read(`/api/v1/stories?locale=ko&limit=12&q=${encodeURIComponent('루미나')}`);
    assert.deepEqual(searched.items.map(item => item.id).sort(), credited.sort());
  });
