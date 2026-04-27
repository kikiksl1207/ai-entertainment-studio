type Env = Record<string, string | undefined>;

const required = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];

export function validateEnv(config: Env) {
  const nodeEnv = config.NODE_ENV ?? 'development';

  for (const key of required) {
    if (!config[key]) {
      throw new Error(`${key} environment variable is required`);
    }
  }

  assertSecretLength(config.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET');
  assertSecretLength(config.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET');

  if (nodeEnv === 'production' && !config.CORS_ORIGINS) {
    throw new Error('CORS_ORIGINS environment variable is required in production');
  }

  if (nodeEnv === 'production') {
    rejectPlaceholder(config.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET');
    rejectPlaceholder(config.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET');
  }

  return config;
}

function rejectPlaceholder(value: string | undefined, key: string) {
  if (value?.startsWith('replace-with-')) {
    throw new Error(`${key} must not use the sample placeholder in production`);
  }
}

function assertSecretLength(value: string | undefined, key: string) {
  if (!value) {
    return;
  }

  if (value.length < 32) {
    throw new Error(`${key} must be at least 32 characters`);
  }
}
