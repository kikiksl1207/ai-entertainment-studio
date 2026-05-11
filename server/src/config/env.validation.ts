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

  if (nodeEnv === 'production' && !config.ADMIN_EMAILS) {
    throw new Error('ADMIN_EMAILS environment variable is required in production');
  }

  if (nodeEnv === 'production') {
    rejectPlaceholder(config.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET');
    rejectPlaceholder(config.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET');
    validateObjectStorage(config);
    validatePaymentProvider(config);
    validateEmailDeliveryProvider(config);

    if ((config.PAYMENT_PROVIDER ?? 'mock') === 'mock') {
      throw new Error('PAYMENT_PROVIDER must be a real provider in production');
    }
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

function validateObjectStorage(config: Env) {
  const provider = config.OBJECT_STORAGE_PROVIDER ?? 'local';

  if (!['local', 'r2', 's3'].includes(provider)) {
    throw new Error('OBJECT_STORAGE_PROVIDER must be local, r2, or s3');
  }

  if (provider === 'local') {
    return;
  }

  const requiredObjectStorageKeys = [
    'OBJECT_STORAGE_BUCKET',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  ];

  for (const key of requiredObjectStorageKeys) {
    if (!config[key]) {
      throw new Error(`${key} environment variable is required when OBJECT_STORAGE_PROVIDER=${provider}`);
    }
  }

  if (provider === 'r2' && !config.OBJECT_STORAGE_ENDPOINT) {
    throw new Error('OBJECT_STORAGE_ENDPOINT environment variable is required when OBJECT_STORAGE_PROVIDER=r2');
  }
}

function validatePaymentProvider(config: Env) {
  const provider = config.PAYMENT_PROVIDER ?? 'mock';

  if (!['mock', 'payletter', 'tosspayments'].includes(provider)) {
    throw new Error('PAYMENT_PROVIDER must be mock, payletter, or tosspayments');
  }

  if (provider === 'payletter') {
    requireEnv(config, [
      'PAYLETTER_CLIENT_ID',
      'PAYLETTER_PAYMENT_API_KEY',
      'PAYMENT_SUCCESS_URL',
      'PAYMENT_FAIL_URL',
      'PAYMENT_CALLBACK_URL',
    ]);
  }

  if (provider === 'tosspayments') {
    if (!config.TOSSPAYMENTS_WIDGET_CLIENT_KEY && !config.TOSSPAYMENTS_CLIENT_KEY) {
      throw new Error(
        'TOSSPAYMENTS_WIDGET_CLIENT_KEY or TOSSPAYMENTS_CLIENT_KEY is required when PAYMENT_PROVIDER=tosspayments',
      );
    }

    requireEnv(config, [
      'TOSSPAYMENTS_SECRET_KEY',
      'PAYMENT_SUCCESS_URL',
      'PAYMENT_FAIL_URL',
    ]);
  }
}

function validateEmailDeliveryProvider(config: Env) {
  const provider = config.EMAIL_DELIVERY_PROVIDER ?? config.AUTH_EMAIL_PROVIDER;

  if (!provider) {
    return;
  }

  if (!['resend', 'sendgrid'].includes(provider)) {
    throw new Error('EMAIL_DELIVERY_PROVIDER must be resend or sendgrid');
  }

  requireAnyEnv(config, ['AUTH_EMAIL_FROM', 'EMAIL_FROM'], 'AUTH_EMAIL_FROM or EMAIL_FROM');
  requireAnyEnv(
    config,
    ['AUTH_EMAIL_VERIFICATION_URL_BASE', 'EMAIL_VERIFICATION_URL_BASE', 'FRONTEND_PUBLIC_BASE_URL', 'WEB_PUBLIC_BASE_URL'],
    'AUTH_EMAIL_VERIFICATION_URL_BASE, EMAIL_VERIFICATION_URL_BASE, FRONTEND_PUBLIC_BASE_URL, or WEB_PUBLIC_BASE_URL',
  );
  requireAnyEnv(
    config,
    ['AUTH_PASSWORD_RESET_URL_BASE', 'PASSWORD_RESET_URL_BASE', 'FRONTEND_PUBLIC_BASE_URL', 'WEB_PUBLIC_BASE_URL'],
    'AUTH_PASSWORD_RESET_URL_BASE, PASSWORD_RESET_URL_BASE, FRONTEND_PUBLIC_BASE_URL, or WEB_PUBLIC_BASE_URL',
  );

  if (provider === 'resend') {
    requireEnv(config, ['RESEND_API_KEY']);
  }

  if (provider === 'sendgrid') {
    requireEnv(config, ['SENDGRID_API_KEY']);
  }
}

function requireEnv(config: Env, keys: string[]) {
  for (const key of keys) {
    if (!config[key]) {
      throw new Error(`${key} environment variable is required`);
    }
  }
}

function requireAnyEnv(config: Env, keys: string[], label: string) {
  if (!keys.some((key) => config[key])) {
    throw new Error(`${label} environment variable is required`);
  }
}
