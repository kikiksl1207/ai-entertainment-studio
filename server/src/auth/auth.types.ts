export type JwtTokenType = 'access' | 'refresh';

export type AuthUser = {
  id: string;
  email?: string | null;
  adminRole?: string;
  adminPermissions?: string[];
};

export type JwtPayload = {
  sub: string;
  email?: string | null;
  tokenType: JwtTokenType;
  tokenId?: string;
};

export type SocialProvider = 'google' | 'kakao' | 'naver' | 'apple';

export type VerifiedSocialProfile = {
  provider: SocialProvider;
  providerUserId: string;
  email?: string | null;
  emailVerified?: boolean;
  displayName?: string | null;
};
