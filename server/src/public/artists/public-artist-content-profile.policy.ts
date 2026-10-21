export function publicArtistContentProfile(profile: unknown) {
  if (profile === null || profile === undefined) return profile;
  if (typeof profile !== 'object' || Array.isArray(profile)) return null;
  const source = profile as Record<string, unknown>;
  return {
    artistId: source.artistId,
    contentTone: source.contentTone,
    allowedTopics: source.allowedTopics,
    blockedTopics: source.blockedTopics,
    updatedAt: source.updatedAt,
  };
}
