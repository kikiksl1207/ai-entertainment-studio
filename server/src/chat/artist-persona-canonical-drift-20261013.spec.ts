import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  artistPersonaLockMetadata, artistPersonaSelectionMatches, buildArtistPersonaLockInstructions,
  isLockedArtistPersona, selectArtistPersona, type ArtistPersonaSourceArtist,
} from './artist-persona-lock';

type Entry = { slug: string; displayName: string; tagline: string; summary: string; publicStory: string;
  personalityKeywords: string[]; contentTone: string; profileFacts: Record<string, string> };
const manifest = JSON.parse(readFileSync(resolve(__dirname,
  '../../prisma/approved-public-artists-2026-09-27.json'), 'utf8')) as { release: string; artists: Entry[] };
const edited = 'SYNTHETIC_UNAPPROVED_EDIT';
const fixture = (entry: Entry): ArtistPersonaSourceArtist => ({
  id: '00000000-0000-4000-8000-000000000781', slug: entry.slug, displayName: entry.displayName, status: 'active',
  publicProfile: { tagline: entry.tagline, summary: entry.summary, publicStory: entry.publicStory,
    personalityKeywords: [...entry.personalityKeywords],
    publicMetadata: { approvedRelease: manifest.release, profileFacts: { ...entry.profileFacts } } },
  contentProfile: { contentTone: entry.contentTone },
});

describe('canonical persona authority is independent of mutable presentation', () => {
  it.each(manifest.artists)('retains literal canonical voice and binding through edits for $slug', entry => {
    const current = fixture(entry), original = selectArtistPersona(current);
    if (!isLockedArtistPersona(original)) throw new Error('Approved fixture must select its existing source');
    current.publicProfile = { tagline: edited, summary: edited, publicStory: edited,
      personalityKeywords: [edited], publicMetadata: { approvedRelease: manifest.release,
        profileFacts: { synthetic: edited }, chatPersonaSeed: { relationshipToneKo: edited } } };
    current.contentProfile = { contentTone: edited };
    const before = JSON.stringify(current), selected = selectArtistPersona(current);
    expect(isLockedArtistPersona(selected)).toBe(true);
    if (!isLockedArtistPersona(selected)) throw new Error('Presentation edits must not replace the selected canon');
    expect(selected.binding).toBe(original.binding);
    expect(selected.approvedPublicFields).toEqual(original.approvedPublicFields);
    expect(buildArtistPersonaLockInstructions(selected)).not.toContain(edited);
    expect(buildArtistPersonaLockInstructions(selected)).toBe(buildArtistPersonaLockInstructions(original));
    expect(artistPersonaLockMetadata(selected)).toMatchObject({
      personalityAuthority: 'exact_approved_public_release', mutableProfileValuesApproved: false,
      completeValuesApproval: false, completeRelationshipBoundaryApproval: false, allArtistsCovered: false,
    });
    expect(JSON.stringify(current)).toBe(before);
  });

  it.each(['archived', 'renamed', 'withdrawn', 'public_row_missing', 'content_row_missing'] as const)(
    'does not retain an issued selection after %s eligibility changes', condition => {
      const current = fixture(manifest.artists[0]), selected = selectArtistPersona(current);
      if (condition === 'archived') current.status = 'archived';
      if (condition === 'renamed') current.displayName = 'Synthetic other identity';
      if (condition === 'withdrawn') current.publicProfile!.publicMetadata = { approvedRelease: 'withdrawn' };
      if (condition === 'public_row_missing') current.publicProfile = null;
      if (condition === 'content_row_missing') current.contentProfile = null;
      expect(selectArtistPersona(current).status).toBe('unverified');
      expect(artistPersonaSelectionMatches(selected, selectArtistPersona(current))).toBe(false);
    },
  );

  it('separates missing optional fact copies from explicit existing withdrawal controls', () => {
    const entry = manifest.artists.find(row => Boolean(row.profileFacts['\uD32C\uB364\uBA85']))!;
    const current = fixture(entry), before = selectArtistPersona(current);
    current.publicProfile!.publicMetadata = { approvedRelease: manifest.release };
    expect(artistPersonaSelectionMatches(before, selectArtistPersona(current))).toBe(true);
    current.publicProfile!.publicMetadata = { approvedRelease: manifest.release,
      profileFacts: { fandomNameStatus: 'withdrawn' } };
    expect(selectArtistPersona(current)).toEqual({ status: 'unverified', reason: 'reviewed_public_fact_status_changed' });
  });

  it('keeps an initially unselected known identity and outside-release identity explicitly unverified', () => {
    const current = fixture(manifest.artists[0]);
    current.publicProfile!.publicMetadata = { profileFacts: { ...manifest.artists[0].profileFacts } };
    expect(selectArtistPersona(current)).toEqual({ status: 'unverified', reason: 'approved_release_not_selected' });
    current.slug = 'synthetic-uncovered-artist';
    expect(selectArtistPersona(current)).toEqual({ status: 'unverified', reason: 'artist_not_in_approved_release' });
  });
});
