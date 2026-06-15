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

  it('pins account session invalidation and social-only password guard policy', () => {
    expect(AUTH_QA_ACCOUNT_ACCESS_CONTRACT.accountSecurity).toMatchObject({
      passwordReset: {
        consumesActionTokenOnce: true,
        updatesEmailPasswordHashOnly: true,
        revokesActiveRefreshSessions: true,
        rawTokenReturned: false,
        passwordReturned: false,
      },
      passwordChange: {
        requiresExistingEmailPasswordHash: true,
        socialOnlyChangePasswordBlocked: true,
        successfulChangeRevokesActiveRefreshSessions: true,
        rawCurrentPasswordLogged: false,
        rawNewPasswordLogged: false,
      },
      socialOnlyProjection: {
        sourceOfTruth: 'user_auth_accounts',
        myPageSettingsProjectionSource: 'GET /api/v1/me',
        emailPasswordProjectionSource: 'user_auth_accounts.passwordHash',
        exposesProviderKind: true,
        exposesHasPasswordBoolean: true,
        exposesIsSocialOnlyBoolean: true,
        passwordResetCtaAllowed: false,
        passwordSetupSurfaceAllowed: true,
        rawStatusCopyReturned: false,
        exposesProviderCredential: false,
        exposesCookieOrToken: false,
      },
    });
  });

  it('defines the sanitized live access self-check for QA creator and admin', () => {
    expect(AUTH_QA_ACCOUNT_ACCESS_CONTRACT.liveAccessSelfCheck).toMatchObject({
      task: '#458',
      script: 'npm run qa:auth-access-self-check',
      confirmEnv: 'AUTH_QA_ACCESS_VERIFY_CONFIRM',
      confirmValue: 'VERIFY_AUTH_QA_ACCESS_SELF_CHECK',
      requiredSlotGroups: [
        expect.objectContaining({
          key: 'qa_creator',
          requiredSlots: ['QA_CREATOR_EMAIL', 'QA_CREATOR_PASSWORD'],
          passCriteria: expect.objectContaining({
            creatorStudioAccessEnabled: true,
            artistOperatorAccess: true,
            accessSource: 'artist_operator',
          }),
        }),
        expect.objectContaining({
          key: 'qa_admin',
          requiredSlots: ['QA_ADMIN_EMAIL', 'QA_ADMIN_PASSWORD'],
          passCriteria: expect.objectContaining({
            adminAccessEnabled: true,
            roleKind: 'super_admin',
            hasWildcardPermission: true,
            backstageSummaryAccess: true,
          }),
        }),
      ],
    });
    expect(AUTH_QA_ACCOUNT_ACCESS_CONTRACT.liveAccessSelfCheck.allowedOutput).toEqual(
      expect.arrayContaining([
        'HTTP status',
        'access enabled booleans',
        'safe role kind',
        'permission booleans',
        'nextOwner routing key',
      ]),
    );
    expect(AUTH_QA_ACCOUNT_ACCESS_CONTRACT.liveAccessSelfCheck.forbiddenOutput).toEqual(
      expect.arrayContaining([
        'raw email',
        'password',
        'access token',
        'cookie',
        'raw response body',
        'environment value',
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
