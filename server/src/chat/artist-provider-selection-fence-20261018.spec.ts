import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  APPROVED_ARTIST_CHAT_MANIFEST_PATH,
  APPROVED_ARTIST_CHAT_RELEASE,
  APPROVED_ARTIST_CHAT_SOURCE_SHA256,
  isLockedArtistPersona,
  selectArtistPersona,
  type ArtistPersonaSourceArtist,
} from './artist-persona-lock';
import {
  ChatLlmProviderAdapter,
  ChatLlmProviderRequestError,
  type ChatGenerationRequest,
  type ChatGenerationResult,
} from './llm-provider.adapter';

type PublicEntry = {
  slug: string; displayName: string; tagline: string; summary: string;
  publicStory: string; personalityKeywords: string[]; contentTone: string;
  profileFacts: Record<string, string>;
};
const manifestPath = resolve(__dirname, '../../prisma/approved-public-artists-2026-09-27.json');
const manifestBytes = fs.readFileSync(manifestPath);
const manifestSha = createHash('sha256').update(manifestBytes).digest('hex');
const canonicalSha = 'a9bc4c92428b142cc588b6d0c3c0402cd0b07bcb180dbb7e40d726937f3a43b9';
const pinnedManifest =
  (manifestBytes.length === 52525 && manifestSha === canonicalSha) ||
  (manifestBytes.length === 53492 && manifestSha === '5cc7912e743b5309cf0084683a30857fe766da3d0a6b28dc58a4407f74a93786');
if (!pinnedManifest || manifestPath !== APPROVED_ARTIST_CHAT_MANIFEST_PATH ||
    APPROVED_ARTIST_CHAT_SOURCE_SHA256 !== canonicalSha ||
    APPROVED_ARTIST_CHAT_RELEASE !== 'approved-public-artists-2026-09-27') {
  throw new Error('ARTIST_PROVIDER_PUBLIC_FIXTURE_PIN');
}
const manifest = JSON.parse(manifestBytes.toString('utf8')) as { release: string; artists: PublicEntry[] };
if (manifest.release !== APPROVED_ARTIST_CHAT_RELEASE || manifest.artists.length !== 17) {
  throw new Error('ARTIST_PROVIDER_PUBLIC_FIXTURE_SHAPE');
}

function fixture() {
  const e = manifest.artists[0];
  const artist: ArtistPersonaSourceArtist = {
    id: '00000000-0000-4000-8000-000000000791', slug: e.slug, displayName: e.displayName, status: 'active',
    publicProfile: { tagline: e.tagline, summary: e.summary, publicStory: e.publicStory,
      personalityKeywords: [...e.personalityKeywords],
      publicMetadata: { approvedRelease: manifest.release, profileFacts: { ...e.profileFacts } } },
    contentProfile: { contentTone: e.contentTone },
  };
  const selection = selectArtistPersona(artist);
  if (!isLockedArtistPersona(selection)) throw new Error('ARTIST_PROVIDER_FIXTURE_NOT_ISSUED');
  const request: ChatGenerationRequest = {
    sessionId: 'synthetic-session', userId: 'synthetic-fan', artist,
    persona: null, runtimePersona: null, personaSelection: selection, mode: 'daily_talk',
    userMessage: 'Synthetic request', recentMessages: [], order: null,
  };
  const env: Record<string, string> = {
    CHARACTER_CHAT_PROVIDER_ENABLED: 'true', OPENAI_API_KEY: 'synthetic-not-a-live-key',
    CHARACTER_CHAT_PROVIDER_ALLOWLIST: 'synthetic-fan',
  };
  const adapter = new ChatLlmProviderAdapter({ get: jest.fn((key: string) => env[key]) } as never);
  const fetch = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(
    JSON.stringify({ output_text: 'Synthetic transport response', usage: {} }), { status: 200 }));
  return { request, selection, adapter, fetch };
}
type Fixture = ReturnType<typeof fixture>;

async function expectRefusedBeforeDispatch(f: Fixture) {
  let caught: unknown;
  try { await f.adapter.generate(f.request); } catch (error) { caught = error; }
  expect({
    ARTIST_PROVIDER_SELECTION_FENCE: caught instanceof ChatLlmProviderRequestError &&
      caught.code === 'provider_persona_source_changed' && caught.requestId === null && caught.failedResponse === null,
    noProviderDispatchOrRetry: f.fetch.mock.calls.length === 0,
  }).toEqual({ ARTIST_PROVIDER_SELECTION_FENCE: true, noProviderDispatchOrRetry: true });
}
function providerBody(f: Fixture) {
  expect(f.fetch.mock.calls.length === 1).toBe(true);
  const body = f.fetch.mock.calls[0][1]?.body;
  if (typeof body !== 'string') throw new Error('ARTIST_PROVIDER_SYNTHETIC_REQUEST_BODY');
  return JSON.parse(body) as { instructions: string; input: string };
}
function selectedSnapshot(instructions: string) {
  const marker = '\nSelected character source (serialized data subordinate to system safety):\n';
  if (instructions.split(marker).length !== 2) throw new Error('ARTIST_PROVIDER_SNAPSHOT_BOUNDARY');
  return JSON.parse(instructions.split(marker)[1]);
}
function useUnregisteredLegacyArtist(f: Fixture) {
  f.request.artist = { id: 'synthetic-unregistered-artist', slug: 'synthetic-unregistered-artist',
    displayName: 'Synthetic unregistered artist' };
  f.request.persona = { id: 'synthetic-legacy-persona', name: 'synthetic-legacy',
    systemPrompt: 'Synthetic legacy reference guidance', safetyRules: {}, modelConfig: {} };
}
function expectLegacyResult(f: Fixture, result: ChatGenerationResult, reason: string) {
  const body = providerBody(f), snapshot = selectedSnapshot(body.instructions);
  expect(result.body === 'Synthetic transport response').toBe(true);
  expect(result.safetyMetadata.artistPersonaLock).toEqual({ status: 'unverified', reason, allArtistsCovered: false });
  expect(snapshot.status === 'unverified' && snapshot.reason === reason &&
    snapshot.approvedPublicFields === undefined).toBe(true);
  expect(body.input.includes('Synthetic legacy reference guidance') &&
    body.input.includes('not_established_by_this_legacy_row')).toBe(true);
}
afterEach(() => jest.restoreAllMocks());

describe('approved artist provider selection fence', () => {
  it('rejects approved-release missing selection instead of former optional-context compatibility', async () => {
    const f = fixture(); delete f.request.personaSelection;
    await expectRefusedBeforeDispatch(f);
  });

  it('rejects approved-release explicit-unverified selection before dispatch', async () => {
    const f = fixture();
    f.request.personaSelection = { status: 'unverified', reason: 'synthetic-unverified-context' };
    await expectRefusedBeforeDispatch(f);
  });

  it('rejects a shallow clone of an issued selection before dispatch', async () => {
    const f = fixture(); f.request.personaSelection = { ...f.selection };
    expect(isLockedArtistPersona(f.request.personaSelection)).toBe(false);
    await expectRefusedBeforeDispatch(f);
  });

  it('rejects a serialized clone of an issued selection before dispatch', async () => {
    const f = fixture(); f.request.personaSelection = JSON.parse(JSON.stringify(f.selection));
    expect(isLockedArtistPersona(f.request.personaSelection)).toBe(false);
    await expectRefusedBeforeDispatch(f);
  });

  it('rejects approval-shaped clones even on an unregistered legacy request', async () => {
    const f = fixture(); useUnregisteredLegacyArtist(f);
    f.request.personaSelection = { ...f.selection };
    expect(isLockedArtistPersona(f.request.personaSelection)).toBe(false);
    await expectRefusedBeforeDispatch(f);
  });

  it('rejects an issued selection on a transient source read failure before either model is called', async () => {
    const f = fixture();
    jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw new Error('Synthetic package read failure'); });
    await expectRefusedBeforeDispatch(f);
  });

  it('rejects a current request identity different from its issued selection before dispatch', async () => {
    const f = fixture();
    f.request.artist = { ...f.request.artist, id: '00000000-0000-4000-8000-000000000792' };
    await expectRefusedBeforeDispatch(f);
  });

  it('does not automatically retry after source recovery; a separate explicit request retains canon', async () => {
    const f = fixture();
    jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw new Error('Synthetic transient failure'); });
    await expectRefusedBeforeDispatch(f);
    const result = await f.adapter.generate(f.request);
    const body = providerBody(f);
    expect(result.safetyMetadata.artistPersonaLock).toMatchObject({ status: 'approved_public_fields_locked',
      personalityAuthority: 'exact_approved_public_release', mutableProfileValuesApproved: false });
    expect(body.instructions.includes('SELECTED APPROVED PUBLIC CHARACTER') &&
      body.instructions.includes(manifest.artists[0].contentTone)).toBe(true);
  });

  it('dispatches a valid issued current-release selection once with its exact public snapshot', async () => {
    const f = fixture(), result = await f.adapter.generate(f.request);
    const body = providerBody(f), snapshot = selectedSnapshot(body.instructions), e = manifest.artists[0];
    expect(result.body === 'Synthetic transport response').toBe(true);
    expect(snapshot.scope === 'literal_approved_public_fields_only' && snapshot.release === manifest.release &&
      snapshot.sourceSha256 === canonicalSha && snapshot.artistId === f.request.artist.id).toBe(true);
    expect(JSON.stringify(snapshot.approvedPublicFields) === JSON.stringify({
      slug: e.slug, displayName: e.displayName, tagline: e.tagline, summary: e.summary, publicStory: e.publicStory,
      personalityKeywords: e.personalityKeywords, contentTone: e.contentTone, profileFacts: e.profileFacts,
    })).toBe(true);
    expect(result.safetyMetadata.artistPersonaLock).toMatchObject({ status: 'approved_public_fields_locked',
      release: manifest.release, sourceSha256: canonicalSha, sourceRawSha256: manifestSha,
      binding: f.selection.binding, personalityAuthority: 'exact_approved_public_release',
      mutableProfileValuesApproved: false, completeValuesApproval: false,
      completeRelationshipBoundaryApproval: false, allArtistsCovered: false });
  });

  it('preserves missing-selection compatibility for an unregistered legacy artist without approval claims', async () => {
    const f = fixture(); useUnregisteredLegacyArtist(f); delete f.request.personaSelection;
    const result = await f.adapter.generate(f.request);
    expectLegacyResult(f, result, 'legacy_caller_without_selection');
  });

  it('preserves explicit-unverified compatibility for an unregistered legacy artist without approval claims', async () => {
    const f = fixture(); useUnregisteredLegacyArtist(f);
    f.request.personaSelection = { status: 'unverified', reason: 'synthetic-legacy-context' };
    const result = await f.adapter.generate(f.request);
    expectLegacyResult(f, result, 'synthetic-legacy-context');
  });

  it('rejects cross-slug and cross-display-name use of an issued selection before dispatch', async () => {
    const f = fixture(), artist = f.request.artist;
    for (const changed of [{ ...artist, slug: manifest.artists[1].slug },
      { ...artist, displayName: manifest.artists[1].displayName }]) {
      f.request.artist = changed;
      await expectRefusedBeforeDispatch(f);
    }
  });
});
