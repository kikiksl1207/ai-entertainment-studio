import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// Private route fixtures only. Registered in the existing serial browser suite.
export function registerPurchaseTests({ fixture, owner, detail, progress, workId, otherId, artifacts, locales, gate, delay }) {
  const releaseId = '66666666-6666-4666-8666-666666666666';
  const quote = { priceLumina: '125.5', releaseId, releaseRevision: 4 };
  const purchased = { entitled: true, charged: true, idempotentReplay: false, chargedAmountLumina: '125.5', outcome: 'purchased' };
  const replayed = { entitled: true, charged: false, idempotentReplay: true, chargedAmountLumina: '0', originalPurchaseAmountLumina: '125.5', outcome: 'replayed' };
  const posts = (f) => f.requests.filter((r) => r.path.endsWith('/purchase'));
  const confirm = async (f) => {
    await f.page.locator('[data-story-purchase]').click();
    assert.equal(posts(f).length, 0, 'Opening confirmation never debits');
    assert.equal(await f.page.locator('[data-story-detail-retry]').count(), 0, 'Clean consent has no unrelated retry');
    assert.equal(await f.page.locator('.story-detail-actions button').count(), 2, 'Consent offers only Confirm and Cancel');
    await f.page.locator('[data-story-purchase-confirm]').click();
  };
  const body = (q) => ({ confirmedPriceLumina: q.priceLumina, expectedReleaseId: q.releaseId, expectedReleaseRevision: q.releaseRevision });
  const err = (status, code, walletMutation = false) => ({ status, body: { error: { code, message: 'SECRET_DIAGNOSTIC', details: { walletMutation } } } });
  async function purchaseFixture(options = {}) {
    const owners = new Set();
    let currentQuote = { ...quote };
    const f = await fixture({ ...options, free: false, hook: async (r) => {
      const identity = r.headers.authorization;
      const custom = await options.hook?.(r, { setOwned: (value) => { if (value) owners.add(identity); else owners.delete(identity); }, setQuote: (value) => { currentQuote = value; } });
      if (custom) return custom;
      const owned = owners.has(identity);
      if (r.path.endsWith('/access')) {
        const value = owner({ free: false, owned });
        value.access.purchaseConfirmation = owned ? null : currentQuote;
        value.access.pricing.amountLumina = currentQuote?.priceLumina || '125.5';
        return { body: value };
      }
      if (r.path.endsWith('/progress-state')) return { body: progress({ free: false, owned }) };
      if (r.path.endsWith('/purchase')) { owners.add(identity); return { body: purchased }; }
    } });
    return f;
  }

  test('purchase: exact explicit quote, one POST under double click, fresh reads before explicit start', async () => {
    const g = gate();
    const f = await purchaseFixture({ hook: async (r) => { if (r.path.endsWith('/purchase')) await g.promise; } });
    try {
      await f.open();
      await confirm(f);
      await f.page.locator('[data-story-purchase-retry]').dispatchEvent('click');
      assert.equal(await f.page.locator('[data-story-purchase-retry]').isDisabled(), true);
      g.release();
      await f.page.locator('[data-story-start]:enabled').waitFor();
      assert.equal(posts(f).length, 1);
      assert.deepEqual(posts(f)[0].body, body(quote));
      assert.equal(posts(f)[0].headers.authorization, 'Bearer private-synthetic-token');
      assert.match(posts(f)[0].headers['idempotency-key'], /^story-purchase-/);
      assert.deepEqual(f.requests.slice(f.requests.indexOf(posts(f)[0]) + 1).map((r) => r.path.split('/').at(-1)), ['private-local-story', 'access', 'progress-state']);
      assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1, 'No automatic reader start');
      await f.page.locator('[data-story-start]').click();
      await f.page.waitForURL('**sessionId=*');
      assert.equal(posts(f).length, 1);
    } finally { g.release(); await f.close(); }
  });

  test('purchase: cancel, Escape and browser back send no debit', async () => {
    const f = await purchaseFixture();
    try {
      await f.open();
      await f.page.locator('[data-story-purchase]').click();
      await f.page.locator('[data-story-purchase-cancel]').click();
      await f.page.locator('[data-story-purchase]').click();
      await f.page.keyboard.press('Escape');
      await f.page.waitForFunction(() => !document.querySelector('dialog'));
      await f.open();
      assert.equal(await f.page.locator('[data-story-purchase-confirm]').count(), 0);
      await f.page.goBack();
      assert.equal(posts(f).length, 0);
    } finally { await f.close(); }
  });

  for (const change of ['price', 'release', 'revision', 'required']) {
    test(`purchase: stale ${change} refreshes and requires fresh explicit consent`, async () => {
      let count = 0;
      const replacement = { ...quote, ...(change === 'price' ? { priceLumina: '126.25' } : change === 'release' ? { releaseId: otherId } : { releaseRevision: 5 }) };
      const f = await purchaseFixture({ hook: (r, c) => {
        if (!r.path.endsWith('/purchase')) return;
        if (++count === 1) { c.setQuote(replacement); return err(409, `STORY_PURCHASE_CONFIRMATION_${change === 'required' ? 'REQUIRED' : 'STALE'}`); }
        c.setOwned(true);
        return { body: { ...purchased, chargedAmountLumina: replacement.priceLumina } };
      } });
      try {
        await f.open(); await confirm(f);
        await f.page.locator('[data-story-purchase]:enabled').waitFor();
        assert.match(await f.page.locator('[data-story-detail-status]').innerText(), /changed/);
        assert.equal(posts(f).length, 1);
        assert.equal(await f.page.locator('[data-story-purchase-confirm]').count(), 0);
        await f.page.locator('[data-story-purchase]').click();
        assert.match(await f.page.locator('[data-story-purchase-confirm]').innerText(), new RegExp(replacement.priceLumina));
        await f.page.locator('[data-story-purchase-confirm]').click();
        await f.page.locator('[data-story-start]').waitFor();
        assert.equal(posts(f).length, 2);
        assert.deepEqual(posts(f)[1].body, body(replacement));
        assert.notEqual(posts(f)[0].headers['idempotency-key'], posts(f)[1].headers['idempotency-key']);
      } finally { await f.close(); }
    });
  }

  for (const mode of ['lost', 'timeout', 'invalid result', 'server error']) {
    test(`purchase: ${mode} retains original key/quote across reload and price change`, async () => {
      let count = 0;
      const g = gate();
      const f = await purchaseFixture({ hook: async (r, c) => {
        if (!r.path.endsWith('/purchase')) return;
        if (++count > 1) { c.setOwned(true); return { body: replayed }; }
        c.setQuote({ ...quote, priceLumina: '987.65' });
        if (mode === 'timeout') { await g.promise; return { body: purchased }; }
        if (mode === 'lost') return { abort: true };
        if (mode === 'server error') return err(503, 'PRIVATE_DB_DIAGNOSTIC');
        return { body: { ...purchased, chargedAmountLumina: 125.5 } };
      } });
      try {
        await f.open();
        if (mode === 'timeout') await f.page.clock.install();
        await confirm(f);
        if (mode === 'timeout') { await f.page.clock.runFor(15100); g.release(); }
        await f.page.locator('[data-story-purchase-retry]:enabled').waitFor();
        assert.equal(await f.page.locator('[data-story-detail-retry]:enabled').count(), 1, 'Unknown result retains Check access');
        await f.page.locator('[data-story-detail-retry]').click();
        await f.page.locator('[data-story-purchase-retry]:enabled').waitFor();
        assert.equal(posts(f).length, 1, 'Checking access must not repost the purchase');
        await f.page.reload();
        await f.page.locator('[data-story-purchase-retry]:enabled').waitFor();
        assert.equal(posts(f).length, 1);
        assert.equal(await f.page.locator('[data-story-purchase-price]').innerText(), '125.5 LUMINA');
        await f.page.locator('[data-story-purchase-retry]').click();
        await f.page.locator('[data-story-start]').waitFor();
        assert.equal(posts(f).length, 2);
        assert.deepEqual(posts(f)[0].body, posts(f)[1].body);
        assert.equal(posts(f)[0].headers['idempotency-key'], posts(f)[1].headers['idempotency-key']);
        assert.doesNotMatch(await f.page.locator('dialog').innerText(), /987\.65.*charged|SECRET_|PRIVATE_DB|66666666/);
      } finally { g.release(); await f.close(); }
    });
  }

  test('purchase: lost charged response reconciles fresh access without another POST', async () => {
    const f = await purchaseFixture({ hook: (r, c) => { if (r.path.endsWith('/purchase')) { c.setOwned(true); return { abort: true }; } } });
    try {
      await f.open(); await confirm(f);
      await f.page.locator('[data-story-start]').waitFor();
      assert.equal(posts(f).length, 1);
      assert.doesNotMatch(await f.page.locator('[data-story-detail-status]').innerText(), /unknown/);
      assert.equal(await f.page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('lumina:story-purchase:')).length), 0);
    } finally { await f.close(); }
  });

  for (const outcome of ['free', 'already_entitled', 'replayed', 'entitlement_inactive']) {
    test(`purchase: ${outcome} never fabricates access or auto-starts`, async () => {
      const f = await purchaseFixture({ hook: (r) => r.path.endsWith('/purchase') ? { body: { ...replayed, outcome, entitled: outcome !== 'entitlement_inactive' } } : null });
      try {
        await f.open(); await confirm(f);
        await f.page.locator('[data-story-purchase]:enabled').waitFor();
        assert.equal(await f.page.locator('[data-story-start]').count(), 0, 'Server access is still unowned');
        assert.equal(posts(f).length, 1);
        assert.ok(f.requests.filter((r) => r.path.endsWith('/access')).length >= 2);
        if (outcome === 'entitlement_inactive') assert.match(await f.page.locator('[data-story-detail-status]').innerText(), /no longer grants access/);
      } finally { await f.close(); }
    });
  }

  for (const value of [null, {}, { ...quote, releaseId: 'private-id' }, { ...quote, releaseRevision: 0 },
    ...['-1', '0', '0.00', '1e3', '1.001', '01', '99999999999999999', 'NaN', 'Infinity', ' 125.5', 125.5].map((priceLumina) => ({ ...quote, priceLumina }))]) {
    test(`purchase: invalid confirmation ${JSON.stringify(value)} is disabled without rounding`, async () => {
      const f = await purchaseFixture({ hook: (r, c) => { if (r.path.endsWith('/access')) c.setQuote(value); } });
      try {
        await f.open();
        assert.equal(await f.page.locator('[data-story-purchase]:enabled').count(), 0);
        assert.equal(posts(f).length, 0);
      } finally { await f.close(); }
    });
  }

  test('purchase: largest supported decimal remains exact in text and request', async () => {
    const large = { ...quote, priceLumina: '9999999999999999.99' };
    const f = await purchaseFixture({ hook: (r, c) => { if (r.path.endsWith('/access')) c.setQuote(large); } });
    try {
      await f.open(); await f.page.locator('[data-story-purchase]').click();
      assert.equal(await f.page.locator('[data-story-purchase-price]').innerText(), large.priceLumina + ' LUMINA');
      await f.page.locator('[data-story-purchase-confirm]').click();
      await f.page.locator('[data-story-start]').waitFor();
      assert.deepEqual(posts(f)[0].body, body(large));
    } finally { await f.close(); }
  });

  for (const change of ['close', 'locale', 'auth', 'switch', 'back']) {
    test(`purchase: pending ${change} cannot navigate or expose another account's access`, async () => {
      const g = gate();
      const f = await purchaseFixture({ hook: async (r) => { if (r.path.endsWith('/purchase')) await g.promise; } });
      try {
        await f.open(); await confirm(f);
        if (change === 'close') await f.page.locator('[data-story-close]').click();
        if (change === 'back') await f.page.goBack();
        if (change === 'locale') await f.page.evaluate(() => { window.testLocale = 'ja'; window.dispatchEvent(new Event('lumina:localechange')); });
        if (change === 'auth') await f.page.evaluate(() => { window.testAuthenticated = false; window.dispatchEvent(new Event('lumina:auth-expired')); });
        if (change === 'switch') await f.page.evaluate(() => { window.testUserId = 'other-user'; window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' })); });
        g.release(); await delay(250);
        assert.equal(new URL(f.page.url()).searchParams.has('sessionId'), false);
        assert.equal(posts(f).length, 1);
        if (['auth', 'switch'].includes(change)) assert.equal(await f.page.locator('[data-story-start]').count(), 0);
        if (change === 'locale') await f.page.locator('[data-story-start]:enabled').waitFor();
      } finally { g.release(); await f.close(); }
    });
  }

  test('purchase: unknown key remains isolated per user and restored on return', async () => {
    const f = await purchaseFixture({ hook: (r) => r.path.endsWith('/purchase') ? { abort: true } : null });
    try {
      await f.open(); await confirm(f);
      await f.page.locator('[data-story-purchase-retry]:enabled').waitFor();
      for (const id of ['other-user', 'local-user']) {
        await f.page.evaluate((id) => { window.testUserId = id; window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' })); }, id);
        await f.page.locator(id === 'local-user' ? '[data-story-purchase-retry]:enabled' : '[data-story-purchase]:enabled').waitFor();
      }
      await f.page.locator('[data-story-purchase-retry]').click();
      await f.page.locator('[data-story-purchase-retry]:enabled').waitFor();
      assert.equal(posts(f)[0].headers['idempotency-key'], posts(f)[1].headers['idempotency-key']);
    } finally { await f.close(); }
  });

  for (const locale of locales) {
    test(`purchase: ${locale} localized insufficient balance without private diagnostics`, async () => {
      const f = await purchaseFixture({ locale, hook: (r) => r.path.endsWith('/purchase') ? err(400, 'WALLET_MUTATION_INSUFFICIENT_BALANCE') : null });
      try {
        await f.open(); await confirm(f);
        await f.page.locator('[data-story-purchase]:enabled').waitFor();
        const text = await f.page.locator('[data-story-detail-status]').innerText();
        assert.equal(await f.page.locator('[data-story-detail-retry]:enabled').count(), 1, 'Purchase failure retains retry');
        assert.match(text, /LUMINA/);
        assert.doesNotMatch(text, /SECRET_|WALLET_|66666666/);
        if (locale !== 'en') assert.doesNotMatch(text, /insufficient|unknown/);
        assert.equal(posts(f).length, 1);
      } finally { await f.close(); }
    });
  }

  test('purchase: unavailable session storage blocks debit before transmission', async () => {
    const f = await purchaseFixture();
    try {
      await f.open();
      await f.page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('PRIVATE_STORAGE_ERROR'); }; });
      await confirm(f);
      assert.equal(posts(f).length, 0);
      assert.match(await f.page.locator('[data-story-detail-status]').innerText(), /cannot be saved safely/);
      assert.equal(await f.page.locator('[data-story-detail-retry]:enabled').count(), 1, 'Confirmation storage failure retains retry');
    } finally { await f.close(); }
  });

  test('purchase: close and reopen while pending stays single-flight', async () => {
    const g = gate();
    const f = await purchaseFixture({ hook: async (r) => { if (r.path.endsWith('/purchase')) await g.promise; } });
    try {
      await f.open(); await confirm(f);
      await f.page.locator('[data-story-close]').click();
      await f.page.waitForFunction(() => !new URL(location.href).searchParams.has('slug'));
      await f.open();
      assert.equal(await f.page.locator('[data-story-purchase-retry]').isDisabled(), true);
      await f.page.locator('[data-story-purchase-retry]').dispatchEvent('click');
      g.release();
      await f.page.locator('[data-story-start]:enabled').waitFor();
      assert.equal(posts(f).length, 1);
    } finally { g.release(); await f.close(); }
  });

  for (const locale of locales) for (const width of [390, 400, 1280]) {
    test(`purchase: ${locale} ${width} real confirmation screenshot, text and overlay bounds`, async () => {
      const f = await purchaseFixture({ locale, width, long: true });
      try {
        await f.open(); await f.page.locator('[data-story-purchase]').click();
        const dialog = f.page.locator('dialog');
        assert.equal(await dialog.count(), 1);
        assert.equal(await f.page.locator('dialog dialog, .story-detail-actions .story-pack-card').count(), 0);
        assert.equal(await f.page.locator('[data-story-purchase-price]').innerText(), '125.5 LUMINA');
        assert.equal(await f.page.locator('[data-story-purchase-confirm]').evaluate((el) => el === document.activeElement), true);
        assert.equal(await f.page.locator('[data-story-detail-retry]').count(), 0);
        assert.equal(await f.page.locator('.story-detail-actions button').count(), 2);
        for (const selector of ['[data-story-purchase-confirm]', '[data-story-purchase-cancel]', '[data-story-close]']) {
          assert.equal(await f.page.locator(selector).evaluate((el) => {
            const r = el.getBoundingClientRect();
            return r.width >= 44 && r.height >= 44 && r.bottom <= innerHeight && r.top >= 0 && r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          }), true, selector);
        }
        assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
        assert.equal(await f.page.locator('.story-detail-body').evaluate((el) => el.getBoundingClientRect().bottom <= document.querySelector('.story-detail-actions').getBoundingClientRect().top + 1), true);
        assert.doesNotMatch(await dialog.innerText(), /SECRET_|STORY_|story\.purchase|66666666|cannot be purchased|developer/i);
        await f.page.screenshot({ path: path.join(artifacts, `${locale}-${width}-purchase.png`) });
        assert.equal(posts(f).length, 0);
      } finally { await f.close(); }
    });
  }
}
