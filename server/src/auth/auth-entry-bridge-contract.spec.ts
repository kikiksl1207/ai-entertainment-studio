import {
  AUTH_ACCOUNT_STATE_PROJECTION_BRIDGE,
  AUTH_ENTRY_STATUS_DASHBOARD_BRIDGE,
  AUTH_LIVE_QA_HANDOFF_SCHEMA,
  AUTH_PROTECTED_ENTRY_BRIDGE_CONTRACT,
  AUTH_SAFE_VISUAL_FIXTURE_CONTRACT,
  AUTH_SOCIAL_PROVIDER_FALLBACK_BRIDGE,
} from './auth-entry-bridge-contract';

describe('auth entry bridge contracts', () => {
  it('separates public preview from login-gated mutations', () => {
    expect(AUTH_PROTECTED_ENTRY_BRIDGE_CONTRACT.entryFields).toEqual([
      'surface',
      'requiredAccountState',
      'allowedPreview',
      'afterLoginAction',
      'mutationBlocked',
    ]);
    expect(
      AUTH_PROTECTED_ENTRY_BRIDGE_CONTRACT.surfaces.find(
        (surface) => surface.surface === 'story_preview',
      ),
    ).toMatchObject({ allowedPreview: true, mutationBlocked: false });
    expect(
      AUTH_PROTECTED_ENTRY_BRIDGE_CONTRACT.surfaces
        .filter((surface) => surface.surface !== 'story_preview')
        .every((surface) => surface.afterLoginAction.length > 0),
    ).toBe(true);
    expect(AUTH_PROTECTED_ENTRY_BRIDGE_CONTRACT.previewPolicy).toMatchObject({
      publicReadOnlyPreviewAllowed: true,
      uploadImportPublishMutationAllowedWithoutLogin: false,
      paymentWalletSettlementMutationAllowedFromBridge: false,
    });
  });

  it('projects account state without pushing social-only users to reset flow', () => {
    const socialOnly = AUTH_ACCOUNT_STATE_PROJECTION_BRIDGE.states.find(
      (state) => state.fixtureState === 'social_only_user',
    );

    expect(AUTH_ACCOUNT_STATE_PROJECTION_BRIDGE.projectionFields).toEqual([
      'emailVerified',
      'hasPassword',
      'isSocialOnly',
      'identityVerification',
      'settlementProfile',
      'recommendedAction',
    ]);
    expect(socialOnly).toMatchObject({
      hasPassword: false,
      isSocialOnly: true,
      recommendedAction: 'set_password',
    });
    expect(AUTH_ACCOUNT_STATE_PROJECTION_BRIDGE.socialOnlyPolicy).toEqual({
      passwordResetCtaAllowed: false,
      passwordSetupCtaRequired: true,
    });
  });

  it('keeps social provider fallback user-facing and mutation-free', () => {
    expect(AUTH_SOCIAL_PROVIDER_FALLBACK_BRIDGE.providerStates).toHaveLength(4);
    expect(
      AUTH_SOCIAL_PROVIDER_FALLBACK_BRIDGE.providerStates.every(
        (state) => state.emailLoginFallbackVisible && state.mutationAllowed === false,
      ),
    ).toBe(true);
    expect(Object.keys(AUTH_SOCIAL_PROVIDER_FALLBACK_BRIDGE.userFacingCopy)).toEqual([
      'ko',
      'en',
      'ja',
      'zh-Hans',
      'zh-Hant',
    ]);
  });

  it('defines a safe live QA handoff schema and blocked response', () => {
    expect(AUTH_LIVE_QA_HANDOFF_SCHEMA.allowedFields).toEqual([
      'runId',
      'accountType',
      'verifiedEmailState',
      'socialOnlyState',
      'environment',
      'readOnlyEndpoints',
      'blocked_by',
    ]);
    expect(AUTH_LIVE_QA_HANDOFF_SCHEMA.requiredWhenSafeAccountMissing).toMatchObject({
      blocked_by: 'safe QA account needed',
      mutationAllowed: false,
      liveLoginAttemptAllowed: false,
    });
    expect(AUTH_LIVE_QA_HANDOFF_SCHEMA.forbiddenFields).toEqual([
      'rawEmail',
      'password',
      'sessionToken',
      'cookie',
      'resetLink',
      'databaseUrl',
      'apiKey',
    ]);
  });

  it('publishes safe visual fixtures without action tokens or account identifiers', () => {
    const paths = [
      ...AUTH_SAFE_VISUAL_FIXTURE_CONTRACT.actionTokenLanding.publicPaths,
      ...AUTH_SAFE_VISUAL_FIXTURE_CONTRACT.accountStateVisual.publicPaths,
    ];
    const serialized = JSON.stringify(paths);

    expect(AUTH_SAFE_VISUAL_FIXTURE_CONTRACT.actionTokenLanding.tokenRequiredForFixture).toBe(false);
    expect(AUTH_SAFE_VISUAL_FIXTURE_CONTRACT.accountStateVisual.tokenRequiredForFixture).toBe(false);
    expect(AUTH_SAFE_VISUAL_FIXTURE_CONTRACT.actionTokenLanding.mutationAllowed).toBe(false);
    expect(AUTH_SAFE_VISUAL_FIXTURE_CONTRACT.accountStateVisual.mutationAllowed).toBe(false);
    expect(AUTH_SAFE_VISUAL_FIXTURE_CONTRACT.accountStateVisual).toMatchObject({
      socialOnlyPasswordResetVisible: false,
      passwordSetupGuidanceRequiredForSocialOnly: true,
    });
    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain('token=');
    expect(serialized).not.toContain('password=');
    expect(serialized).not.toContain('providerId=');
    expect(Object.values(AUTH_SAFE_VISUAL_FIXTURE_CONTRACT.privacy).every((value) => value === false)).toBe(true);
  });

  it('summarizes auth entry status for shared QA dashboard use', () => {
    expect(AUTH_ENTRY_STATUS_DASHBOARD_BRIDGE.columns).toEqual([
      'surface',
      'publicPreview',
      'loginRequired',
      'emailVerificationNotice',
      'socialOnlyNotice',
      'identityNotice',
      'mutationBlocked',
    ]);
    expect(AUTH_ENTRY_STATUS_DASHBOARD_BRIDGE.localeCopyLocales).toEqual([
      'ko',
      'en',
      'ja',
      'zh-Hans',
      'zh-Hant',
    ]);
    expect(
      AUTH_ENTRY_STATUS_DASHBOARD_BRIDGE.rows.find((row) => row.surface === 'debut'),
    ).toMatchObject({ publicPreview: true, identityNotice: true, mutationBlocked: true });
  });

  it('keeps all auth bridge responses public-safe', () => {
    const serialized = JSON.stringify([
      AUTH_PROTECTED_ENTRY_BRIDGE_CONTRACT.privacy,
      AUTH_ACCOUNT_STATE_PROJECTION_BRIDGE.privacy,
      AUTH_SOCIAL_PROVIDER_FALLBACK_BRIDGE.privacy,
      AUTH_ENTRY_STATUS_DASHBOARD_BRIDGE.privacy,
    ]);

    expect(serialized).not.toContain('@');
    expect(Object.values(AUTH_PROTECTED_ENTRY_BRIDGE_CONTRACT.privacy).every((value) => value === false)).toBe(true);
    expect(Object.values(AUTH_ACCOUNT_STATE_PROJECTION_BRIDGE.privacy).every((value) => value === false)).toBe(true);
    expect(Object.values(AUTH_SOCIAL_PROVIDER_FALLBACK_BRIDGE.privacy).every((value) => value === false)).toBe(true);
    expect(Object.values(AUTH_ENTRY_STATUS_DASHBOARD_BRIDGE.privacy).every((value) => value === false)).toBe(true);
  });
});
