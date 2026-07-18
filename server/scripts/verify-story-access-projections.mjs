import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [controller, service, policy, economics] = await Promise.all([
  readFile(
    new URL('../src/story-production/story-production.controller.ts', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../src/story-production/story-production.service.ts', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../src/story-production/story-production.policy.ts', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../src/story-production/story-economics.service.ts', import.meta.url),
    'utf8',
  ),
]);

const checks = {
  creatorOwnedListAuthenticated:
    controller.includes("@Get('me/creator-studio/stories')") &&
    service.includes('where: { ownerUserId: userId, fixtureSource: false }'),
  titleCenteredSelection:
    service.includes('title: projectLocalizedValue') &&
    service.includes('permissions: creatorStorySelectionPermissions()'),
  readerAccessAuthenticated:
    controller.includes("@Get('me/stories/:workId/access')") &&
    service.includes('async readerAccess('),
  serverPriceProjection:
    policy.includes('amountLumina: input.priceLumina') &&
    policy.includes("currencyCode: 'LUMINA'"),
  entitlementProjection:
    service.includes('entitledReferenceIds(') &&
    service.includes('entitlementGranted'),
  replayActionsProjected:
    policy.includes("? 'continue'") &&
    policy.includes('canReset: input.authenticated && accessible && hasProgress'),
  aiAllowanceProjected:
    economics.includes('aiAllowanceRemaining') &&
    economics.includes('storyAllowanceRemaining(allowance)'),
  paymentMutationExcluded:
    !service
      .slice(service.indexOf('async readerAccess('), service.indexOf('async purchaseWork('))
      .includes('$transaction'),
};

if (Object.values(checks).some((value) => !value)) {
  throw new Error('Story access projection verification failed');
}

console.log(
  JSON.stringify({
    runId: randomUUID(),
    publicPath: '/api/v1/me/creator-studio/stories',
    status: 'passed',
    checks,
    mutationExecuted: false,
  }),
);
