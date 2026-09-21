import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const commonSource = readFileSync(new URL('../pages/content-rights-contract-ui.js', import.meta.url), 'utf8');
const creatorSource = readFileSync(new URL('../pages/creator-content-rights.js', import.meta.url), 'utf8');
const adminSource = readFileSync(new URL('../backstage-content-rights.js', import.meta.url), 'utf8');
const creatorHtml = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const creatorCss = readFileSync(new URL('../styles/creator-studio.css', import.meta.url), 'utf8');
const adminCss = readFileSync(new URL('../backstage.css', import.meta.url), 'utf8');

function helpers(locale = 'ko') {
  const window = { luminaI18n: { getLocale: () => locale } };
  vm.runInNewContext(commonSource, { window, localStorage: { getItem: () => locale }, Intl, Date });
  return window.LuminaContentRightsUI;
}

const authorId = '11111111-1111-4111-8111-111111111111';
const agencyId = '22222222-2222-4222-8222-222222222222';
const version = {
  id: '33333333-3333-4333-8333-333333333333', revision: 2, contentVersionId: '44444444-4444-4444-8444-444444444444',
  exclusivity: 'exclusive', media: ['story_publication', 'translation'], regions: ['WORLDWIDE'],
  startsAt: '2026-09-21T00:00:00.000Z', endsAt: null, effectiveFrom: '2026-10-01T00:00:00.000Z', approvalState: 'draft',
  saleAllowed: true, aiTransformationAllowed: false, generatedResultReuseAllowed: false,
  parties: [{ role: 'author', userId: authorId, agencyIdentifier: null, shareBps: 4500 }]
};
const contract = { id: '55555555-5555-4555-8555-555555555555', workType: 'story', workId: '66666666-6666-4666-8666-666666666666', versions: [version] };

test('party UI consumes the server-minimized signed-in party response', () => {
  const ui = helpers();
  const author = ui.partyView(contract, authorId);
  assert.equal(author.versions[0].role, 'author');
  assert.equal(author.versions[0].ownBps, 4500);
  const agencyContract = {
    ...contract,
    versions: [{ ...version, parties: [{ role: 'sales_agency', userId: agencyId, agencyIdentifier: 'agency-one', shareBps: 500 }] }]
  };
  const agency = ui.partyView(agencyContract, agencyId);
  assert.equal(agency.versions[0].role, 'sales_agency');
  assert.equal(agency.versions[0].ownBps, 500);
  assert.equal(agency.versions[0].agencyIdentifier, 'agency-one');
  const serialized = JSON.stringify(author);
  assert.doesNotMatch(serialized, /companyBps|authorRightsHolderBps|salesAgencyBps|parties|userId|internalGenerationCostTreatment|audit|policy/);
  assert.equal(ui.partyView(contract, agencyId), null);
  assert.equal(ui.partyView(contract, '77777777-7777-4777-8777-777777777777'), null);
});

test('admin configuration payload preserves unresolved policy boundary and exact shares', () => {
  const payload = helpers().configuration({
    workId: contract.workId, contentVersionId: version.contentVersionId, exclusivity: 'exclusive', media: ['story_publication'], regions: 'WORLDWIDE',
    startsAt: '2026-09-21T09:00', endsAt: '', effectiveFrom: '2026-10-01T09:00', creatorRole: 'author', creatorUserId: authorId,
    authorRightsHolderShareBps: 4500, agencyIdentifier: 'agency-one', agencyUserId: agencyId, salesAgencyShareBps: 500,
    saleAllowed: true, aiTransformationAllowed: false, generatedResultReuseAllowed: false
  });
  assert.equal(payload.authorRightsHolderShareBps, 4500);
  assert.equal(payload.salesAgencyShareBps, 500);
  assert.equal(payload.vatPolicy, 'unresolved');
  assert.equal(payload.refundReversalPolicy, 'unresolved');
  assert.equal(payload.internalGenerationCostTreatment, 'company_internal_cost_not_deducted_from_creator_share');
  assert.equal(payload.parties.length, 2);
});

test('UI uses only #1892 contract endpoints and clearly isolates the legacy 80 percent preview', () => {
  assert.match(creatorSource, /\/api\/v1\/me\/creator-studio\/content-rights-contracts/);
  assert.match(adminSource, /\/admin\/api\/v1\/content-rights-contracts/);
  assert.match(adminSource, /\/revisions/);
  assert.doesNotMatch(`${creatorSource}\n${adminSource}`, /payment|payout.*POST|settlement-preview/);
  assert.match(creatorHtml, /id="legacySettlementIsolation"/);
  assert.match(creatorHtml, /80%.*권리 계약.*아닙니다/);
});

test('five locales provide pending-policy and settlement-empty language', () => {
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    const ui = helpers(locale);
    assert.notEqual(ui.t('pendingTitle'), 'pendingTitle');
    assert.notEqual(ui.t('pendingBody'), 'pendingBody');
    assert.notEqual(ui.t('policyBoundary'), 'policyBoundary');
  }
});

test('creator and admin layouts collapse to one column on 390 and 400px widths', () => {
  assert.match(creatorCss, /@media \(max-width: 680px\)[\s\S]*?\.content-rights-version dl \{ grid-template-columns: 1fr; \}/);
  assert.match(adminCss, /@media \(max-width: 760px\)[\s\S]*?\.content-rights-admin-fields, \.content-rights-admin-versions dl \{ grid-template-columns: 1fr; \}/);
});
