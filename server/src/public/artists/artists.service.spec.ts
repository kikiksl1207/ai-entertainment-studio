import { ConfigService } from '@nestjs/config';
import { ArtistsService } from './artists.service';

describe('ArtistsService public image URLs', () => {
  const config = {
    get: jest.fn((key: string) => ({
      FRONTEND_PUBLIC_BASE_URL: 'https://www.lumina-stage.com/',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://private-bucket.example',
    })[key]),
  } as unknown as ConfigService;
  const service = new ArtistsService({} as never, config);
  const url = (key: string, provider: string) =>
    (service as unknown as { assetUrl: (key: string, provider: string) => string }).assetUrl(key, provider);

  it('serves git-tracked local character art from the public website', () => {
    expect(url('assets/characters/yoon-serin/cover.png', 'local'))
      .toBe('https://www.lumina-stage.com/assets/characters/yoon-serin/cover.png');
  });

  it('keeps object-storage assets on the configured object-storage host', () => {
    expect(url('assets/characters/yoon-serin/cover.png', 's3'))
      .toBe('https://private-bucket.example/assets/characters/yoon-serin/cover.png');
    expect(url('uploads/user-avatar.png', 'local'))
      .toBe('https://private-bucket.example/uploads/user-avatar.png');
  });

  it('does not treat traversal paths as public character images', () => {
    expect(url('assets/characters/yoon-serin/../private.png', 'local'))
      .toBe('https://private-bucket.example/assets/characters/yoon-serin/../private.png');
  });

  it('projects the same confirmed fandom flag in public list and detail records without a database write', () => {
    const artist = {
      slug: 'min-chaeon', status: 'active', artistAssets: [],
      publicProfile: { publicMetadata: {
        approvedRelease: 'approved-public-artists-2026-09-27',
        profileFacts: { '팬덤명': 'Chaeon Fit' },
      } },
    };
    const project = (service as unknown as {
      toPublicArtist: (artist: unknown, options: { includeContentProfile: boolean }) => {
        profile: { publicMetadata: { profileFacts: Record<string, unknown> } };
      };
    }).toPublicArtist.bind(service);
    for (const includeContentProfile of [false, true]) {
      expect(project(artist, { includeContentProfile }).profile.publicMetadata.profileFacts).toEqual({
        '팬덤명': 'Chaeon Fit', fandomNameStatus: 'approved', fandomNameCandidate: 'Chaeon Fit',
      });
    }
    expect(artist.publicProfile.publicMetadata.profileFacts).toEqual({ '팬덤명': 'Chaeon Fit' });
  });
});
