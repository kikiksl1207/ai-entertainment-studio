import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, verify } from 'crypto';
import { SocialProvider, VerifiedSocialProfile } from './auth.types';

type JsonObject = Record<string, unknown>;
type AppleJwk = JsonObject & { kid?: string; alg?: string };

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

    return this.verifyApple(token);
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

  private async verifyApple(identityToken: string): Promise<VerifiedSocialProfile> {
    const clientId = this.configService.get<string>('APPLE_CLIENT_ID');

    if (!clientId) {
      throw new ServiceUnavailableException('Apple login is not configured');
    }

    const [header, payload, signature] = identityToken.split('.');

    if (!header || !payload || !signature) {
      throw new UnauthorizedException('Invalid Apple token');
    }

    const decodedHeader = this.decodeJwtPart<JsonObject>(header);
    const decodedPayload = this.decodeJwtPart<JsonObject>(payload);
    const kid = this.string(decodedHeader.kid);

    if (!kid || decodedPayload.aud !== clientId || decodedPayload.iss !== 'https://appleid.apple.com') {
      throw new UnauthorizedException('Invalid Apple token');
    }

    const keys = await this.fetchJson<{ keys?: AppleJwk[] }>(
      'https://appleid.apple.com/auth/keys',
    );
    const jwk = keys.keys?.find((key) => key.kid === kid);

    if (!jwk) {
      throw new UnauthorizedException('Apple signing key not found');
    }

    const signatureValid = verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      this.base64UrlToBuffer(signature),
    );

    if (!signatureValid || !this.isJwtTimestampValid(decodedPayload)) {
      throw new UnauthorizedException('Invalid Apple token');
    }

    const providerUserId = this.string(decodedPayload.sub);

    if (!providerUserId) {
      throw new UnauthorizedException('Invalid Apple token');
    }

    return {
      provider: 'apple',
      providerUserId,
      email: this.string(decodedPayload.email)?.toLowerCase() ?? null,
      emailVerified:
        decodedPayload.email_verified === true || decodedPayload.email_verified === 'true',
      displayName: null,
    };
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);

    if (!response.ok) {
      throw new UnauthorizedException('Social token verification failed');
    }

    return (await response.json()) as T;
  }

  private decodeJwtPart<T>(value: string): T {
    try {
      return JSON.parse(this.base64UrlToBuffer(value).toString('utf8')) as T;
    } catch {
      throw new UnauthorizedException('Invalid social token');
    }
  }

  private base64UrlToBuffer(value: string) {
    return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }

  private isJwtTimestampValid(payload: JsonObject) {
    const now = Math.floor(Date.now() / 1000);
    const exp = Number(payload.exp);
    const iat = Number(payload.iat);

    return Number.isFinite(exp) && exp > now && (!Number.isFinite(iat) || iat <= now + 300);
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
