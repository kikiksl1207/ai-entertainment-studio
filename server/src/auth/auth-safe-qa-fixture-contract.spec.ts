import {
  AUTH_SAFE_QA_FIXTURE_CONTRACT_PACK,
  EMAIL_RESET_SAFE_INBOX_FIXTURE_CONTRACT,
} from './auth-safe-qa-fixture-contract';

describe('auth safe QA fixture contracts', () => {
  it('covers auth entry states without account credentials or session secrets', () => {
    expect(AUTH_SAFE_QA_FIXTURE_CONTRACT_PACK.scenarios.map((item) => item.authStateKey)).toEqual(
      expect.arrayContaining([
        'logged_out',
        'logged_in',
        'login_required',
        'session_expired',
      ]),
    );
    expect(AUTH_SAFE_QA_FIXTURE_CONTRACT_PACK.localeContract.requiredLocales).toEqual([
      'ko',
      'en',
      'ja',
      'zh-Hans',
      'zh-Hant',
    ]);
    expect(AUTH_SAFE_QA_FIXTURE_CONTRACT_PACK.viewportContract.requiredWidthsPx).toEqual(
      expect.arrayContaining([390, 400]),
    );
    expect(AUTH_SAFE_QA_FIXTURE_CONTRACT_PACK.mutationPolicy).toMatchObject({
      createsUser: false,
      logsInUser: false,
      mintsSession: false,
      refreshesSession: false,
      revokesSession: false,
      accountMutation: false,
      passwordMutation: false,
      walletMutation: false,
    });
    expect(AUTH_SAFE_QA_FIXTURE_CONTRACT_PACK.allowedOutput.join(' ')).not.toMatch(
      /raw email|password|access token|refresh token|cookie|provider id|database URL/i,
    );
  });

  it('previews reset inbox states without reading inboxes or exposing reset tokens', () => {
    expect(EMAIL_RESET_SAFE_INBOX_FIXTURE_CONTRACT.resetStates.map((item) => item.resetStateKey)).toEqual(
      [
        'request_success',
        'token_expired',
        'token_invalid',
        'token_already_used',
      ],
    );
    expect(EMAIL_RESET_SAFE_INBOX_FIXTURE_CONTRACT.guard).toMatchObject({
      qaFixtureFlagRequired: true,
      productionMutationSeparated: true,
      realInboxRead: false,
      providerSend: false,
      tokenLookup: false,
      tokenConsume: false,
      passwordUpdate: false,
    });
    expect(EMAIL_RESET_SAFE_INBOX_FIXTURE_CONTRACT.allowedOutput.join(' ')).not.toMatch(
      /raw email|reset link|reset token|token hash|provider payload|password|cookie|database URL/i,
    );
    expect(
      EMAIL_RESET_SAFE_INBOX_FIXTURE_CONTRACT.resetStates.every((item) => item.canSavePassword === false),
    ).toBe(true);
  });
});
