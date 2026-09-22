import { ConfigService } from '@nestjs/config';
import { SocialAuthService } from './social-auth.service';

describe('SocialAuthService Google authentication', () => {
  const clientId = 'google-client.apps.googleusercontent.com';
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('verifies a Sign in with Google ID credential', async () => {
    const config = {
      get: jest.fn((key: string) => key === 'GOOGLE_OAUTH_CLIENT_ID' ? clientId : undefined),
    } as unknown as ConfigService;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        aud: clientId,
        sub: 'google-user-1',
        email: 'operator@example.com',
        email_verified: 'true',
        name: 'Operator',
      }),
    })) as unknown as typeof fetch;

    const service = new SocialAuthService(config);
    const profile = await service.verifyProfile('google', {
      token: 'header.payload.signature',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('tokeninfo?id_token='),
      undefined,
    );
    expect(profile).toEqual({
      provider: 'google',
      providerUserId: 'google-user-1',
      email: 'operator@example.com',
      emailVerified: true,
      displayName: 'Operator',
    });
  });
});
