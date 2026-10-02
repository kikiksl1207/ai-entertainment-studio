const release = 'approved-public-artists-2026-09-27';

const approvedFandomNames: Readonly<Record<string, string>> = {
  'min-chaeon': 'Chaeon Fit',
  'kang-sia': 'Sia Hours',
  'lee-jiwon': 'Jiwon Drive',
  'ha-yuna': 'Yunatic',
  'baek-ria': 'Ria Wave',
  'oh-yuna': 'Yuna Splash',
  'seo-hamin': 'Hamin Crew',
  'ryu-taeo': 'Taeo Run',
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

// Repair the omitted display flag only for the exact previously approved pack.
export function approvedPublicArtistProfile<T>(slug: string, status: string, profile: T): T {
  const source = record(profile);
  const metadata = record(source?.publicMetadata);
  const facts = record(metadata?.profileFacts);
  if (status !== 'active' || !source || !metadata || !facts || metadata.approvedRelease !== release ||
      !Object.prototype.hasOwnProperty.call(approvedFandomNames, slug) ||
      facts['팬덤명'] !== approvedFandomNames[slug] ||
      Object.prototype.hasOwnProperty.call(facts, 'fandomNameStatus') ||
      Object.prototype.hasOwnProperty.call(facts, 'fandomNameCandidate')) return profile;

  return {
    ...source,
    publicMetadata: {
      ...metadata,
      profileFacts: { ...facts, fandomNameStatus: 'approved', fandomNameCandidate: facts['팬덤명'] },
    },
  } as T;
}
