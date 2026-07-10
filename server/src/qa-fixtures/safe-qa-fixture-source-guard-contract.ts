export const SAFE_QA_FIXTURE_ALLOWED_ENVIRONMENTS = [
  'development',
  'test',
] as const;

const FORBIDDEN_OUTPUT_KEYS = new Set([
  'email',
  'rawemail',
  'password',
  'accesstoken',
  'refreshtoken',
  'resettoken',
  'identitytoken',
  'cookie',
  'apikey',
  'databaseurl',
  'dburl',
  'rawuserid',
  'transactionid',
  'walletledgerid',
  'paymentorderid',
  'providerpayload',
  'identitypayload',
]);

function normalizeOutputKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function findUnsafeQaFixtureOutputKeys(
  outputKeys: readonly string[],
): string[] {
  return outputKeys.filter((key) =>
    FORBIDDEN_OUTPUT_KEYS.has(normalizeOutputKey(key)),
  );
}

export function isSafeQaFixtureActivationAllowed(input: {
  runtimeEnvironment: string;
  explicitFixtureFlag: boolean;
  serverAllowlisted: boolean;
}): boolean {
  return (
    SAFE_QA_FIXTURE_ALLOWED_ENVIRONMENTS.includes(
      input.runtimeEnvironment as (typeof SAFE_QA_FIXTURE_ALLOWED_ENVIRONMENTS)[number],
    ) &&
    input.explicitFixtureFlag &&
    input.serverAllowlisted
  );
}

export const SAFE_QA_FIXTURE_SOURCE_GUARD_CONTRACT = {
  version: '2026-07-10.safe-qa-fixture-source-guard.v1',
  status: 'source_guard_only',
  activationPolicy: {
    defaultEnabled: false,
    productionEnabled: false,
    allowedRuntimeEnvironments: SAFE_QA_FIXTURE_ALLOWED_ENVIRONMENTS,
    explicitReadOnlyFixtureFlagRequired: true,
    serverSideAllowlistRequired: true,
    routeRegistrationRequired: true,
  },
  requestPolicy: {
    allowedMethods: ['GET'],
    acceptsRequestBody: false,
    acceptsCredentialInput: false,
    acceptsProviderPayload: false,
  },
  allowedResultShape: [
    'runId',
    'fixtureStatus',
    'publicPath',
    'statusKey',
    'messageKey',
    'HTTP status',
    'safe boolean flags',
  ],
  forbiddenOutputKeys: [...FORBIDDEN_OUTPUT_KEYS],
  mutationPolicy: {
    accountMutation: false,
    passwordMutation: false,
    sessionMutation: false,
    inboxRead: false,
    providerCall: false,
    paymentMutation: false,
    walletMutation: false,
    walletLedgerMutation: false,
    identityMutation: false,
    debutMutation: false,
    storyProgressMutation: false,
    storyWrite: false,
  },
} as const;
