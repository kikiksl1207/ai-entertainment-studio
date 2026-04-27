export type JwtTokenType = 'access' | 'refresh';

export type AuthUser = {
  id: string;
  email?: string | null;
};

export type JwtPayload = {
  sub: string;
  email?: string | null;
  tokenType: JwtTokenType;
};
