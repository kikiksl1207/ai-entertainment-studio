import { AUTH_REGISTER_REGRESSION_CONTRACT } from './auth-register-regression-contract';

describe('auth register regression contract', () => {
  it('covers register and verification without account or session mutation', () => {
    expect(AUTH_REGISTER_REGRESSION_CONTRACT.publicPaths).toEqual([
      '/api/v1/auth/register',
      '/api/v1/auth/email-verifications',
      '/api/v1/auth/email-verifications/confirm',
    ]);
    expect(AUTH_REGISTER_REGRESSION_CONTRACT.fixture).toMatchObject({
      readOnly: true,
      createsAccount: false,
      sendsVerification: false,
      confirmsVerification: false,
      rotatesSession: false,
    });
    expect(
      Object.values(AUTH_REGISTER_REGRESSION_CONTRACT.privacy).every(
        (value) => value === false,
      ),
    ).toBe(true);
  });
});
