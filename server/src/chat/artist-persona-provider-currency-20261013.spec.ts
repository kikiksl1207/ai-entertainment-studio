import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { selectArtistPersona, type ArtistPersonaSourceArtist } from './artist-persona-lock';
import { ChatLlmProviderAdapter, type ChatGenerationRequest } from './llm-provider.adapter';

const manifest = JSON.parse(fs.readFileSync(resolve(__dirname,
  '../../prisma/approved-public-artists-2026-09-27.json'), 'utf8')) as {
  release: string; artists: Array<{ slug: string; displayName: string; tagline: string; summary: string;
    publicStory: string; personalityKeywords: string[]; contentTone: string; profileFacts: Record<string, string> }>;
};
function fixture() {
  const e = manifest.artists[0];
  const artist: ArtistPersonaSourceArtist = { id: '00000000-0000-4000-8000-000000000791',
    slug: e.slug, displayName: e.displayName, status: 'active',
    publicProfile: { tagline: e.tagline, summary: e.summary, publicStory: e.publicStory,
      personalityKeywords: [...e.personalityKeywords],
      publicMetadata: { approvedRelease: manifest.release, profileFacts: { ...e.profileFacts } } },
    contentProfile: { contentTone: e.contentTone } };
  const request: ChatGenerationRequest = { sessionId: 'synthetic-session', userId: 'synthetic-fan', artist,
    persona: null, runtimePersona: null, personaSelection: selectArtistPersona(artist), mode: 'daily_talk',
    userMessage: 'Synthetic request', recentMessages: [], order: null };
  const env: Record<string, string> = { CHARACTER_CHAT_PROVIDER_ENABLED: 'true', OPENAI_API_KEY: 'not-a-live-key',
    CHARACTER_CHAT_PROVIDER_ALLOWLIST: 'synthetic-fan' };
  const adapter = new ChatLlmProviderAdapter({ get: jest.fn(key => env[key]) } as never);
  const fetch = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(
    JSON.stringify({ output_text: 'Synthetic transport response', usage: {} }), { status: 200 }));
  return { request, adapter, fetch };
}
afterEach(() => jest.restoreAllMocks());

describe('issued persona currency before any model dispatch', () => {
  it('rejects an issued selection on a transient source read failure before either model is called', async () => {
    const f = fixture();
    jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw new Error('Synthetic package read failure'); });
    await expect(f.adapter.generate(f.request)).rejects.toMatchObject({ code: 'provider_persona_source_changed' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('rejects a current request identity different from its issued selection before dispatch', async () => {
    const f = fixture();
    f.request.artist = { ...f.request.artist, id: '00000000-0000-4000-8000-000000000792' };
    await expect(f.adapter.generate(f.request)).rejects.toMatchObject({ code: 'provider_persona_source_changed' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('does not automatically retry after source recovery; a separate explicit request retains canon', async () => {
    const f = fixture();
    jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw new Error('Synthetic transient failure'); });
    await expect(f.adapter.generate(f.request)).rejects.toMatchObject({ code: 'provider_persona_source_changed' });
    expect(f.fetch).not.toHaveBeenCalled();
    const result = await f.adapter.generate(f.request);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(result.safetyMetadata.artistPersonaLock).toMatchObject({ status: 'approved_public_fields_locked',
      personalityAuthority: 'exact_approved_public_release', mutableProfileValuesApproved: false });
    const body = JSON.parse(f.fetch.mock.calls[0][1]!.body as string);
    expect(body.instructions).toContain('SELECTED APPROVED PUBLIC CHARACTER');
    expect(body.instructions).toContain(manifest.artists[0].contentTone);
  });

  it('rejects approved-release missing context before dispatch instead of legacy compatibility', async () => {
    const f = fixture(); delete f.request.personaSelection;
    await expect(f.adapter.generate(f.request)).rejects.toMatchObject({ code: 'provider_persona_source_changed' });
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
