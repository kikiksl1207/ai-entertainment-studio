import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { load } = require('js-yaml');
const workflow = load(readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8'));
const steps = workflow.jobs.deploy.steps;
const upload = steps.find((step) => step.uses === 'actions/upload-pages-artifact@v3');
const deploy = steps.find((step) => step.uses === 'actions/deploy-pages@v4');
const name = 'github-pages-${{ github.run_id }}-${{ github.run_attempt }}';

function resolveArtifactName(template, runId, attempt) {
  assert.equal(template, name);
  return template.replace('${{ github.run_id }}', runId).replace('${{ github.run_attempt }}', attempt);
}

test('Pages upload and deployment select the same run-attempt artifact', () => {
  assert.equal(upload.with.name, name);
  assert.equal(deploy.with.artifact_name, name);
  assert.equal(upload.with.path, 'build/public-site');
  assert.equal(deploy.id, 'deployment');
});

test('normal runs and retries cannot select each other artifacts', () => {
  const contexts = [['100', '1'], ['100', '2'], ['101', '1']];
  const uploads = contexts.map(([run, attempt]) => resolveArtifactName(upload.with.name, run, attempt));
  const deployments = contexts.map(([run, attempt]) => resolveArtifactName(deploy.with.artifact_name, run, attempt));
  assert.deepEqual(uploads, deployments);
  assert.equal(new Set(uploads).size, contexts.length);
  assert.ok(uploads.every((artifact) => artifact !== 'github-pages'));
});

test('Pages retry isolation retains QA, publication scope and permissions', () => {
  assert.equal(workflow.jobs.deploy.needs, 'qa');
  assert.equal(workflow.jobs.qa['runs-on'], 'windows-latest');
  assert.equal(workflow.jobs.deploy['runs-on'], 'ubuntu-latest');
  assert.deepEqual(workflow.permissions, { contents: 'read', pages: 'write', 'id-token': 'write' });
  assert.deepEqual(workflow.concurrency, { group: 'pages', 'cancel-in-progress': true });
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.steps.filter((step) => step.run === 'node scripts/build-public-site.mjs').length, 1);
  }
  assert.ok(workflow.jobs.qa.steps.some((step) => step.run === 'node scripts/run-static-site-tests.mjs'));
  assert.ok(workflow.jobs.qa.steps.some((step) => step.run === 'node --test scripts/tests/build-public-site.test.mjs'));
});
