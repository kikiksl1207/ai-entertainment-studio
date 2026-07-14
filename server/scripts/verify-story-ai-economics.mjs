import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../src/story-production/story-economics.service.ts', import.meta.url),
  'utf8',
);
const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const requiredMarkers = [
  'StoryAiRateCard',
  'StoryReleaseCapability',
  'StoryAiAllowanceBucket',
  'StoryAiUsageLedger',
  'StoryMemoryBudgetRun',
  'StoryStyleProfileConsent',
  'StoryAiContinuation',
  'fullManuscriptIncluded: false',
  'privateInputReturned: false',
  'providerPayloadReturned: false',
];
const missing = requiredMarkers.filter(
  (marker) => !schema.includes(marker) && !source.includes(marker),
);
if (missing.length) throw new Error(`Story AI economics markers missing: ${missing.join(', ')}`);

console.log(
  JSON.stringify({
    runId: randomUUID(),
    publicPath: '/api/v1/stories',
    status: 'passed',
    checks: requiredMarkers.length,
    mutationExecuted: false,
  }),
);
