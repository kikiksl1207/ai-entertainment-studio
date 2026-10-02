import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { approvedPublicArtistProfile } from './approved-artist-profile.policy';

const manifest = JSON.parse(readFileSync(resolve(__dirname,
  '../../../prisma/approved-public-artists-2026-09-27.json'), 'utf8')) as {
  release: string;
  artists: Array<{ slug: string; profileFacts: Record<string, unknown> }>;
};
const confirmed = manifest.artists.filter(artist => typeof artist.profileFacts['팬덤명'] === 'string');
const sourceFor = (artist = confirmed[0]) => ({
  summary: 'Confirmed public profile',
  publicMetadata: { approvedRelease: manifest.release, profileFacts: { ...artist.profileFacts }, keep: 'metadata' },
});

describe('approved artist fandom display compatibility', () => {
  it('covers exactly the eight fandom names from the approved manifest without mutating stored data', () => {
    expect(confirmed).toHaveLength(8);
    for (const artist of confirmed) {
      const source = sourceFor(artist);
      const snapshot = JSON.stringify(source);
      const profile = approvedPublicArtistProfile(artist.slug, 'active', source);
      expect(profile.publicMetadata.profileFacts).toMatchObject({
        fandomNameStatus: 'approved', fandomNameCandidate: artist.profileFacts['팬덤명'],
      });
      expect(profile.summary).toBe(source.summary);
      expect(profile.publicMetadata.keep).toBe('metadata');
      expect(JSON.stringify(source)).toBe(snapshot);
    }
  });

  it.each(['candidate', 'rejected', 'withdrawn', '', null, undefined, 'approved'])(
    'does not replace an explicit fandom status (%s)', status => {
      const source = sourceFor();
      source.publicMetadata.profileFacts.fandomNameStatus = status;
      expect(approvedPublicArtistProfile(confirmed[0].slug, 'active', source)).toBe(source);
    });

  it.each(['candidate', 'draft', 'planned', 'hidden', 'retired'])(
    'does not approve an inactive artist (%s)', status => {
      const source = sourceFor();
      expect(approvedPublicArtistProfile(confirmed[0].slug, status, source)).toBe(source);
    });

  it('does not approve changed names, conflicting candidates, unknown releases or unlisted artists', () => {
    const changed = sourceFor(); changed.publicMetadata.profileFacts['팬덤명'] = 'New unapproved name';
    const candidate = sourceFor(); candidate.publicMetadata.profileFacts.fandomNameCandidate = 'Pending name';
    const wrongRelease = sourceFor(); wrongRelease.publicMetadata.approvedRelease = 'other-release';
    for (const profile of [changed, candidate, wrongRelease]) {
      expect(approvedPublicArtistProfile(confirmed[0].slug, 'active', profile)).toBe(profile);
    }
    const source = sourceFor();
    for (const slug of ['seo-yuan', 'yoon-serin', 'unlisted', 'toString', '__proto__']) {
      expect(approvedPublicArtistProfile(slug, 'active', source)).toBe(source);
    }
  });

  it.each([null, undefined, [], {}, { publicMetadata: [] }, { publicMetadata: { profileFacts: [] } }])(
    'keeps malformed or absent profile data unchanged', source => {
      expect(approvedPublicArtistProfile(confirmed[0].slug, 'active', source)).toBe(source);
    });
});
