import {
  AUTH_SAFE_QA_FIXTURE_CONTRACT_PACK,
  EMAIL_RESET_SAFE_INBOX_FIXTURE_CONTRACT,
} from '../auth/auth-safe-qa-fixture-contract';
import { DEBUT_STATUS_READONLY_QA_FIXTURE_CONTRACT } from '../debut/debut-status-readonly-qa-fixture-contract';
import { STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT } from '../story-stage/story-branch-scene-authority-contract';
import { WALLET_READONLY_QA_FIXTURE_CONTRACT } from '../wallet/wallet-readonly-qa-fixture-contract';
import {
  findUnsafeQaFixtureOutputKeys,
  isSafeQaFixtureActivationAllowed,
  SAFE_QA_FIXTURE_SOURCE_GUARD_CONTRACT,
} from './safe-qa-fixture-source-guard-contract';

describe('safe QA fixture no-secret source guard', () => {
  it('never activates in production and requires both development gates', () => {
    expect(
      isSafeQaFixtureActivationAllowed({
        runtimeEnvironment: 'production',
        explicitFixtureFlag: true,
        serverAllowlisted: true,
      }),
    ).toBe(false);
    expect(
      isSafeQaFixtureActivationAllowed({
        runtimeEnvironment: 'test',
        explicitFixtureFlag: false,
        serverAllowlisted: true,
      }),
    ).toBe(false);
    expect(
      isSafeQaFixtureActivationAllowed({
        runtimeEnvironment: 'development',
        explicitFixtureFlag: true,
        serverAllowlisted: true,
      }),
    ).toBe(true);
  });

  it('rejects secret-bearing output keys without rejecting public key fields', () => {
    expect(
      findUnsafeQaFixtureOutputKeys([
        'runId',
        'publicPath',
        'messageKey',
        'safe boolean flags',
      ]),
    ).toEqual([]);
    expect(
      findUnsafeQaFixtureOutputKeys([
        'rawEmail',
        'password',
        'access_token',
        'databaseUrl',
        'walletLedgerId',
      ]),
    ).toEqual([
      'rawEmail',
      'password',
      'access_token',
      'databaseUrl',
      'walletLedgerId',
    ]);
  });

  it('binds every QA contract to the same read-only source guard', () => {
    const contracts = [
      AUTH_SAFE_QA_FIXTURE_CONTRACT_PACK,
      EMAIL_RESET_SAFE_INBOX_FIXTURE_CONTRACT,
      WALLET_READONLY_QA_FIXTURE_CONTRACT,
      DEBUT_STATUS_READONLY_QA_FIXTURE_CONTRACT,
      STORY_BRANCH_SCENE_AUTHORITY_AUDIT_CONTRACT,
    ];

    for (const contract of contracts) {
      expect(contract.endpoint).toMatch(/^GET /);
      expect(contract.sourceGuard).toBe(
        SAFE_QA_FIXTURE_SOURCE_GUARD_CONTRACT,
      );
      expect(findUnsafeQaFixtureOutputKeys(contract.allowedOutput)).toEqual([]);
    }

    expect(
      Object.values(SAFE_QA_FIXTURE_SOURCE_GUARD_CONTRACT.mutationPolicy).every(
        (allowed) => allowed === false,
      ),
    ).toBe(true);
  });
});
