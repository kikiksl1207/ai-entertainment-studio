import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialProvider, VerifiedSocialProfile } from './auth.types';

type JsonObject = Record<string, unknown>;

@Injectable()
export class SocialAuthService {
  constructor(private readonly configService: ConfigService) {}

  verifyProfile(provider: SocialProvider, token: string) {
    if (!token.trim()) {
      throw new BadRequestException('Social token is required');
    }

    if (provider === 'google') {
      return this.verifyGoogle(token);
    }

    if (provider === 'kakao') {
      return this.verifyKakao(token);
    }

    if (provider === 'naver') {
      return this.verifyNaver(token);
    }

    throw new BadRequestException('Unsupported social provider');
  }

  private async verifyGoogle(idToken: string): Promise<VerifiedSocialProfile> {
    const clientId = this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID');

    if (!clientId) {
      throw new ServiceUnavailableException('Google login is not configured');
    }

    const params = new URLSearchParams({ id_token: idToken });
    const payload = await this.fetchJson<JsonObject>(
      `https://oauth2.googleapis.com/tokeninfo?${params.toString()}`,
    );

    if (payload.aud !== clientId || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Invalid Google token');
    }

    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    const emailVerified = payload.email_verified === 'true' || payload.email_verified === true;

    return {
      provider: 'google',
      providerUserId: payload.sub,
      email,
      emailVerified,
      displayName: typeof payload.name === 'string' ? payload.name : null,
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

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);

    if (!response.ok) {
      throw new UnauthorizedException('Social token verification failed');
    }

    return (await response.json()) as T;
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
