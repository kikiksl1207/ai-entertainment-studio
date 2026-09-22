import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { ArtistIdentityAnalysisProvider } from './artist-identity-analysis.provider';
import { CREATOR_GENERATION_PROFILE_SCHEMA } from './creator-generation-profile.policy';

const assetId = '00000000-0000-4000-8000-000000000301';

function config(enabled = true) {
  const values: Record<string, string> = {
    ARTIST_IDENTITY_ANALYSIS_ENABLED: enabled ? 'true' : 'false',
    ARTIST_IDENTITY_ANALYSIS_API_KEY: 'test-key',
    ARTIST_IDENTITY_ANALYSIS_MODEL: 'gpt-test-vision',
    ARTIST_IDENTITY_ANALYSIS_TIMEOUT_MS: '10000',
  };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function settings(sourceRef = assetId) {
  const value = {
    summary: 'Character identity summary',
    faceTraits: ['oval face'],
    hairTraits: ['silver hair'],
    bodySilhouette: ['balanced silhouette'],
    distinctiveMarks: ['blue ribbon'],
    basePalette: ['silver', 'blue'],
    mutableAttributes: ['costume', 'lighting'],
    forbiddenChanges: ['face proportions'],
    storyAdaptationRule: 'Adapt costume and rendering while preserving identity.',
  };
  return {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'artist',
    sections: [
      { key: 'fixed_identity', decision: 'proposed', value, evidence: [{ sourceType: 'visual', sourceRef, summary: 'Visible identity traits' }] },
      { key: 'adaptable_presentation', decision: 'proposed', value, evidence: [{ sourceType: 'visual', sourceRef, summary: 'Mutable presentation traits' }] },
    ],
  };
}

function envelope(result: unknown) {
  return new Response(JSON.stringify({
    status: 'completed',
    model: 'gpt-test-vision',
    output: [{
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(result) }],
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const input = {
  artistId: '00000000-0000-4000-8000-000000000302',
  displayName: 'Synthetic Artist',
  visualProfile: { visualKeywords: ['clean'] },
  references: [{ assetId, usageType: 'cover', imageUrl: 'https://assets.example.com/artist.webp' }],
};

describe('ArtistIdentityAnalysisProvider', () => {
  it('sends source-bound image input and returns only review proposals', async () => {
    const transport = jest.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      expect(request).toMatchObject({ model: 'gpt-test-vision', store: false, truncation: 'disabled' });
      expect(request.input[1].content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'input_image', image_url: input.references[0].imageUrl, detail: 'high' }),
      ]));
      expect(request.text.format).toMatchObject({ type: 'json_schema', strict: true });
      return envelope(settings());
    });
    const result = await new ArtistIdentityAnalysisProvider(config(), transport).analyze(input);

    expect(result.sections.map((section) => section.key)).toEqual(['adaptable_presentation', 'fixed_identity']);
    expect(result.sections.every((section) => section.decision === 'proposed')).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('fails closed when analysis is disabled or cites an unknown image', async () => {
    const transport = jest.fn(async () => envelope(settings('unknown-asset')));
    await expect(new ArtistIdentityAnalysisProvider(config(false), transport).analyze(input))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(transport).not.toHaveBeenCalled();

    await expect(new ArtistIdentityAnalysisProvider(config(), transport).analyze(input))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
