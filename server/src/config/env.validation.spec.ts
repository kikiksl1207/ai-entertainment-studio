import { validateEnv } from './env.validation';

const base = () => ({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://synthetic@127.0.0.1:55432/synthetic_validation_only',
  JWT_ACCESS_SECRET: 'synthetic-access-secret-not-for-real-accounts',
  JWT_REFRESH_SECRET: 'synthetic-refresh-secret-not-for-real-accounts',
});

const production = (): Record<string, string | undefined> => ({
  ...base(), NODE_ENV: 'production', CORS_ORIGINS: 'https://site.example',
  ADMIN_EMAILS: 'synthetic-admin@example.invalid', PAYMENT_PROVIDER: 'tosspayments',
  TOSSPAYMENTS_CLIENT_KEY: 'synthetic-client', TOSSPAYMENTS_SECRET_KEY: 'synthetic-secret',
  PAYMENT_SUCCESS_URL: 'https://site.example/success', PAYMENT_FAIL_URL: 'https://site.example/fail',
});

describe('startup environment validation with synthetic configuration only', () => {
  it('keeps the default local/mock configuration available outside production', () => {
    const config = base();
    expect(validateEnv(config)).toBe(config);
  });

  it.each(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])
    ('rejects missing %s before boot', key => {
      const config: Record<string, string | undefined> = base(); delete config[key];
      expect(() => validateEnv(config)).toThrow(`${key} environment variable is required`);
    });

  it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])('rejects a short %s', key => {
    const config = production(); config[key] = 'x'.repeat(31);
    expect(() => validateEnv(config)).toThrow(`${key} must be at least 32 characters`);
  });

  it.each(['CORS_ORIGINS', 'ADMIN_EMAILS'])('requires production %s', key => {
    const config = production(); delete config[key];
    expect(() => validateEnv(config)).toThrow(`${key} environment variable is required in production`);
  });

  it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])('rejects the sample production %s', key => {
    const config = production(); config[key] = 'replace-with-a-real-production-secret-please';
    expect(() => validateEnv(config)).toThrow('must not use the sample placeholder');
  });

  it('rejects the mock payment provider in production', () => {
    const config = production(); config.PAYMENT_PROVIDER = 'mock';
    expect(() => validateEnv(config)).toThrow('must be a real provider in production');
  });

  it.each(['PAYMENT_SUCCESS_URL', 'PAYMENT_FAIL_URL', 'TOSSPAYMENTS_SECRET_KEY'])
    ('requires %s for the selected payment provider', key => {
      const config = production(); delete config[key];
      expect(() => validateEnv(config)).toThrow(`${key} environment variable is required`);
    });

  it('accepts a structurally complete production configuration without calling any provider', () => {
    const config = production(); expect(validateEnv(config)).toBe(config);
  });

  it.each(['r2', 's3'])('requires configured credentials for %s object storage', provider => {
    const config = production(); config.OBJECT_STORAGE_PROVIDER = provider;
    expect(() => validateEnv(config)).toThrow('OBJECT_STORAGE_BUCKET environment variable is required');
  });

  it('requires an endpoint for R2 even when synthetic credentials are present', () => {
    const config = { ...production(), OBJECT_STORAGE_PROVIDER: 'r2', OBJECT_STORAGE_BUCKET: 'synthetic',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'synthetic' };
    expect(() => validateEnv(config)).toThrow('OBJECT_STORAGE_ENDPOINT environment variable is required');
  });

  it.each(['resend', 'sendgrid'])('requires email origin settings for %s', provider => {
    const config = production(); config.EMAIL_DELIVERY_PROVIDER = provider;
    expect(() => validateEnv(config)).toThrow('AUTH_EMAIL_FROM or EMAIL_FROM environment variable is required');
  });

  it.each(['unknown-storage', 'unknown-payment', 'unknown-email'])('rejects %s', provider => {
    const config = production();
    if (provider === 'unknown-storage') config.OBJECT_STORAGE_PROVIDER = provider;
    if (provider === 'unknown-payment') config.PAYMENT_PROVIDER = provider;
    if (provider === 'unknown-email') config.EMAIL_DELIVERY_PROVIDER = provider;
    expect(() => validateEnv(config)).toThrow('must be');
  });
});
