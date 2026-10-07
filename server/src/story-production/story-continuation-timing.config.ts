import {
  createStoryContinuationTimingPolicy,
  StoryContinuationTimingPolicyError,
  type StoryContinuationTimingPolicy,
} from './story-continuation-timing.policy';
import { configInteger, type StoryContinuationConfigReader } from './story-continuation-openai.config';

export const STORY_CONTINUATION_TIMING_POLICY = 'STORY_CONTINUATION_TIMING_POLICY';

export function readStoryContinuationTimingPolicy(reader: StoryContinuationConfigReader): StoryContinuationTimingPolicy {
  const rawPreset = reader.get('STORY_CONTINUATION_TIMING_PRESET');
  const preset = rawPreset === undefined ? 'default' : rawPreset;
  if (preset !== 'default' && preset !== 'extended-180s') throw new StoryContinuationTimingPolicyError();
  const policy = createStoryContinuationTimingPolicy({
    providerDeadlineMs: preset === 'extended-180s' ? 180_000 : 90_000,
    drainMs: configInteger(reader, 'STORY_CONTINUATION_WORKER_DRAIN_MS', 35_000),
  });
  // A selected preset must not leave an older provider deadline behind.
  if (rawPreset !== undefined && configInteger(reader, 'STORY_CONTINUATION_REQUEST_TIMEOUT_MS',
    policy.providerDeadlineMs) !== policy.providerDeadlineMs) throw new StoryContinuationTimingPolicyError();
  return policy;
}
