import { HttpException } from '@nestjs/common';
import {
  CONTENT_RIGHTS_CONFIGURATION_BOUNDARY,
  INTERNAL_GENERATION_COST_TREATMENT,
  assertCreatorPartyMatchesOwner,
  parseCreateContentContract,
} from './content-rights-contract.contract';

const workId = '00000000-0000-4000-8000-000000001892';
const versionId = '00000000-0000-4000-8000-000000001893';
const ownerId = '00000000-0000-4000-8000-000000001894';
const agencyUserId = '00000000-0000-4000-8000-000000001895';

function request(authorShare = 4500, salesShare = 500): Record<string, unknown> {
  return {
    workType: 'story',
    workId,
    contentVersionId: versionId,
    exclusivity: 'nonexclusive',
    media: ['story_publication', 'translation'],
    regions: ['KR', 'JP'],
    startsAt: '2026-10-01T00:00:00Z',
    endsAt: '2027-10-01T00:00:00Z',
    saleAllowed: true,
    aiTransformationAllowed: false,
    generatedResultReuseAllowed: false,
    effectiveFrom: '2026-09-21T00:00:00Z',
    authorRightsHolderShareBps: authorShare,
    salesAgencyShareBps: salesShare,
    pointUsagePolicy: 'unresolved',
    refundReversalPolicy: 'unresolved',
    paidPointPolicy: 'unresolved',
    bonusPointPolicy: 'unresolved',
    vatPolicy: 'unresolved',
    internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT,
    parties: [
      { role: 'author', userId: ownerId },
      ...(salesShare > 0
        ? [{ role: 'sales_agency', userId: agencyUserId, agencyIdentifier: 'agency:seoul-01' }]
        : []),
    ],
  };
}

describe('content rights contract policy', () => {
  it.each([
    [4500, 500, 5000],
    [5000, 500, 4500],
    [3000, 1000, 6000],
  ])('accepts configurable %i/%i and derives company %i', (author, sales, company) => {
    expect(parseCreateContentContract(request(author, sales))).toMatchObject({
      authorRightsHolderShareBps: author,
      salesAgencyShareBps: sales,
      companyShareBps: company,
    });
  });

  it.each([
    [5001, 0],
    [4500, 1001],
    [5000, 1000],
  ])('rejects out-of-policy revenue shares %i/%i', (author, sales) => {
    expect(() => parseCreateContentContract(request(author, sales))).toThrow(HttpException);
  });

  it('requires the creator beneficiary to be the persisted work owner', () => {
    const parsed = parseCreateContentContract(request());
    expect(() => assertCreatorPartyMatchesOwner(ownerId, parsed)).not.toThrow();
    expect(() => assertCreatorPartyMatchesOwner(agencyUserId, parsed)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'CONTENT_RIGHTS_CONFLICT' }) }),
    );
  });

  it.each(['rawContract', 'email', 'legalName', 'bankAccount', 'taxId']) (
    'rejects forbidden/unmodeled %s input instead of persisting PII or documents',
    (field) => {
      expect(() => parseCreateContentContract({ ...request(), [field]: 'private' })).toThrow(HttpException);
    },
  );

  it('keeps unresolved policies unresolved and generation cost outside creator share', () => {
    expect(() => parseCreateContentContract({ ...request(), vatPolicy: 'included' })).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'CONTENT_RIGHTS_POLICY_UNRESOLVED' }) }),
    );
    expect(() => parseCreateContentContract({
      ...request(),
      internalGenerationCostTreatment: 'deduct_from_creator_share',
    })).toThrow(HttpException);
  });

  it('isolates the old after-cost 80% preview and forbids money mutations', () => {
    expect(CONTENT_RIGHTS_CONFIGURATION_BOUNDARY).toMatchObject({
      legalActivation: false,
      settlementAccrualMutation: false,
      payoutMutation: false,
      paymentMutation: false,
      legacyPreviewConflict: {
        detected: true,
        policy: 'fixed_after_cost_80_percent_preview',
        isolated: true,
        acceptedAsContractOrSettlementInput: false,
      },
    });
  });
});
