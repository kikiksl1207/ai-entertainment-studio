import { existsSync, readFileSync } from 'node:fs';

const SCRIPT_NAME = 'scripts/verify-auth-qa-access-self-check.mjs';
const CONFIRM_VALUE = 'VERIFY_AUTH_QA_ACCESS_SELF_CHECK';
const TASK_ID = '#458';

const SLOT_GROUPS = [
  {
    key: 'qa_creator',
    slots: ['QA_CREATOR_EMAIL', 'QA_CREATOR_PASSWORD'],
  },
  {
    key: 'qa_admin',
    slots: ['QA_ADMIN_EMAIL', 'QA_ADMIN_PASSWORD'],
  },
];
const OUTPUT_SAFE_LOADED_KEYS = new Set(SLOT_GROUPS.flatMap((group) => group.slots));

const loadedSource = loadPrivateSource();
const config = {
  confirm: env('AUTH_QA_ACCESS_VERIFY_CONFIRM', env('AUTH_QA_VERIFY_CONFIRM')),
  dryRun: boolEnv('AUTH_QA_ACCESS_VERIFY_DRY_RUN') || boolEnv('AUTH_QA_VERIFY_DRY_RUN'),
  apiBase: env('AUTH_QA_ACCESS_API_BASE', env('AUTH_QA_API_BASE', env('API_BASE_URL'))),
};

if (config.confirm !== CONFIRM_VALUE) {
  fail(
    [
      'Refusing to inspect QA creator/admin access without explicit confirmation.',
      `Set AUTH_QA_ACCESS_VERIFY_CONFIRM=${CONFIRM_VALUE}.`,
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
      'No credential values, tokens, cookies, raw emails, passwords, raw response bodies, DB URLs, or env values were printed.',
  });
  process.exit(readiness.requiredReady ? 0 : 1);
}

if (!config.apiBase) {
  fail('AUTH_QA_ACCESS_API_BASE is required for live verification. The value is not printed by this script.');
}

const checks = [];
checks.push(
  groupReady(SLOT_GROUPS[0].slots)
    ? await qaCreatorAccessCheck()
    : missingSlotCheck('qa_creator', SLOT_GROUPS[0].slots, 'private_credential_owner'),
);
checks.push(
  groupReady(SLOT_GROUPS[1].slots)
    ? await qaAdminAccessCheck()
    : missingSlotCheck('qa_admin', SLOT_GROUPS[1].slots, 'private_credential_owner'),
);

print({
  ok: checks.every((check) => check.pass),
  task: TASK_ID,
  credentialSource: loadedSource,
  checks,
  policy: {
    secretsReturned: false,
    rawResponseBodyReturned: false,
    allowedOutput:
      'HTTP status, stable code/messageKey, access booleans, safe role kind, permission booleans, and owner routing only.',
  },
});

process.exit(checks.every((check) => check.pass) ? 0 : 1);

function buildReadiness() {
  const required = Object.fromEntries(
    SLOT_GROUPS.map((group) => [
      group.key,
      {
        ready: groupReady(group.slots),
        presentSlots: presentSlots(group.slots),
        missingSlots: missingSlots(group.slots),
      },
    ]),
  );

  return {
    requiredReady: Object.values(required).every((group) => group.ready),
    required,
  };
}

function missingSlotCheck(key, slots, nextOwner) {
  return {
    key,
    pass: false,
    blocked: true,
    reason: 'missing_required_private_slots',
    missingSlots: missingSlots(slots),
    nextOwner,
  };
}

async function qaCreatorAccessCheck() {
  const login = await loginWithPrivateCredentials(
    'QA_CREATOR_EMAIL',
    'QA_CREATOR_PASSWORD',
  );

  if (!login.accessToken) {
    return {
      key: 'qa_creator_creator_studio',
      pass: false,
      loginHttpStatus: login.status,
      code: stableCode(login.data),
      messageKey: stableMessageKey(login.data),
      nextOwner:
        login.status === null || login.status >= 500
          ? 'backend_owner'
          : 'private_credential_owner',
    };
  }

  const [me, trust, studio] = await Promise.all([
    authorizedJson('/api/v1/me', login.accessToken),
    authorizedJson('/api/v1/me/trust', login.accessToken),
    authorizedJson('/api/v1/me/creator-studio', login.accessToken),
  ]);
  const artistOperatorAccess = Array.isArray(trust.data?.roles?.artistOperators)
    ? trust.data.roles.artistOperators.length > 0
    : false;
  const creatorStudioAccessEnabled = studio.data?.access?.enabled === true;
  const accessType = safeCreatorAccessType(studio.data?.access?.type);
  const accessSource = safeCreatorAccessSource(studio.data?.access?.source);
  const pass =
    me.status === 200 &&
    trust.status === 200 &&
    studio.status === 200 &&
    creatorStudioAccessEnabled &&
    artistOperatorAccess &&
    accessSource === 'artist_operator';

  return {
    key: 'qa_creator_creator_studio',
    pass,
    loginHttpStatus: login.status,
    meHttpStatus: me.status,
    trustHttpStatus: trust.status,
    creatorStudioHttpStatus: studio.status,
    roleKind: artistOperatorAccess ? 'artist_operator' : accessType,
    access: {
      enabled: creatorStudioAccessEnabled,
      type: accessType,
      source: accessSource,
      reason: safeCreatorAccessReason(studio.data?.access?.reason),
    },
    permissions: {
      artistOperatorAccess,
      creatorStudioAccessEnabled,
    },
    endpointCodes: endpointCodes({ me, trust, studio }),
    nextOwner: pass
      ? 'none'
      : creatorNextOwner({ me, trust, studio, artistOperatorAccess }),
  };
}

async function qaAdminAccessCheck() {
  const login = await loginWithPrivateCredentials('QA_ADMIN_EMAIL', 'QA_ADMIN_PASSWORD');

  if (!login.accessToken) {
    return {
      key: 'qa_admin_backstage',
      pass: false,
      loginHttpStatus: login.status,
      code: stableCode(login.data),
      messageKey: stableMessageKey(login.data),
      nextOwner:
        login.status === null || login.status >= 500
          ? 'backend_owner'
          : 'private_credential_owner',
    };
  }

  const [adminMe, summary] = await Promise.all([
    authorizedJson('/api/v1/admin/api/v1/me', login.accessToken),
    authorizedJson('/api/v1/admin/api/v1/backstage/summary', login.accessToken),
  ]);
  const admin = adminMe.data?.admin ?? {};
  const roleKind = safeAdminRoleKind(admin.role);
  const hasWildcardPermission = Array.isArray(admin.permissions)
    ? admin.permissions.includes('*')
    : false;
  const adminAccessEnabled = admin.status === 'active';
  const summaryAccess = summary.status === 200;
  const pass =
    adminMe.status === 200 &&
    summary.status === 200 &&
    adminAccessEnabled &&
    roleKind === 'super_admin' &&
    hasWildcardPermission;

  return {
    key: 'qa_admin_backstage',
    pass,
    loginHttpStatus: login.status,
    adminMeHttpStatus: adminMe.status,
    backstageSummaryHttpStatus: summary.status,
    roleKind,
    access: {
      enabled: adminAccessEnabled,
      source: safeAdminSource(admin.source),
      backstageSummaryAccess: summaryAccess,
    },
    permissions: {
      hasWildcardPermission,
      superAdmin: roleKind === 'super_admin',
    },
    endpointCodes: endpointCodes({ adminMe, summary }),
    nextOwner: pass ? 'none' : adminNextOwner({ adminMe, summary, hasWildcardPermission }),
  };
}

async function loginWithPrivateCredentials(emailSlot, passwordSlot) {
  const login = await apiFetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: env(emailSlot),
      password: env(passwordSlot),
    }),
  });

  return {
    ...login,
    accessToken:
      login.data?.accessToken ?? login.data?.tokens?.accessToken ?? login.data?.access_token,
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
  try {
    const response = await fetch(`${config.apiBase.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const data = await response.json().catch(() => null);

    return { status: response.status, data };
  } catch {
    return {
      status: null,
      data: {
        code: 'NETWORK_ERROR',
        messageKey: 'authQa.selfCheck.networkError',
      },
    };
  }
}

function endpointCodes(entries) {
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key,
      {
        code: stableCode(value.data),
        messageKey: stableMessageKey(value.data),
      },
    ]),
  );
}

function creatorNextOwner({ me, trust, studio, artistOperatorAccess }) {
  if (
    [me.status, trust.status, studio.status].some(
      (status) => status === null || status >= 500,
    )
  ) {
    return 'backend_owner';
  }

  if (!artistOperatorAccess || studio.status === 403 || studio.status === 404) {
    return 'creator_access_owner';
  }

  return 'backend_owner';
}

function adminNextOwner({ adminMe, summary, hasWildcardPermission }) {
  if (
    [adminMe.status, summary.status].some((status) => status === null || status >= 500)
  ) {
    return 'backend_owner';
  }

  if (adminMe.status === 401 || adminMe.status === 403 || !hasWildcardPermission) {
    return 'backstage_admin_owner';
  }

  if (summary.status === 401 || summary.status === 403) {
    return 'backstage_permission_owner';
  }

  return 'backend_owner';
}

function stableCode(data) {
  return data?.error?.code ?? data?.code ?? null;
}

function stableMessageKey(data) {
  return data?.error?.messageKey ?? data?.messageKey ?? null;
}

function safeCreatorAccessType(value) {
  return ['personal_creator', 'studio_operator', 'admin_operator'].includes(value)
    ? value
    : null;
}

function safeCreatorAccessSource(value) {
  return ['artist_operator', 'approved_debut_application', 'admin_operator', 'none'].includes(
    value,
  )
    ? value
    : null;
}

function safeCreatorAccessReason(value) {
  return [
    'active_artist_operator_found',
    'approved_debut_application_found',
    'active_admin_operator_found',
    'no_active_artist_operator',
  ].includes(value)
    ? value
    : null;
}

function safeAdminRoleKind(value) {
  if (value === 'super_admin') {
    return 'super_admin';
  }

  return typeof value === 'string' && value ? 'non_super_admin' : null;
}

function safeAdminSource(value) {
  return ['admin_users', 'bootstrap_admin_emails'].includes(value) ? value : null;
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
    loadedKeyNames: loadedKeys.filter((key) => OUTPUT_SAFE_LOADED_KEYS.has(key)).sort(),
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
