import { existsSync, readFileSync } from 'node:fs';

const SCRIPT_NAME = 'scripts/verify-auth-qa-credential-source.mjs';
const CONFIRM_VALUE = 'VERIFY_AUTH_QA_CREDENTIAL_SOURCE';
const TASK_ID = '#344';
const MISSING_PRIVATE_CREDENTIAL_BLOCK = {
  blockedBy: 'safe QA credential source needed',
  nextAction:
    'Populate the missing slot names in a private local credential source, then rerun this verifier.',
};

const REQUIRED_SLOT_GROUPS = [
  {
    key: 'verified_email_password',
    slots: ['QA_VERIFIED_EMAIL', 'QA_VERIFIED_PASSWORD'],
  },
  {
    key: 'social_only_manual_provider',
    slots: ['QA_SOCIAL_PROVIDER', 'QA_SOCIAL_EMAIL', 'QA_SOCIAL_PASSWORD'],
  },
];
const OPTIONAL_SOCIAL_API_GROUPS = [
  ['QA_SOCIAL_PROVIDER', 'QA_SOCIAL_ACCESS_TOKEN'],
  ['QA_SOCIAL_PROVIDER', 'QA_SOCIAL_AUTH_CODE', 'QA_SOCIAL_REDIRECT_URI'],
];
const LEGACY_SLOT_GROUPS = [
  {
    key: 'normal_user',
    slots: ['QA_USER_EMAIL', 'QA_USER_PASSWORD'],
  },
  {
    key: 'creator',
    slots: ['QA_CREATOR_EMAIL', 'QA_CREATOR_PASSWORD'],
  },
  {
    key: 'admin',
    slots: ['QA_ADMIN_EMAIL', 'QA_ADMIN_PASSWORD'],
  },
];

const loadedSource = loadPrivateSource();
const config = {
  confirm: env('AUTH_QA_VERIFY_CONFIRM'),
  dryRun: boolEnv('AUTH_QA_VERIFY_DRY_RUN'),
  apiBase: env('AUTH_QA_API_BASE', env('API_BASE_URL')),
  allowSocialApiLogin: boolEnv('AUTH_QA_ALLOW_SOCIAL_API_LOGIN'),
};

if (config.confirm !== CONFIRM_VALUE) {
  fail(
    [
      'Refusing to inspect auth QA credentials without explicit confirmation.',
      `Set AUTH_QA_VERIFY_CONFIRM=${CONFIRM_VALUE}.`,
      `Run from the server directory: node ${SCRIPT_NAME}`,
    ].join('\n'),
  );
}

const readiness = buildReadiness();

if (config.dryRun) {
  print({
    ok: readiness.requiredReady,
    dryRun: true,
    task: TASK_ID,
    credentialSource: loadedSource,
    readiness,
    note:
      'No credential values, tokens, cookies, raw emails, passwords, provider payloads, DB URLs, or env values were printed.',
  });
  process.exit(readiness.requiredReady ? 0 : 1);
}

if (!config.apiBase) {
  fail('AUTH_QA_API_BASE is required for live verification. The value is not printed by this script.');
}

const checks = [];
checks.push(await publicDebutPolicyCheck());
checks.push(await invalidTokenCheck('/api/v1/me'));
checks.push(await invalidTokenCheck('/api/v1/me/trust'));
checks.push(await unauthDebutSubmitCheck());

if (groupReady(REQUIRED_SLOT_GROUPS[0].slots)) {
  checks.push(await verifiedEmailPasswordCheck());
} else {
  checks.push({
    key: 'verified_email_password',
    pass: false,
    blocked: true,
    reason: 'missing_required_private_slots',
    missingSlots: missingSlots(REQUIRED_SLOT_GROUPS[0].slots),
    ...MISSING_PRIVATE_CREDENTIAL_BLOCK,
  });
}

if (socialApiReady() && config.allowSocialApiLogin) {
  checks.push(await socialOnlyApiCheck());
} else {
  checks.push({
    key: 'social_only',
    pass: groupReady(REQUIRED_SLOT_GROUPS[1].slots),
    blocked: !groupReady(REQUIRED_SLOT_GROUPS[1].slots),
    mode: groupReady(REQUIRED_SLOT_GROUPS[1].slots)
      ? 'manual_provider_login_required'
      : 'missing_required_private_slots',
    missingSlots: missingSlots(REQUIRED_SLOT_GROUPS[1].slots),
    apiAutomationReady: socialApiReady(),
    ...(groupReady(REQUIRED_SLOT_GROUPS[1].slots) ? {} : MISSING_PRIVATE_CREDENTIAL_BLOCK),
    note:
      'Manual provider credentials are checked only for presence. API social login is skipped unless AUTH_QA_ALLOW_SOCIAL_API_LOGIN=true.',
  });
}

print({
  ok: checks.every((check) => check.pass),
  task: TASK_ID,
  credentialSource: loadedSource,
  checks,
  note:
    'No credential values, tokens, cookies, raw emails, passwords, provider payloads, DB URLs, or env values were printed.',
});

function buildReadiness() {
  const required = Object.fromEntries(
    REQUIRED_SLOT_GROUPS.map((group) => [
      group.key,
      {
        ready: groupReady(group.slots),
        presentSlots: presentSlots(group.slots),
        missingSlots: missingSlots(group.slots),
        ...(groupReady(group.slots) ? {} : MISSING_PRIVATE_CREDENTIAL_BLOCK),
      },
    ]),
  );
  const legacy = Object.fromEntries(
    LEGACY_SLOT_GROUPS.map((group) => [
      group.key,
      {
        ready: groupReady(group.slots),
        presentSlots: presentSlots(group.slots),
        missingSlots: missingSlots(group.slots),
        ...(groupReady(group.slots) ? {} : MISSING_PRIVATE_CREDENTIAL_BLOCK),
      },
    ]),
  );

  return {
    requiredReady: Object.values(required).every((group) => group.ready),
    required,
    legacy,
    optionalSocialApiAutomation: {
      ready: socialApiReady(),
      modes: OPTIONAL_SOCIAL_API_GROUPS.map((slots) => ({
        ready: groupReady(slots),
        presentSlots: presentSlots(slots),
        missingSlots: missingSlots(slots),
      })),
    },
  };
}

async function publicDebutPolicyCheck() {
  const { status, data } = await apiFetch('/api/v1/debut/policy');

  return {
    key: 'public_debut_policy',
    httpStatus: status,
    pass: status === 200 && data !== null,
  };
}

async function invalidTokenCheck(path) {
  const { status, data } = await apiFetch(path, {
    headers: { Authorization: 'Bearer invalid-auth-qa-token' },
  });

  return {
    key: `invalid_token:${path}`,
    httpStatus: status,
    code: stableCode(data),
    messageKey: stableMessageKey(data),
    pass: status === 401,
  };
}

async function unauthDebutSubmitCheck() {
  const { status, data } = await apiFetch('/api/v1/debut/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  return {
    key: 'unauth_debut_submit',
    httpStatus: status,
    code: stableCode(data),
    messageKey: stableMessageKey(data),
    pass: status === 401,
  };
}

async function verifiedEmailPasswordCheck() {
  const login = await apiFetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: env('QA_VERIFIED_EMAIL'),
      password: env('QA_VERIFIED_PASSWORD'),
    }),
  });
  const accessToken =
    login.data?.accessToken ?? login.data?.tokens?.accessToken ?? login.data?.access_token;

  if (login.status !== 201 || !accessToken) {
    return {
      key: 'verified_email_password',
      httpStatus: login.status,
      code: stableCode(login.data),
      messageKey: stableMessageKey(login.data),
      pass: false,
    };
  }

  const me = await authorizedJson('/api/v1/me', accessToken);
  const trust = await authorizedJson('/api/v1/me/trust', accessToken);
  const user = me.data ?? {};
  const emailVerification = user.emailVerification ?? {};
  const pass =
    me.status === 200 &&
    trust.status === 200 &&
    user.emailVerified === true &&
    emailVerification.status === 'verified' &&
    user.hasPassword === true &&
    user.isSocialOnly === false;

  return {
    key: 'verified_email_password',
    loginHttpStatus: login.status,
    meHttpStatus: me.status,
    trustHttpStatus: trust.status,
    emailVerified: user.emailVerified === true,
    emailVerificationStatus: emailVerification.status ?? null,
    hasPassword: user.hasPassword === true,
    isSocialOnly: user.isSocialOnly === true,
    pass,
  };
}

async function socialOnlyApiCheck() {
  const body = {
    provider: env('QA_SOCIAL_PROVIDER'),
  };

  if (env('QA_SOCIAL_ACCESS_TOKEN')) {
    body.accessToken = env('QA_SOCIAL_ACCESS_TOKEN');
  } else {
    body.code = env('QA_SOCIAL_AUTH_CODE');
    body.redirectUri = env('QA_SOCIAL_REDIRECT_URI');
  }

  const login = await apiFetch('/api/v1/auth/social/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const accessToken =
    login.data?.accessToken ?? login.data?.tokens?.accessToken ?? login.data?.access_token;

  if (login.status !== 201 || !accessToken) {
    return {
      key: 'social_only',
      mode: 'api_provider_login',
      httpStatus: login.status,
      code: stableCode(login.data),
      messageKey: stableMessageKey(login.data),
      pass: false,
    };
  }

  const me = await authorizedJson('/api/v1/me', accessToken);
  const user = me.data ?? {};

  return {
    key: 'social_only',
    mode: 'api_provider_login',
    loginHttpStatus: login.status,
    meHttpStatus: me.status,
    provider: safeProvider(user.provider),
    hasPassword: user.hasPassword === true,
    isSocialOnly: user.isSocialOnly === true,
    pass: me.status === 200 && user.hasPassword === false && user.isSocialOnly === true,
  };
}

async function authorizedJson(path, accessToken) {
  return apiFetch(path, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
}

async function apiFetch(path, init = {}) {
  const response = await fetch(`${config.apiBase.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => null);

  return { status: response.status, data };
}

function stableCode(data) {
  return data?.error?.code ?? data?.code ?? null;
}

function stableMessageKey(data) {
  return data?.error?.messageKey ?? data?.messageKey ?? null;
}

function socialApiReady() {
  return OPTIONAL_SOCIAL_API_GROUPS.some((slots) => groupReady(slots));
}

function groupReady(slots) {
  return slots.every((slot) => Boolean(env(slot)));
}

function presentSlots(slots) {
  return slots.filter((slot) => Boolean(env(slot)));
}

function missingSlots(slots) {
  return slots.filter((slot) => !env(slot));
}

function safeProvider(provider) {
  return ['email', 'google', 'kakao', 'naver'].includes(provider) ? provider : null;
}

function loadPrivateSource() {
  const explicitPath = process.env.AUTH_QA_CREDENTIAL_SOURCE_FILE;
  const candidates = explicitPath
    ? [explicitPath]
    : ['../.env.local', '../../.env.local', '../../workspace-core/.env.local'];
  const sourcePath = candidates.find((candidate) => fileExists(candidate));

  if (!sourcePath) {
    return { type: 'process_env_only', fileLoaded: false };
  }

  const content = readTextFile(sourcePath);
  const loadedKeys = [];

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

    if (!match) {
      continue;
    }

    const key = match[1];

    if (!process.env[key]) {
      process.env[key] = parseEnvValue(match[2]);
      loadedKeys.push(key);
    }
  }

  return {
    type: explicitPath ? 'explicit_private_file' : 'default_private_file',
    fileLoaded: true,
    loadedKeyNames: loadedKeys.sort(),
  };
}

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function fileExists(path) {
  return existsSync(path);
}

function readTextFile(path) {
  return readFileSync(path, 'utf8');
}

function env(key, fallback = '') {
  return process.env[key] ?? fallback;
}

function boolEnv(key) {
  return ['1', 'true', 'yes', 'y'].includes(env(key).trim().toLowerCase());
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
