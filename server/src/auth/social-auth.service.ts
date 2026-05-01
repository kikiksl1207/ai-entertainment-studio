import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialProvider, VerifiedSocialProfile } from './auth.types';

type JsonObject = Record<string, unknown>;
type SocialLoginCredential = {
  token?: string;
  code?: string;
  redirectUri?: string;
};

@Injectable()
export class SocialAuthService {
  constructor(private readonly configService: ConfigService) {}

  async verifyProfile(provider: SocialProvider, credential: SocialLoginCredential) {
    const token = credential.token?.trim();
    const code = credential.code?.trim();
    const redirectUri = credential.redirectUri?.trim();

    if (!token && !code) {
      throw new BadRequestException('Social token is required');
    }

    if (provider === 'google') {
      const googleToken = token ?? (await this.exchangeGoogleCode(code!, redirectUri));
      return this.verifyGoogle(googleToken);
    }

    if (provider === 'kakao') {
      const kakaoToken = token ?? (await this.exchangeKakaoCode(code!, redirectUri));
      return this.verifyKakao(kakaoToken);
    }

    if (provider === 'naver') {
      const naverToken = token ?? (await this.exchangeNaverCode(code!, redirectUri));
      return this.verifyNaver(naverToken);
    }

    throw new BadRequestException('Unsupported social provider');
  }

  private async verifyGoogle(token: string): Promise<VerifiedSocialProfile> {
    const clientId = this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID');

    if (!clientId) {
      throw new ServiceUnavailableException('Google login is not configured');
    }

    const isJwt = token.split('.').length === 3;
    const params = new URLSearchParams(isJwt ? { id_token: token } : { access_token: token });
    const payload = await this.fetchJson<JsonObject>(
      `https://oauth2.googleapis.com/tokeninfo?${params.toString()}`,
    );

    const audience = this.string(payload.aud) ?? this.string(payload.audience);
    const issuedTo = this.string(payload.issued_to);
    const providerUserId = this.string(payload.sub) ?? this.string(payload.user_id);

    if ((audience ?? issuedTo) !== clientId || !providerUserId) {
      throw new UnauthorizedException('Invalid Google token');
    }

    const userInfo = !this.string(payload.email)
      ? await this.fetchGoogleUserInfo(token)
      : null;
    const email =
      this.string(payload.email)?.toLowerCase() ??
      this.string(userInfo?.email)?.toLowerCase() ??
      null;
    const emailVerified =
      payload.email_verified === 'true' ||
      payload.email_verified === true ||
      payload.verified_email === true ||
      userInfo?.email_verified === true ||
      userInfo?.email_verified === 'true';

    return {
      provider: 'google',
      providerUserId,
      email,
      emailVerified,
      displayName: this.string(payload.name) ?? this.string(userInfo?.name) ?? null,
    };
  }

  private async verifyKakao(accessToken: string): Promise<VerifiedSocialProfile> {
    if (!this.configService.get<string>('KAKAO_REST_API_KEY')) {
      throw new ServiceUnavailableException('Kakao login is not configured');
    }

    const payload = await this.fetchJson<JsonObject>('https://kapi.kakao.com/v2/user/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const providerUserId = String(payload.id ?? '');
    const kakaoAccount = this.object(payload.kakao_account);
    const profile = this.object(kakaoAccount?.profile);
    const email = this.string(kakaoAccount?.email)?.toLowerCase() ?? null;

    if (!providerUserId) {
      throw new UnauthorizedException('Invalid Kakao token');
    }

    return {
      provider: 'kakao',
      providerUserId,
      email,
      emailVerified: kakaoAccount?.is_email_verified === true,
      displayName: this.string(profile?.nickname),
    };
  }

  private async verifyNaver(accessToken: string): Promise<VerifiedSocialProfile> {
    if (!this.configService.get<string>('NAVER_CLIENT_ID')) {
      throw new ServiceUnavailableException('Naver login is not configured');
    }

    const payload = await this.fetchJson<JsonObject>('https://openapi.naver.com/v1/nid/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (payload.resultcode && payload.resultcode !== '00') {
      throw new UnauthorizedException('Invalid Naver token');
    }

    const response = this.object(payload.response);
    const providerUserId = this.string(response?.id);

    if (!providerUserId) {
      throw new UnauthorizedException('Invalid Naver token');
    }

    return {
      provider: 'naver',
      providerUserId,
      email: this.string(response?.email)?.toLowerCase() ?? null,
      emailVerified: Boolean(this.string(response?.email)),
      displayName: this.string(response?.nickname) ?? this.string(response?.name),
    };
  }

  private async exchangeGoogleCode(code: string, redirectUri?: string) {
    const clientId = this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_OAUTH_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException('Google authorization code login is not configured');
    }

    const payload = await this.fetchFormJson<JsonObject>('https://oauth2.googleapis.com/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: this.getRedirectUri('GOOGLE_REDIRECT_URI', redirectUri),
    });

    return this.string(payload.id_token) ?? this.string(payload.access_token) ?? '';
  }

  private async exchangeKakaoCode(code: string, redirectUri?: string) {
    const clientId = this.configService.get<string>('KAKAO_REST_API_KEY');
    const clientSecret = this.configService.get<string>('KAKAO_CLIENT_SECRET');

    if (!clientId) {
      throw new ServiceUnavailableException('Kakao login is not configured');
    }

    const payload = await this.fetchFormJson<JsonObject>('https://kauth.kakao.com/oauth/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      code,
      redirect_uri: this.getRedirectUri('KAKAO_REDIRECT_URI', redirectUri),
    });

    return this.string(payload.access_token) ?? '';
  }

  private async exchangeNaverCode(code: string, redirectUri?: string) {
    const clientId = this.configService.get<string>('NAVER_CLIENT_ID');
    const clientSecret = this.configService.get<string>('NAVER_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException('Naver authorization code login is not configured');
    }

    const payload = await this.fetchFormJson<JsonObject>('https://nid.naver.com/oauth2.0/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: this.getRedirectUri('NAVER_REDIRECT_URI', redirectUri),
    });

    return this.string(payload.access_token) ?? '';
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch {
      throw new ServiceUnavailableException('Social provider request failed');
    }

    if (!response.ok) {
      throw new UnauthorizedException('Social token verification failed');
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new UnauthorizedException('Social provider response was invalid');
    }
  }

  private async fetchFormJson<T>(url: string, body: Record<string, string>): Promise<T> {
    return this.fetchJson<T>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
    });
  }

  private getRedirectUri(envKey: string, redirectUri?: string) {
    const configuredRedirectUri = this.configService.get<string>(envKey)?.trim();
    const resolvedRedirectUri = configuredRedirectUri || redirectUri;

    if (!resolvedRedirectUri) {
      throw new BadRequestException('redirectUri is required for authorization code login');
    }

    return resolvedRedirectUri;
  }

  private async fetchGoogleUserInfo(accessToken: string) {
    try {
      return await this.fetchJson<JsonObject>(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
    } catch (error) {
      if (error instanceof HttpException) {
        return null;
      }

      throw error;
    }
  }

  private object(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : undefined;
  }

  private string(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
