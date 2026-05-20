import { AUTH_QA_ACCOUNT_ACCESS_CONTRACT } from './auth-qa-account-contract';

describe('auth QA account access contract', () => {
  it('separates normal user, creator, and backstage admin QA accounts', () => {
    const accounts = AUTH_QA_ACCOUNT_ACCESS_CONTRACT.accounts;
    const byKey = new Map(accounts.map((account) => [account.key, account]));

    expect([...byKey.keys()]).toEqual(['QA_USER', 'QA_CREATOR', 'QA_ADMIN']);
    expect(byKey.get('QA_USER')).toMatchObject({
      mayUseForBackstageWrite: false,
      mayUseForCreatorStudio: false,
      requiredState: {
        userStatus: 'active',
        adminAccessRequired: false,
        artistOperatorRequired: false,
      },
    });
    expect(byKey.get('QA_CREATOR')).toMatchObject({
      mayUseForBackstageWrite: false,
      mayUseForCreatorStudio: true,
      requiredState: {
        artistOperatorRequired: true,
        artistOperatorStatus: 'active',
      },
    });
    expect(byKey.get('QA_ADMIN')).toMatchObject({
      mayUseForBackstageWrite: true,
      requiredState: {
        adminAccessRequired: true,
        adminAccessStatus: 'active',
        adminRoleName: 'super_admin',
        adminPermissions: ['*'],
      },
    });
  });

  it('keeps secrets out of the QA account handoff contract', () => {
    const payload = JSON.stringify(AUTH_QA_ACCOUNT_ACCESS_CONTRACT);

    expect(AUTH_QA_ACCOUNT_ACCESS_CONTRACT.sensitiveValuesRecorded).toBe(false);
    expect(payload).not.toMatch(/password=/i);
    expect(payload).not.toMatch(/bearer\s+[a-z0-9._-]+/i);
    expect(payload).not.toMatch(/eyJ[a-z0-9._-]+/i);
    expect(payload).not.toMatch(/postgres(ql)?:\/\//i);
    expect(payload).not.toMatch(/cookie:/i);
  });
});
