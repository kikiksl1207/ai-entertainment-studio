import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const [playerSource, productionSource, sceneContractSource] = await Promise.all([
  readFile(resolve(root, 'pages/story-stage.js'), 'utf8'),
  readFile(resolve(root, 'server/src/story-production/story-production.service.ts'), 'utf8'),
  readFile(resolve(root, 'server/src/story-stage/story-scene-read-model.ts'), 'utf8'),
]);

const checks = {
  currentSceneProjectsProgressState:
    productionSource.includes('this.sceneProjection(userId, progress, locale)') &&
    productionSource.includes('this.progressControls.publicState(userId, work.id)') &&
    productionSource.includes('progressState,'),
  progressStateIsWhitelisted: sceneContractSource.includes("'progressState',"),
  customChoiceIsCapabilityGated:
    playerSource.includes('progressState?.customChoiceCapability !== true') &&
    playerSource.includes('/custom-choice') &&
    playerSource.includes('body: { input, expectedRevision }'),
  resetIsCapabilityGated:
    playerSource.includes('progressState?.canFullReset === true') &&
    playerSource.includes('progressState?.canActReset === true') &&
    playerSource.includes('/reset-preview') &&
    playerSource.includes('body: { target: state.resetPreview.target, expectedRevision }'),
  fixedChoiceCountIsBounded: playerSource.includes('count >= 1 && count <= 3'),
};

const status = Object.values(checks).every(Boolean) ? 'passed' : 'failed';
console.log(JSON.stringify({
  runId: randomUUID(),
  publicPath: '/api/v1/story-sessions/:sessionId/current-scene',
  status,
  checks,
  mutationExecuted: false,
}));

if (status !== 'passed') process.exitCode = 1;
