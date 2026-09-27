import { readFile } from 'node:fs/promises';

const apiBase = 'https://api.lumina-stage.com/api/v1';
const manifestUrl = new URL('../prisma/approved-public-artists-2026-09-27.json', import.meta.url);
const release = 'approved-public-artists-2026-09-27';
const originalSlugs = [
  'yoon-serin', 'han-seoyul', 'park-doa', 'choi-seojin',
  'oh-hyerin', 'cha-dohyun', 'seo-yuan', 'kwon-taejun',
];
const requestTimeoutMs = 12_000;
const detailConcurrency = 5;
const headConcurrency = 8;
const preActivation = process.argv.includes('--pre-activation');

const report = {
  checkedAt: new Date().toISOString(),
  target: apiBase,
  release,
  mode: preActivation ? 'pre-activation' : 'strict',
  readOnly: true,
  checks: [],
};

function check(name, passed, details) {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
}

function skip(name, reason) {
  report.checks.push({ name, status: 'skipped', reason });
}

function pending(name, details) {
  report.checks.push({ name, status: 'pending', ...details });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unique(values) {
  return [...new Set(values)];
}

function difference(left, right) {
  const other = new Set(right);
  return left.filter((value) => !other.has(value));
}

async function boundedMap(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

async function getJson(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) return { status: response.status, error: `HTTP ${response.status}` };
    return { status: response.status, data: await response.json() };
  } catch (error) {
    return { error: error.message };
  }
}

function approvedUrl(url, key) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      parsed.pathname.endsWith(`/${key}`);
  } catch {
    return false;
  }
}

function mediaFor(artist, approved, label) {
  const errors = [];
  const images = [];
  if (!isRecord(artist)) return { errors: [`${label}: missing artist`], images };
  const assets = artist.assets;
  if (!Array.isArray(assets)) return { errors: [`${label}: assets is not an array`], images };

  const expected = [
    ['cover', approved.cover],
    ['thumb', approved.thumb],
    ...approved.gallery.map((key) => ['gallery', key]),
  ];
  const actual = assets.filter(isRecord);
  if (actual.length !== 16 || assets.length !== 16) {
    errors.push(`${label}: expected 16 assets, got ${assets.length}`);
  }
  if (actual.filter((asset) => asset.usageType === 'gallery').length !== 14) {
    errors.push(`${label}: expected 14 gallery assets`);
  }
  for (const [usageType, key] of expected) {
    const matches = actual.filter((asset) => asset.usageType === usageType && approvedUrl(asset.url, key));
    if (matches.length !== 1) {
      errors.push(`${label}: expected one ${usageType} URL for ${key}, got ${matches.length}`);
    } else {
      images.push({ slug: approved.slug, usageType, url: matches[0].url });
    }
  }
  for (const [field, usageType, key] of [
    ['coverImage', 'cover', approved.cover],
    ['thumbnailImage', 'thumb', approved.thumb],
  ]) {
    const image = artist[field];
    if (!isRecord(image) || image.usageType !== usageType || !approvedUrl(image.url, key)) {
      errors.push(`${label}: ${field} does not match ${key}`);
    } else if (!actual.some((asset) => asset.id === image.id && asset.url === image.url)) {
      errors.push(`${label}: ${field} is not the matching asset`);
    }
  }
  return { errors, images };
}

async function headImage(image) {
  try {
    let url = image.url;
    for (let redirect = 0; redirect < 4; redirect++) {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) return { ...image, error: `HTTP ${response.status} without Location` };
        url = new URL(location, url).href;
        if (new URL(url).protocol !== 'https:') return { ...image, error: 'redirected outside HTTPS' };
        continue;
      }
      const contentType = response.headers.get('content-type') ?? '';
      const length = response.headers.get('content-length');
      if (!response.ok) return { ...image, error: `HTTP ${response.status}` };
      if (!/^image\//i.test(contentType)) return { ...image, error: `unexpected content-type: ${contentType || '(missing)'}` };
      if (length !== null && Number(length) <= 0) return { ...image, error: 'empty image' };
      return { ...image, status: response.status };
    }
    return { ...image, error: 'too many redirects' };
  } catch (error) {
    return { ...image, error: error.message };
  }
}

async function main() {
  const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--pre-activation');
  if (unknownArgs.length) throw new Error(`Unknown arguments: ${unknownArgs.join(', ')}`);
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const approved = Array.isArray(manifest.artists) ? manifest.artists : [];
  const newSlugs = approved.map((artist) => artist.slug);
  const expectedSlugs = [...originalSlugs, ...newSlugs];
  const manifestErrors = [];
  if (manifest.release !== release || approved.length !== 17) manifestErrors.push('expected release ID and 17 artists');
  if (unique(newSlugs).length !== 17 || newSlugs.some((slug) => !/^[a-z0-9-]+$/.test(slug))) {
    manifestErrors.push('invalid or duplicate new slug');
  }
  if (difference(newSlugs, originalSlugs).length !== 17) manifestErrors.push('new slug overlaps original roster');
  for (const artist of approved) {
    if (typeof artist.cover !== 'string' || typeof artist.thumb !== 'string' ||
        !Array.isArray(artist.gallery) || artist.gallery.length !== 14 ||
        unique([artist.cover, artist.thumb, ...artist.gallery]).length !== 16) {
      manifestErrors.push(`${artist.slug}: expected distinct cover, thumb, and 14 gallery keys`);
    }
  }
  check('manifest', manifestErrors.length === 0, { expected: '17 distinct approved artists with 16 image keys each', errors: manifestErrors });
  if (manifestErrors.length) return;

  const listing = await getJson(`${apiBase}/artists`);
  const list = Array.isArray(listing.data) ? listing.data : null;
  check('artist-list-response', Boolean(list), {
    expected: 'JSON array', actual: list ? `array (${list.length})` : listing.error ?? 'unexpected JSON shape',
  });
  const listSlugs = list ? list.map((artist) => artist?.slug) : [];
  const listBySlug = new Map(list?.map((artist) => [artist?.slug, artist]) ?? []);
  const originalRosterIntact = Boolean(list) && list.length === 8 && unique(listSlugs).length === 8 &&
    list.every((artist) => artist?.status === 'active') &&
    difference(originalSlugs, listSlugs).length === 0 && difference(listSlugs, originalSlugs).length === 0;
  if (preActivation && originalRosterIntact) {
    pending('active-roster', {
      expected: '25 active after activation',
      actualCount: 8,
      originalCount: 8,
      approvedCount: 0,
      reason: 'The original roster is intact; awaiting activation of the 17 approved artists',
    });
    skip('per-slug-detail', 'Awaiting activation');
    skip('approved-media', 'Awaiting activation');
    skip('image-head', 'Awaiting approved media URLs');
    skip('main-pick-eligibility', 'Awaiting activation');
    return;
  }
  check('active-roster', Boolean(list) && list.length === 25 && unique(listSlugs).length === 25 &&
    list.every((artist) => artist?.status === 'active') &&
    difference(expectedSlugs, listSlugs).length === 0 && difference(listSlugs, expectedSlugs).length === 0, {
    expected: '25 active: 8 original + 17 approved, no duplicates or extras',
    actualCount: list?.length ?? null,
    originalCount: listSlugs.filter((slug) => originalSlugs.includes(slug)).length,
    approvedCount: listSlugs.filter((slug) => newSlugs.includes(slug)).length,
    missing: difference(expectedSlugs, listSlugs),
    unexpected: difference(listSlugs, expectedSlugs),
    inactive: list?.filter((artist) => artist?.status !== 'active').map((artist) => artist?.slug) ?? [],
  });

  const detailResponses = await boundedMap(expectedSlugs, detailConcurrency, async (slug) => ({
    slug, result: await getJson(`${apiBase}/artists/${encodeURIComponent(slug)}`),
  }));
  const detailBySlug = new Map();
  const detailErrors = [];
  for (const { slug, result } of detailResponses) {
    if (!isRecord(result.data) || result.data.slug !== slug || result.data.status !== 'active' ||
        (listBySlug.has(slug) && result.data.id !== listBySlug.get(slug).id)) {
      detailErrors.push(`${slug}: ${result.error ?? 'wrong slug, status, ID, or response shape'}`);
    } else {
      detailBySlug.set(slug, result.data);
    }
  }
  check('per-slug-detail', detailErrors.length === 0, {
    expected: '25 active detail responses with matching slugs and list IDs',
    verified: detailBySlug.size,
    errors: detailErrors,
  });

  const mediaErrors = [];
  const images = [];
  for (const artist of approved) {
    const listed = mediaFor(listBySlug.get(artist.slug), artist, `${artist.slug} list`);
    const detailed = mediaFor(detailBySlug.get(artist.slug), artist, `${artist.slug} detail`);
    mediaErrors.push(...listed.errors, ...detailed.errors);
    if (listed.errors.length === 0 && detailed.errors.length === 0) images.push(...detailed.images);
  }
  check('approved-media', mediaErrors.length === 0, {
    expected: 'all 17 in list and detail with exact approved cover, thumb, and 14 gallery URLs',
    completeArtists: images.length / 16,
    errors: mediaErrors,
  });

  if (images.length === 0) {
    skip('image-head', 'No complete approved artist media set is public yet; no URLs to probe');
  } else {
    const headResults = await boundedMap(images, headConcurrency, headImage);
    const headFailures = headResults.filter((result) => result.error).map(({ slug, usageType, url, error }) => ({ slug, usageType, url, error }));
    check('image-head', images.length === 272 && headFailures.length === 0, {
      expected: '272 reachable HTTPS images (HEAD 2xx, image content-type, nonempty if length supplied)',
      checked: headResults.length,
      reachable: headResults.length - headFailures.length,
      concurrency: headConcurrency,
      failures: headFailures,
    });
  }

  const pick = await getJson(`${apiBase}/popular-vote/main-pick`);
  if ([404, 405, 501].includes(pick.status) ||
      (isRecord(pick.data) && pick.data.campaign === null && Array.isArray(pick.data.rankings))) {
    skip('main-pick-eligibility', pick.error ?? 'no current campaign');
  } else if (!isRecord(pick.data) || !Array.isArray(pick.data.rankings)) {
    check('main-pick-eligibility', false, { expected: 'current campaign with rankings array', actual: pick.error ?? 'unexpected JSON shape' });
  } else {
    const rankedSlugs = pick.data.rankings.map((row) => row?.artist?.slug);
    check('main-pick-eligibility', rankedSlugs.length === 25 && unique(rankedSlugs).length === 25 &&
      difference(expectedSlugs, rankedSlugs).length === 0 && difference(rankedSlugs, expectedSlugs).length === 0, {
      expected: 'all 25 artists in current main Pick rankings, including zero-score artists',
      campaign: pick.data.campaign?.slug ?? null,
      actualCount: rankedSlugs.length,
      missing: difference(expectedSlugs, rankedSlugs),
      unexpected: difference(rankedSlugs, expectedSlugs),
    });
  }
}

try {
  await main();
} catch (error) {
  check('verifier-execution', false, { error: error.message });
}
report.status = report.checks.some((item) => item.status === 'failed') ? 'failed' :
  report.checks.some((item) => item.status === 'pending') ? 'pending' : 'passed';
console.log(JSON.stringify(report, null, 2));
if (report.status === 'failed') process.exitCode = 1;
