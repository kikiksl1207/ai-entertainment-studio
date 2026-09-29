import {
  PUBLIC_ARTIST_COPY_LOCALES,
  publicArtistCopyBySlug,
} from './public-artist-copy';

describe('approved public artist copy', () => {
  it.each(Object.entries(publicArtistCopyBySlug))(
    '%s provides complete, publishable copy in all five locales',
    (_slug, copyByLocale) => {
      expect(Object.keys(copyByLocale)).toEqual(PUBLIC_ARTIST_COPY_LOCALES);

      for (const locale of PUBLIC_ARTIST_COPY_LOCALES) {
        const copy = copyByLocale[locale];
        expect(copy.displayName.trim()).not.toBe('');
        expect(copy.tagline.trim()).not.toBe('');
        expect(copy.summary.trim()).not.toBe('');
        expect(copy.publicStory.trim()).not.toBe('');
        expect(Object.values(copy).join(' ')).not.toMatch(
          /\b(?:planned|candidate|TBD)\b|준비\s*중|후보/i,
        );
        expect(Array.from(copy.tagline).length).toBeLessThanOrEqual(60);
        expect(Array.from(copy.summary).length).toBeLessThanOrEqual(100);
        expect(Array.from(copy.publicStory).length).toBeLessThanOrEqual(240);
      }
    },
  );

  it.each(Object.entries(publicArtistCopyBySlug))(
    '%s keeps Korean public fields in Korean',
    (_slug, copyByLocale) => {
      const koreanCopy = Object.values(copyByLocale.ko).join(' ');
      expect(koreanCopy).toMatch(/[가-힣]/);
    },
  );
});
