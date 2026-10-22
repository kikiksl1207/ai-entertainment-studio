import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Text only; product modules are not executed.
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const a = read('backstage-content-rights.js');
const s = read('pages/content-rights-contract-ui.js');

test('required rate source contract', { timeout: 1000 }, () => {
  assert.ok(a.includes('field("salesAgencyShareBps").value = "";'));
  assert.ok(a.includes('version.shares?.salesAgencyBps ?? "";'));
  for (const k of ['authorRightsHolderShareBps', 'salesAgencyShareBps'])
    assert.ok(a.includes(`${k}: field("${k}").value`));
  assert.doesNotMatch(a, /salesAgencyBps \?\? 0|salesAgencyShareBps"\)\.value = "0"|ShareBps: Number/);
  assert.match(s, /const rates = \[values\.authorRightsHolderShareBps, values\.salesAgencyShareBps\];\s+if \(!rates\.every\(\(value\) => typeof value === "number" \|\| \(typeof value === "string" && value\.trim\(\) !== ""\)\)\) throw new Error\("invalid"\);\s+const agencyBps = Number\(rates\[1\]\);\s+const creatorBps = Number\(rates\[0\]\);/);
  assert.ok(s.includes('creatorBps < 0 || creatorBps > 5000 || agencyBps < 0 || agencyBps > 1000 || creatorBps + agencyBps > 5500'));
});
