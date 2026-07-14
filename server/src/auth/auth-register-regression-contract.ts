export const AUTH_REGISTER_REGRESSION_CONTRACT = {
  version: '2026-07-13.auth-register-regression.v1',
  status: 'safe_source_regression_ready',
  publicPaths: [
    '/api/v1/auth/register',
    '/api/v1/auth/email-verifications',
    '/api/v1/auth/email-verifications/confirm',
  ],
  checks: [
    'registration_validation_rejects_missing_or_invalid_fields',
    'duplicate_identity_uses_non_enumerating_public_failure',
    'verification_request_uses_generic_delivery_result',
    'invalid_expired_and_used_confirmation_are_stable',
    'register_and_verification_routes_are_rate_limited',
    'successful_existing_login_refresh_logout_remain_unchanged',
  ],
  fixture: {
    readOnly: true,
    createsAccount: false,
    sendsVerification: false,
    confirmsVerification: false,
    rotatesSession: false,
    recordsOnly: ['runId', 'publicPath', 'status', 'booleanChecks'],
  },
  privacy: {
    rawAccountIdentifier: false,
    credentialValue: false,
    actionCode: false,
    sessionMaterial: false,
    providerPayload: false,
  },
} as const;
