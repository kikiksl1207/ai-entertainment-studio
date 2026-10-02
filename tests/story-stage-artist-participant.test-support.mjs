import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

export function registerArtistParticipantTests({ fixture, workId, progressId, artifacts, locales, gate, delay }) {
  const firstId = '11111111-1111-4111-8111-111111111112';
  const secondId = '11111111-1111-4111-8111-111111111113';
  const candidate = (artistId, displayName) => ({ artistId, displayName, slug: 'local-artist',
    source: 'search', thumbnail: null, visualIdentityReady: true });
  const payload = (searchResults = [], engaged = [], selectionLocked = false) => ({
    engaged, searchResults, selectedArtistId: null, selectionLocked,
  });
  const artist = (page, id) => page.locator(`[data-story-artist-id="${id}"]`);
  const search = (page) => page.locator('[data-story-artist-search]');
  async function submit(page, query) { await search(page).fill(query); await search(page).press('Enter'); }
  async function layout(page) {
    const result = await page.evaluate(() => {
      const modal = document.querySelector('.story-detail-modal');
      const box = modal.getBoundingClientRect();
      const elements = [...modal.querySelectorAll('.story-participant-picker, .story-participant-item, [data-story-start]')];
      return { documentWidth: document.documentElement.scrollWidth, viewport: innerWidth,
        modalFits: box.left >= -1 && box.right <= innerWidth + 1,
        controlsFit: elements.every((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.width > 0 && bounds.left >= box.left - 1 && bounds.right <= box.right + 1 &&
            element.scrollWidth <= element.clientWidth + 1;
        }) };
    });
    assert.ok(result.documentWidth <= result.viewport && result.modalFits && result.controlsFit, JSON.stringify(result));
    await page.locator('[data-story-start]').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('[data-story-start]').isVisible(), true);
  }

  for (const locale of locales) for (const width of [390, 400, 1280]) {
    test(`catalog: participant recovery and locked-null fit ${locale} ${width}px`, async () => {
      let locked = false;
      const f = await fixture({ locale, width, portraitCover: true, hook: (request) => {
        if (request.path.endsWith('/artist-candidates')) return { body: payload([], locked ? [] : [
          candidate(firstId, 'QA Artist One'), candidate(secondId, 'QA Artist Two'),
        ], locked) };
        if (request.method === 'POST' && request.path.endsWith('/progress')) return { status: 409,
          body: { error: { code: 'STORY_PARTICIPANT_IDENTITY_NOT_READY' } } };
      } });
      try {
        await f.open();
        await artist(f.page, firstId).click();
        await f.page.locator('[data-story-start]').click();
        await f.page.waitForFunction(([first, second]) =>
          document.querySelector(`[data-story-artist-id="${first}"]`)?.disabled === true &&
          document.querySelector(`[data-story-artist-id="${second}"]`)?.disabled === false &&
          document.querySelector('[data-story-start]')?.disabled === false &&
          Boolean(document.querySelector('[data-story-detail-status]')?.textContent.trim()), [firstId, secondId]);
        assert.equal(await artist(f.page, secondId).isEnabled(), true);
        assert.equal(await f.page.locator('[data-story-start]').isEnabled(), true);
        assert.ok((await f.page.locator('[data-story-detail-status]').innerText()).length > 0);
        assert.equal(new URL(f.page.url()).searchParams.has('sessionId'), false);
        await artist(f.page, secondId).click();
        assert.equal(await artist(f.page, secondId).getAttribute('aria-pressed'), 'true');
        await layout(f.page);
        await f.page.screenshot({ path: path.join(artifacts, `participant-recovery-${locale}-${width}.png`) });
        locked = true;
        await f.page.locator('[data-story-close]').click();
        await f.open();
        assert.equal(await search(f.page).count(), 0);
        assert.equal(await f.page.locator('[data-story-artist-id]').count(), 0);
        assert.equal(await f.page.locator('[data-story-artist-clear]').count(), 0);
        assert.ok((await f.page.locator('.story-participant-picker [role="status"]').innerText()).length > 0);
        await layout(f.page);
        const status = f.page.locator('.story-participant-picker [role="status"]');
        await status.scrollIntoViewIfNeeded();
        const readable = await status.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const body = element.closest('.story-detail-body').getBoundingClientRect();
          const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
          return bounds.top >= body.top - 1 && bounds.bottom <= body.bottom + 1 &&
            (hit === element || element.contains(hit)) &&
            getComputedStyle(document.getElementById('storyParticipantTitle')).fontSize === '16px';
        });
        assert.equal(readable, true, 'Locked participation notice must be readable above the footer');
        await f.page.screenshot({ path: path.join(artifacts, `participant-locked-${locale}-${width}.png`) });
        assert.equal(f.requests.filter((request) => request.method === 'POST').length, 1);
      } finally { await f.close(); }
    });
  }

  for (const lateError of [false, true]) {
    test(`catalog: latest artist search survives late ${lateError ? 'error' : 'success'}, clearing and a frozen start`, async () => {
      const entered = gate(), late = gate(), starting = gate(), started = gate();
      const f = await fixture({ width: 400, hook: async (request) => {
        if (request.path.endsWith('/artist-candidates')) {
          if (request.query.q === 'first') {
            entered.release(); await late.promise;
            return lateError ? { status: 500, body: { error: { code: 'LOCAL_SEARCH_FAILURE' } } } :
              { body: payload([candidate(firstId, 'Late First Artist')]) };
          }
          return { body: payload(request.query.q ? [candidate(secondId, 'Current Second Artist')] : []) };
        }
        if (request.method === 'POST' && request.path.endsWith('/progress')) {
          started.release(); await starting.promise;
          return { body: { progressId, revision: 6, choices: [] } };
        }
      } });
      try {
        await f.open();
        await submit(f.page, 'first'); await entered.promise;
        await submit(f.page, 'second'); await artist(f.page, secondId).waitFor();
        await artist(f.page, secondId).click();
        const response = f.page.waitForResponse((res) => new URL(res.url()).searchParams.get('q') === 'first');
        late.release(); await response; await delay();
        assert.equal(await artist(f.page, firstId).count(), 0);
        assert.equal(await artist(f.page, secondId).getAttribute('aria-pressed'), 'true');
        assert.equal(await f.page.locator('.story-participant-picker [role="alert"]').count(), 0);
        await submit(f.page, '');
        assert.equal(await artist(f.page, secondId).getAttribute('aria-pressed'), 'true');
        await f.page.locator('[data-story-start]').click(); await started.promise;
        assert.equal(await search(f.page).isDisabled(), true);
        assert.equal(await artist(f.page, secondId).isDisabled(), true);
        assert.equal(await f.page.locator('[data-story-artist-clear]').isDisabled(), true);
        assert.equal(await f.page.locator('[data-story-start]').isDisabled(), true);
        const posts = f.requests.filter((request) => request.method === 'POST');
        assert.equal(posts.length, 1);
        assert.deepEqual(posts[0].body, { mode: 'continue', locale: 'en', participantArtistId: secondId });
        starting.release();
        await f.page.waitForURL(`**sessionId=${progressId}&workId=${workId}`);
      } finally { late.release(); starting.release(); await f.close(); }
    });
  }

  test('catalog: same-tab account change discards selection and the previous account search error', async () => {
    const entered = gate(), late = gate();
    const f = await fixture({ hook: async (request) => {
      if (!request.path.endsWith('/artist-candidates')) return null;
      if (request.query.q) {
        entered.release(); await late.promise;
        return { status: 403, body: { error: { code: 'LOCAL_OLD_ACCOUNT' } } };
      }
      return { body: payload([], [candidate(firstId, 'Account Artist')]) };
    } });
    try {
      await f.open(); await artist(f.page, firstId).click();
      await submit(f.page, 'pending'); await entered.promise;
      await f.page.evaluate(() => { window.testUserId = 'other-user'; window.dispatchEvent(new Event('lumina:authchange')); });
      await f.page.waitForFunction(() => document.querySelector('[data-story-artist-search]')?.disabled === false);
      await artist(f.page, firstId).waitFor();
      assert.equal(await artist(f.page, firstId).getAttribute('aria-pressed'), 'false');
      assert.equal(await search(f.page).inputValue(), '');
      const response = f.page.waitForResponse((res) => new URL(res.url()).searchParams.get('q') === 'pending');
      late.release(); await response; await delay();
      assert.equal(await f.page.locator('[data-story-start]').isEnabled(), true);
      assert.equal(await artist(f.page, firstId).getAttribute('aria-pressed'), 'false');
      assert.ok(f.requests.some((request) => request.path.endsWith('/access') && request.headers.authorization === 'Bearer other-synthetic-token'));
      assert.equal(f.requests.filter((request) => request.method === 'POST').length, 0);
    } finally { late.release(); await f.close(); }
  });
}
