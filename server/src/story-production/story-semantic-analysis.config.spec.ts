import { manuscriptContentHash } from './story-production.policy';
import { assertSemanticJobPins, SEMANTIC_PACKING_PROFILE, semanticConfig, semanticPinHash, semanticPins,
  semanticPackingProfile, type SemanticPins } from './story-semantic-analysis.config';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';

describe('Pinned semantic packing compatibility', () => {
  const runtime = semanticTestConfig();
  const { packingProfile: _profile, ...legacy } = semanticPins(runtime);

  it('keeps the pre-profile hash and all old pins intact under a new worker default', () => {
    const original = JSON.stringify(legacy);
    expect(semanticPinHash(legacy)).toBe(manuscriptContentHash(legacy));
    expect(semanticPackingProfile(legacy)).toBe('legacy_32');
    expect(runtime.packingProfile).toBe(SEMANTIC_PACKING_PROFILE);
    expect(() => assertSemanticJobPins(runtime, legacy, manuscriptContentHash(legacy))).not.toThrow();
    expect(JSON.stringify(legacy)).toBe(original);
    expect(Object.prototype.hasOwnProperty.call(semanticPins(legacy), 'packingProfile')).toBe(false);
    expect(semanticPinHash(runtime)).not.toBe(semanticPinHash(legacy));
  });

  it.each([
    ['provider', 'different'], ['model', 'different'], ['rateCardId', 'different'], ['rateCardVersion', 'different'],
    ['inputKrwPerMillion', '1001'], ['cachedInputKrwPerMillion', '501'], ['outputKrwPerMillion', '2001'],
    ['inputTokenLimit', 8191], ['outputTokenLimit', 2047], ['maxJobInputTokens', 9999999],
    ['maxJobOutputTokens', 9999999], ['maxJobCostKrw', '99999'],
  ])('does not relax %s equality for legacy jobs', (key, value) => {
    expect(() => assertSemanticJobPins({ ...runtime, [key]: value }, legacy, semanticPinHash(legacy)))
      .toThrow('analysis_configuration_changed');
  });

  it('checks both the saved pins and their hash, not only runtime compatibility', () => {
    expect(() => assertSemanticJobPins(runtime, legacy, 'a'.repeat(64))).toThrow('analysis_configuration_changed');
    expect(() => assertSemanticJobPins(runtime, { ...legacy, outputTokenLimit: 1024 }, semanticPinHash(legacy)))
      .toThrow('analysis_configuration_changed');
    expect(() => assertSemanticJobPins(runtime, runtime, semanticPinHash(runtime))).not.toThrow();
  });

  it.each(['unknown', '', null, 2])('rejects unsupported profile %# even when its saved hash matches', profile => {
    const pins = { ...legacy, packingProfile: profile } as unknown as SemanticPins;
    expect(() => assertSemanticJobPins(runtime, pins, semanticPinHash(pins))).toThrow('analysis_packing_profile_unsupported');
  });

  it('does not turn on either paid flag when selecting the new server planner', () => {
    expect(semanticConfig({})).toMatchObject({ enabled: false, workerEnabled: false, apiKey: '',
      packingProfile: SEMANTIC_PACKING_PROFILE });
  });
});
