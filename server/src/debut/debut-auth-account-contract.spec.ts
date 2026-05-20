import { DEBUT_AUTH_ACCOUNT_GAP_CONTRACT } from './debut-auth-account-contract';

describe('debut auth account gap contract', () => {
  it('keeps debut submit authenticated while documenting non-hard gates', () => {
    expect(DEBUT_AUTH_ACCOUNT_GAP_CONTRACT.endpoints.submitApplication).toMatchObject({
      authRequired: true,
      guard: 'JwtAuthGuard',
      emailVerificationRequired: false,
      passwordRequiredForSocialOnlyUser: false,
      identityProviderRequired: false,
      adultSelfDeclarationRequired: true,
      verifiedMinorBlocked: true,
    });
  });

  it('documents account-state allow and block rules with stable keys', () => {
    const states = new Map(
      DEBUT_AUTH_ACCOUNT_GAP_CONTRACT.accountStates.map((state) => [
        state.key,
        state,
      ]),
    );

    expect(states.get('logged_out')).toMatchObject({
      applicationSubmitAllowed: false,
      reasonKey: 'auth.required',
    });
    expect(states.get('active_social_only')).toMatchObject({
      applicationSubmitAllowed: true,
      passwordRequired: false,
    });
    expect(states.get('identity_verified_minor')).toMatchObject({
      applicationSubmitAllowed: false,
      reasonCode: 'DEBUT_APPLICANT_MINOR_NOT_ALLOWED',
      messageKey: 'debut.applicant.minorNotAllowed',
    });
    expect(states.get('declared_minor')).toMatchObject({
      applicationSubmitAllowed: false,
      reasonCode: 'DEBUT_APPLICANT_ADULT_CONFIRMATION_REQUIRED',
      messageKey: 'debut.applicant.adultConfirmationRequired',
    });
  });
});
