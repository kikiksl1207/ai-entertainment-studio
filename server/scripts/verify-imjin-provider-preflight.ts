import { readFileSync } from 'fs';
import { prepareImjinReleasePlan } from '../src/story-production/story-imjin-release-bridge.policy';
import { readStoryContinuationOpenAiConfig } from '../src/story-production/story-continuation-openai.config';
import { buildStoryContinuationOpenAiRequest, preflightStoryContinuationOpenAiRequest } from '../src/story-production/story-continuation-openai.prompt';

// Offline only: no adapter, fetch, database, environment API key or manuscript output.
const sourcePath = process.argv[2];
const model = process.argv[3] ?? 'gpt-5-mini-2025-08-07';
const inputTokenLimit = Number(process.argv[4] ?? 32_768);
if (!sourcePath || !Number.isSafeInteger(inputTokenLimit) || inputTokenLimit < 1 || inputTokenLimit > 128_000) {
  process.stderr.write('Usage: node -r ts-node/register/transpile-only scripts/verify-imjin-provider-preflight.ts SOURCE [PINNED_MODEL] [INPUT_TOKEN_LIMIT]\n');
  process.exitCode = 2;
} else {
  try {
    const plan = prepareImjinReleasePlan(readFileSync(sourcePath));
    const config = {
      ...readStoryContinuationOpenAiConfig({ get: () => undefined }),
      enabled: true, provider: 'openai', model, apiKey: 'offline-not-a-credential',
      rateCardId: 'offline-card', rateCardVersion: 'offline-v1',
      maxInputTokens: inputTokenLimit, visualAssetPath: '/assets/story/fallback.webp',
    };
    const budgets: number[] = [];
    const failures: Record<string, number> = {};
    let checked = 0;
    for (const part of plan.parts) {
      for (const choice of part.choices.filter((item) => item.routeKind === 'generation_required')) {
        const approvedContext = {
          sourceScene: { title: part.title, beats: part.beats.map((content) => ({ beatType: 'narration', content })) },
          selectedChoice: { label: choice.label }, path: [], memories: [],
        };
        const request = {
          provider: config.provider, model, rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
          operationId: 'offline-source-preflight', locale: 'ko', contextFingerprint: 'offline-source-only',
          promptVersion: 'story-continuation-v1', outputSchemaVersion: 'story-continuation-output-v1',
          inputTokenLimit, outputTokenLimit: 8192, approvedContext,
        };
        const check = preflightStoryContinuationOpenAiRequest(request, config);
        checked++;
        if (!check.supported) {
          const reason = check.reason ?? 'preflight_rejected';
          failures[reason] = (failures[reason] ?? 0) + 1;
          continue;
        }
        const body = buildStoryContinuationOpenAiRequest(request, config);
        if (body.input[0].content[0].text !== JSON.stringify(approvedContext)) {
          throw new Error('source_projection_changed');
        }
        budgets.push(check.inputTokenUpperBound!);
      }
    }
    process.stdout.write(`${JSON.stringify({
      mode: 'offline_source_only', sourceSha256: plan.source.sha256,
      partCount: plan.parts.length, choicesChecked: checked, supported: budgets.length,
      failures, inputTokenLimit, model,
      minimumSourceBudget: budgets.length ? Math.min(...budgets) : null,
      maximumSourceBudget: budgets.length ? Math.max(...budgets) : null,
      sourceProjectionUnchanged: true, historyAndMemoryIncluded: false,
      providerCalled: false, rawManuscriptIncluded: false,
      note: 'Runtime history, approved memory, authorization, latency and output quality require separate checks.',
    }, null, 2)}\n`);
    if (budgets.length !== checked) process.exitCode = 1;
  } catch {
    process.stderr.write('{"valid":false,"code":"IMJIN_PROVIDER_PREFLIGHT_FAILED","providerCalled":false}\n');
    process.exitCode = 1;
  }
}
