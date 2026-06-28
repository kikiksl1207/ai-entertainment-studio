import { QA_FIXTURE_HANDOFF_CONTRACT } from './qa-fixture-handoff-contract';

describe('QA fixture handoff contract', () => {
  it('allows only non-secret handoff fields for cross-worker QA', () => {
    expect(QA_FIXTURE_HANDOFF_CONTRACT.allowedOutput).toEqual(
      expect.arrayContaining([
        'runId',
        'fixtureStatus',
        'publicProfileHandle',
        'publicProfilePath',
        'followersApiPath',
        'followingApiPath',
        'blockApiPath',
        'stable code/messageKey',
        'nextOwner routing key',
      ]),
    );
    expect(QA_FIXTURE_HANDOFF_CONTRACT.forbiddenOutput).toEqual(
      expect.arrayContaining([
        'raw email',
        'password',
        'access token',
        'refresh token',
        'cookie',
        'API key',
        'database URL',
        'raw session id',
        'provider credential',
        'environment value',
      ]),
    );
  });

  it('keeps confirmed runs approved and isolated from real users or paid systems', () => {
    expect(QA_FIXTURE_HANDOFF_CONTRACT.handoffRules).toMatchObject({
      productionAutoSeed: false,
      realUserFixtureMixing: false,
      confirmedRunRequiresApprovedEnvironment: true,
      dryRunOutputIsNotLivePassEvidence: true,
      recordOnlyNonSecretHandoffFields: true,
      nextOwnerRequired: true,
    });
    expect(QA_FIXTURE_HANDOFF_CONTRACT.mutationBoundaries).toMatchObject({
      followBlockFixtureConfirmedRun: 'qa_only_disposable_rows_after_approval',
      realUserFollowBlockMutation: false,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
      accountPasswordMutation: false,
      sessionMinting: false,
    });
  });
});
