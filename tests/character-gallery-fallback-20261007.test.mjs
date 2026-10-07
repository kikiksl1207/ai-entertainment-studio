import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { captureBinding, directEvidence, Element, harness, sha256 } from './support/character-gallery-fallback-20261007.mjs';

const sourcePath = process.env.GALLERY_FALLBACK_SOURCE || fileURLToPath(new URL('../pages/character-detail.js', import.meta.url));
const phase = process.env.GALLERY_FALLBACK_PHASE || 'fixed';
assert(['baseline', 'fixed'].includes(phase));
const bytes = readFileSync(sourcePath), source = bytes.toString('utf8'), binding = captureBinding(source);
if (process.env.GALLERY_FALLBACK_SHA256) assert.equal(sha256(bytes), process.env.GALLERY_FALLBACK_SHA256);
const guarded = /if \(slide\.querySelector\((?:"|')\[data-gallery-recovery\](?:"|')\)\) return;/.test(binding.body);
assert.equal(guarded, phase === 'fixed', 'Use actual parent-inserted guard only for fixed phase');
const evidence = directEvidence({ phase, source: sourcePath, sourceSha256: sha256(bytes),
  binding: { name: binding.name, line: binding.line, sha256: binding.sha256, renderSha256: binding.renderSha256 }, guarded });
const check = (name, callback) => {
  evidence.registered.push(name);
  test(name, () => { callback(); evidence.completed.push(name); });
};
test.after(() => { evidence.allAfterHooksFinished = true; });
const unchanged = (h, cell, before) => {
  const after = h.snapshot(cell); delete after.captureEvents;
  const expected = { ...before }; delete expected.captureEvents;
  assert.deepEqual(after, expected);
};
const legacyRemoved = (h, cell) => {
  const state = h.snapshot(cell);
  assert.equal(state.imageAttached, false); assert.equal(state.parentIsOriginal, false); assert.equal(state.removed, 1);
  assert.equal(state.lightbox, null); assert.equal(state.cursor, 'default'); assert.equal(state.unavailable, true);
};

if (phase === 'baseline') {
  check('published baseline reproduces managed image removal, lightbox stripping and cursor reset in capture phase', () => {
    const h = harness(source), cell = h.slide({ managed: true });
    const before = h.snapshot(cell); h.dispatchError(cell.image);
    legacyRemoved(h, cell); assert.equal(cell.recovery.isConnected, true);
    assert.deepEqual(h.events, [{ phase: 'capture', bubbles: false, target: 'IMG' }]);
    evidence.observations.push({ name: 'managed-capture-conflict', before, after: h.snapshot(cell),
      imageRemovedDespiteOwnRecoveryMarker: true, fullPageSliderRetryOrDecodeNotExecuted: true });
  });
} else {
  check('managed first error without retried flag preserves the attached image and all legacy slide state', () => {
    const h = harness(source), cell = h.slide({ managed: true }); delete cell.image.dataset.retried;
    const before = h.snapshot(cell); h.dispatchError(cell.image); unchanged(h, cell, before);
  });

  check('managed retried1 error preserves the image, lightbox and cursor under the actual capture callback', () => {
    const h = harness(source), cell = h.slide({ managed: true }), before = h.snapshot(cell);
    h.dispatchError(cell.image); unchanged(h, cell, before); assert.equal(h.events.length, 1);
    evidence.observations.push({ name: 'managed-capture-preserved', before, after: h.snapshot(cell) });
  });

  check('repeated managed errors remain attached and do not accumulate legacy fallback mutations', () => {
    const h = harness(source), cell = h.slide({ managed: true }), before = h.snapshot(cell);
    for (let index = 0; index < 3; index++) h.dispatchError(cell.image);
    unchanged(h, cell, before); assert.equal(h.events.length, 3);
  });

  check('unmanaged legacy retried1 still removes the image and applies the entire original fallback', () => {
    const h = harness(source), cell = h.slide(); h.dispatchError(cell.image); legacyRemoved(h, cell);
    evidence.observations.push({ name: 'unmanaged-legacy-preserved', state: h.snapshot(cell) });
  });

  check('unmanaged errors with absent,0,boolean or numeric retry flags keep the original strict-string contract', () => {
    for (const retried of [undefined, '0', true, 1]) {
      const h = harness(source), cell = h.slide();
      if (retried === undefined) delete cell.image.dataset.retried; else cell.image.dataset.retried = retried;
      const before = h.snapshot(cell); h.dispatchError(cell.image); unchanged(h, cell, before);
    }
  });

  check('marker in another slide or on the gallery ancestor does not protect an unmanaged slide', () => {
    const h = harness(source); h.slide({ managed: true });
    const elsewhere = new Element('button'); elsewhere.setAttribute('data-gallery-recovery', ''); h.gallery.append(elsewhere);
    const cell = h.slide(); h.dispatchError(cell.image); legacyRemoved(h, cell);
  });

  check('nested own recovery marker protects a nested image through closest-slide and descendant-query semantics', () => {
    const h = harness(source), cell = h.slide({ managed: true, nestedImage: true, nestedMarker: true }), before = h.snapshot(cell);
    h.dispatchError(cell.image); unchanged(h, cell, before);
  });

  check('non-gallery images, non-image descendants and gallery-container errors remain no-ops', () => {
    const h = harness(source), image = new Element('img'); image.dataset.retried = '1'; h.gallery.append(image);
    h.dispatchError(image); assert.equal(image.isConnected, true); assert.equal(image.removals, 0);
    const cell = h.slide(), span = new Element('span'); span.dataset.retried = '1'; cell.slide.append(span);
    const before = h.snapshot(cell); h.dispatchError(span); h.dispatchError(h.gallery); unchanged(h, cell, before);
    assert.equal(span.isConnected, true);
  });

  check('null and malformed raw callback targets retain existing TypeError behavior before DOM mutation', () => {
    const h = harness(source), cell = h.slide({ managed: true }), before = h.snapshot(cell);
    for (const target of [null, undefined, {}, { matches: false }]) assert.throws(() => h.rawCallback(target), { name: 'TypeError' });
    unchanged(h, cell, before);
    evidence.observations.push({ name: 'invalid-target-contract', rawCallbackThrowsTypeError: true, domUnchanged: true,
      invalidTargetsNotRealDomErrorEvents: true, noNewNullSafetyPromise: true });
  });

  check('bind-once gallery survives cell rerender; old detached errors do not reach capture and new cells do', () => {
    const h = harness(source), old = h.slide({ managed: true }); old.slide.remove(); h.bind();
    assert.equal(h.gallery.listeners.get('error').length, 1); assert.equal(h.gallery.dataset.imageFallbackBound, '1');
    h.dispatchError(old.image); assert.equal(h.events.length, 0); assert.equal(old.image.removals, 0);
    const managed = h.slide({ managed: true }), before = h.snapshot(managed); h.dispatchError(managed.image); unchanged(h, managed, before);
    const legacy = h.slide(); h.dispatchError(legacy.image); legacyRemoved(h, legacy);
    assert.equal(h.events.length, 2);
  });

  check('non-bubbling DOM error reaches the actual capture binding without any bubble listener', () => {
    const h = harness(source), cell = h.slide({ managed: true }); let bubbles = 0;
    h.gallery.addEventListener('error', () => { bubbles++; }, { capture: false });
    const before = h.snapshot(cell); h.dispatchError(cell.image, { bubbles: false }); unchanged(h, cell, before);
    assert.equal(bubbles, 0); assert.deepEqual(h.events, [{ phase: 'capture', bubbles: false, target: 'IMG' }]);
  });

  check('removing the managed marker restores the exact legacy fallback on the next retried error', () => {
    const h = harness(source), cell = h.slide({ managed: true }), before = h.snapshot(cell);
    h.dispatchError(cell.image); unchanged(h, cell, before); cell.recovery.remove();
    h.dispatchError(cell.image); legacyRemoved(h, cell); assert.equal(h.events.length, 2);
  });
}
