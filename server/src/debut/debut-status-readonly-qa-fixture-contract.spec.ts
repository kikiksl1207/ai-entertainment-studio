import { DEBUT_STATUS_READONLY_QA_FIXTURE_CONTRACT } from './debut-status-readonly-qa-fixture-contract';

describe('debut status read-only QA fixture contract', () => {
  it('covers the public debut status matrix with locale fallback keys', () => {
    expect(DEBUT_STATUS_READONLY_QA_FIXTURE_CONTRACT.states.map((item) => item.debutStatusKey)).toEqual([
      'not_started',
      'submitted_reviewing',
      'needs_more_info',
      'approved',
      'rejected',
    ]);
    expect(DEBUT_STATUS_READONLY_QA_FIXTURE_CONTRACT.localeContract).toMatchObject({
      requiredLocales: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
      fallbackCopyKeyRequired: true,
      rawCopyReturned: false,
    });
  });

  it('keeps status fixtures separate from application and identity mutations', () => {
    expect(DEBUT_STATUS_READONLY_QA_FIXTURE_CONTRACT.mutationPolicy).toMatchObject({
      applicationSubmit: false,
      applicationResubmit: false,
      identityProviderCall: false,
      phoneVerification: false,
      assetUploadIntent: false,
      adminReviewMutation: false,
      walletMutation: false,
    });
    expect(DEBUT_STATUS_READONLY_QA_FIXTURE_CONTRACT.allowedOutput.join(' ')).not.toMatch(
      /phone|identity token|provider payload|real applicant|raw email|raw user id|storage key|database URL/i,
    );
  });
});
