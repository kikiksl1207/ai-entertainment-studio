import { AUTH_QA_ACCOUNT_ACCESS_CONTRACT } from './auth-qa-account-contract';

describe('auth QA account access contract', () => {
  it('separates normal user, creator, and backstage admin QA accounts', () => {
    const accounts = AUTH_QA_ACCOUNT_ACCESS_CONTRACT.accounts;
    const byKey = new Map(accounts.map((account) => [account.key, account]));

    expect([...byKey.keys()]).toEqual([
      'QA_USER',
      'QA_CREATOR',
      'QA_ADMIN',
      'QA_VERIFIED_EMAIL',
      'QA_SOCIAL_ONLY',
    ]);
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
    expect(byKey.get('QA_VERIFIED_EMAIL')).toMatchObject({
      mayUseForBackstageWrite: false,
      mayUseForCreatorStudio: false,
      credentialSlots: ['QA_VERIFIED_EMAIL', 'QA_VERIFIED_PASSWORD'],
      requiredState: {
        provider: 'email',
        emailVerified: true,
        emailVerificationStatus: 'verified',
        hasPassword: true,
        isSocialOnly: false,
      },
    });
    expect(byKey.get('QA_SOCIAL_ONLY')).toMatchObject({
      mayUseForBackstageWrite: false,
      mayUseForCreatorStudio: false,
      credentialSlots: ['QA_SOCIAL_PROVIDER', 'QA_SOCIAL_EMAIL', 'QA_SOCIAL_PASSWORD'],
      requiredState: {
        emailProviderPasswordRequired: false,
        hasPassword: false,
        isSocialOnly: true,
      },
    });
  });

  it('defines private credential source slots for verified and social-only QA', () => {
    expect(AUTH_QA_ACCOUNT_ACCESS_CONTRACT.credentialSource.rawValuePolicy).toMatchObject({
      git: false,
      notion: false,
      chat: false,
      logs: false,
    });
    expect(AUTH_QA_ACCOUNT_ACCESS_CONTRACT.credentialSource.requiredSlotGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'verified_email_password',
          requiredSlots: ['QA_VERIFIED_EMAIL', 'QA_VERIFIED_PASSWORD'],
          expectedProjection: expect.objectContaining({
            emailVerified: true,
            hasPassword: true,
            isSocialOnly: false,
          }),
        }),
        expect.objectContaining({
          key: 'social_only_manual_provider',
          requiredSlots: ['QA_SOCIAL_PROVIDER', 'QA_SOCIAL_EMAIL', 'QA_SOCIAL_PASSWORD'],
          expectedProjection: expect.objectContaining({
            hasPassword: false,
            isSocialOnly: true,
          }),
        }),
      ]),
    );
  });

  it('keeps secrets out of the QA account handoff contract', () => {
    const payload = JSON.stringify(AUTH_QA_ACCOUNT_ACCESS_CONTRACT);

    expect(AUTH_QA_ACCOUNT_ACCESS_CONTRACT.sensitiveValuesRecorded).toBe(false);
    expect(payload).not.toMatch(/(?:^|[^A-Za-z])password\s*=/i);
    expect(payload).not.toMatch(/bearer\s+[a-z0-9._-]+/i);
    expect(payload).not.toMatch(/eyJ[a-z0-9._-]+/i);
    expect(payload).not.toMatch(/postgres(ql)?:\/\//i);
    expect(payload).not.toMatch(/cookie:/i);
  });
});
