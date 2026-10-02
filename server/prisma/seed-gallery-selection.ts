export type CanonicalGalleryDirectory = 'site-selected' | '.';

export function selectCanonicalGalleryImageKeys(
  slug: string,
  directory: CanonicalGalleryDirectory,
  fileExists: (storageKey: string) => boolean,
): string[] {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      (directory !== 'site-selected' && directory !== '.')) {
    throw new Error(`Unknown canonical gallery source: ${slug}/${directory}`);
  }

  const storageDirectory = `assets/characters/${slug}`;
  const prefix = directory === 'site-selected'
    ? `${storageDirectory}/site-selected/gallery-`
    : `${storageDirectory}/reference-final-`;
  const keys = Array.from({ length: 14 }, (_, index) =>
    `${prefix}${String(index + 1).padStart(2, '0')}.png`);
  const missing = keys.filter((key) => !fileExists(key));

  if (missing.length) {
    throw new Error(
      `Incomplete canonical gallery for ${slug}: ${keys.length - missing.length}/14 files; missing: ${missing.join(', ')}`,
    );
  }

  return keys;
}
