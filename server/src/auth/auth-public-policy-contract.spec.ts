import {
  AUTH_EMAIL_VERIFICATION_GATE_POLICY_CONTRACT,
  AUTH_ERROR_PUBLIC_COPY_NORMALIZATION_CONTRACT,
} from './auth-public-policy-contract';

describe('auth public policy contracts', () => {
  it('pins email verification gate rules per mutation surface', () => {
    const policies = new Map(
      AUTH_EMAIL_VERIFICATION_GATE_POLICY_CONTRACT.policyTable.map((entry) => [
        entry.surface,
        entry,
      ]),
    );

    expect(policies.get('debut_application_submit')).toMatchObject({
      currentGate: 'soft_notice',
      mutationAllowedWhenUnverified: true,
      hardGateFlag: 'EMAIL_VERIFICATION_HARD_GATE_DEBUT',
      messageKey: 'auth.emailVerification.notice.debut',
    });
    expect(policies.get('paid_feature_wallet_mutation')).toMatchObject({
      currentGate: 'hard_gate_when_required',
      mutationAllowedWhenUnverified: false,
      messageKey: 'auth.emailVerification.required',
    });
    expect(
      AUTH_EMAIL_VERIFICATION_GATE_POLICY_CONTRACT.responsePolicy,
    ).toMatchObject({
      returnsEmailVerificationState: true,
      returnsRawEmail: false,
      returnsCredential: false,
      returnsToken: false,
      returnsCookie: false,
      stableMessageKeyRequired: true,
    });
  });

  it('normalizes auth errors through stable code/messageKey before public copy', () => {
    expect(AUTH_ERROR_PUBLIC_COPY_NORMALIZATION_CONTRACT.sourcePriority).toEqual([
      'messageKey',
      'code',
      'field key',
      'generic mode fallback',
    ]);
    expect(
      AUTH_ERROR_PUBLIC_COPY_NORMALIZATION_CONTRACT.normalizedErrors,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'AUTH_INVALID_CREDENTIALS',
          messageKey: 'auth.login.invalidCredentials',
          rawBackendMessageVisible: false,
        }),
        expect.objectContaining({
          code: 'AUTH_EMAIL_VERIFICATION_REQUIRED',
          messageKey: 'auth.emailVerification.required',
          rawBackendMessageVisible: false,
        }),
      ]),
    );
    expect(AUTH_ERROR_PUBLIC_COPY_NORMALIZATION_CONTRACT.fallbackPolicy).toMatchObject({
      loginUsesGenericCopy: true,
      registerUsesGenericCopy: true,
      unknownValidationUsesFieldGenericCopy: true,
      rawExceptionVisible: false,
      stackTraceVisible: false,
    });
  });

  it('keeps sensitive auth details out of public error output', () => {
    expect(AUTH_ERROR_PUBLIC_COPY_NORMALIZATION_CONTRACT.forbiddenPublicOutput).toEqual(
      expect.arrayContaining([
        'raw exception',
        'stack trace',
        'database detail',
        'provider credential',
        'token',
        'cookie',
        'password',
        'raw email',
      ]),
    );
  });
});
