import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';
import { PrismaClient } from '@prisma/client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = resolve(root, 'server/prisma/approved-public-artists-2026-09-27.json');
const imageKeyPattern = /^assets\/characters\/([a-z0-9-]+)\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp)$/;

export function loadApprovedArtists() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.release !== 'approved-public-artists-2026-09-27' || manifest.artists.length !== 17) {
    throw new Error('Unexpected artist release manifest');
  }

  const slugs = new Set();
  for (const artist of manifest.artists) {
    if (!/^[a-z0-9-]+$/.test(artist.slug) || slugs.has(artist.slug)) {
      throw new Error(`Invalid or duplicate artist slug: ${artist.slug}`);
    }
    slugs.add(artist.slug);
    if (!artist.displayName || !artist.tagline || !artist.summary || !artist.styleNotes || !artist.contentTone) {
      throw new Error(`Incomplete public profile: ${artist.slug}`);
    }
    if (!Array.isArray(artist.gallery) || artist.gallery.length !== 14) {
      throw new Error(`Artist must have 14 approved gallery images: ${artist.slug}`);
    }
    const keys = [artist.cover, artist.thumb, ...artist.gallery];
    if (new Set(keys).size !== keys.length) {
      throw new Error(`Duplicate image in artist pack: ${artist.slug}`);
    }
    for (const key of keys) {
      const match = imageKeyPattern.exec(key);
      if (!match || match[1] !== artist.slug || key.includes('..')) {
        throw new Error(`Image outside approved artist pack: ${key}`);
      }
      const localFile = resolve(root, key);
      if (!localFile.startsWith(`${root}${sep}`) || !existsSync(localFile) || statSync(localFile).size === 0) {
        throw new Error(`Missing or empty approved image: ${key}`);
      }
    }
  }
  return manifest.artists;
}

function imageMime(key) {
  return key.endsWith('.webp') ? 'image/webp' : key.endsWith('.jpg') || key.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
}

async function applyArtist(prisma, approved) {
  await prisma.$transaction(async (db) => {
    const previous = await db.artist.findUnique({
      where: { slug: approved.slug }, include: { publicProfile: true },
    });
    if (previous && !['planned', 'candidate', 'draft', 'active'].includes(previous.status)) {
      throw new Error(`Refusing to reactivate ${approved.slug} from ${previous.status}`);
    }
    const previousMetadata = previous?.publicProfile?.publicMetadata;
    const previousRelease = previousMetadata && typeof previousMetadata === 'object' && !Array.isArray(previousMetadata)
      ? previousMetadata.approvedRelease : undefined;
    if (previous && previousRelease !== 'approved-public-artists-2026-09-27' &&
        !(approved.slug === 'ha-yuna' && ['planned', 'candidate', 'draft'].includes(previous.status))) {
      throw new Error(`Existing artist needs manual review before release: ${approved.slug}`);
    }

    const artist = await db.artist.upsert({
      where: { slug: approved.slug },
      update: {
        displayName: approved.displayName,
        status: previous?.status ?? 'draft',
        sortOrder: approved.sortOrder,
        launchedAt: previous?.launchedAt ?? new Date(),
        updatedAt: new Date(),
      },
      create: {
        slug: approved.slug,
        displayName: approved.displayName,
        status: 'draft',
        sortOrder: approved.sortOrder,
        launchedAt: new Date(),
      },
    });

    const oldMetadata = previous?.publicProfile?.publicMetadata;
    const publicMetadata = {
      ...(oldMetadata && typeof oldMetadata === 'object' && !Array.isArray(oldMetadata) ? oldMetadata : {}),
      profileFacts: approved.profileFacts,
      approvedRelease: 'approved-public-artists-2026-09-27',
    };
    await db.artistPublicProfile.upsert({
      where: { artistId: artist.id },
      update: {
        tagline: approved.tagline,
        summary: approved.summary,
        personalityKeywords: approved.personalityKeywords,
        publicStory: approved.publicStory,
        publicMetadata,
        updatedAt: new Date(),
      },
      create: {
        artistId: artist.id,
        tagline: approved.tagline,
        summary: approved.summary,
        personalityKeywords: approved.personalityKeywords,
        publicStory: approved.publicStory,
        publicMetadata,
      },
    });
    await db.artistVisualProfile.upsert({
      where: { artistId: artist.id },
      update: {
        visualKeywords: approved.visualKeywords,
        styleNotes: approved.styleNotes,
        primaryColor: approved.primaryColor,
        updatedAt: new Date(),
      },
      create: {
        artistId: artist.id,
        visualKeywords: approved.visualKeywords,
        styleNotes: approved.styleNotes,
        primaryColor: approved.primaryColor,
      },
    });
    await db.artistContentProfile.upsert({
      where: { artistId: artist.id },
      update: {
        contentTone: approved.contentTone,
        allowedTopics: approved.personalityKeywords,
        updatedAt: new Date(),
      },
      create: {
        artistId: artist.id,
        contentTone: approved.contentTone,
        allowedTopics: approved.personalityKeywords,
        blockedTopics: ['민감한 성적 묘사', '혐오 표현', '개인정보 요구'],
      },
    });

    const expected = new Set([approved.cover, approved.thumb, ...approved.gallery]);
    const oldLinks = await db.artistAsset.findMany({
      where: { artistId: artist.id }, include: { asset: true },
    });
    const foreignLinks = oldLinks.filter((link) =>
      link.asset.storageProvider !== 'local' ||
      !link.asset.storageKey.startsWith(`assets/characters/${approved.slug}/`));
    if (foreignLinks.length) {
      throw new Error(`Non-release artist assets need manual review: ${approved.slug}`);
    }
    const staleIds = oldLinks.filter((link) => !expected.has(link.asset.storageKey)).map((link) => link.id);
    if (staleIds.length) {
      await db.artistAsset.deleteMany({ where: { id: { in: staleIds } } });
    }

    const images = [
      { key: approved.cover, usageType: 'cover', isPrimary: true, sortOrder: 10 },
      { key: approved.thumb, usageType: 'thumb', isPrimary: true, sortOrder: 20 },
      ...approved.gallery.map((key, index) => ({ key, usageType: 'gallery', isPrimary: false, sortOrder: 100 + index })),
    ];
    for (const image of images) {
      const previousAsset = await db.asset.findUnique({
        where: { storageProvider_storageKey: { storageProvider: 'local', storageKey: image.key } },
      });
      const oldAssetMetadata = previousAsset?.metadata;
      const assetMetadata = {
        ...(oldAssetMetadata && typeof oldAssetMetadata === 'object' && !Array.isArray(oldAssetMetadata)
          ? oldAssetMetadata : {}),
        title: `${approved.displayName} ${image.usageType}`,
        approvedRelease: 'approved-public-artists-2026-09-27',
        lifecycle: { status: 'active', approvedBy: 'approved-public-artists-2026-09-27' },
        uploadIntent: { status: 'uploaded', source: 'git-tracked-approved-asset' },
      };
      const asset = await db.asset.upsert({
        where: { storageProvider_storageKey: { storageProvider: 'local', storageKey: image.key } },
        update: { assetType: 'image', visibility: 'public', mimeType: imageMime(image.key), metadata: assetMetadata, updatedAt: new Date() },
        create: {
          assetType: 'image', visibility: 'public', storageProvider: 'local',
          storageKey: image.key, mimeType: imageMime(image.key),
          metadata: assetMetadata,
        },
      });
      await db.artistAsset.upsert({
        where: { artistId_assetId_usageType: { artistId: artist.id, assetId: asset.id, usageType: image.usageType } },
        update: { isPrimary: image.isPrimary, sortOrder: image.sortOrder },
        create: { artistId: artist.id, assetId: asset.id, usageType: image.usageType, isPrimary: image.isPrimary, sortOrder: image.sortOrder },
      });
    }
  }, { timeout: 30_000 });
}

async function main() {
  const artists = loadApprovedArtists();
  if (!process.argv.includes('--apply')) {
    console.log(`DRY RUN: ${artists.length} approved artists, 16 images each. No database changes.`);
    console.log(artists.map((artist) => artist.slug).join('\n'));
    return;
  }
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.artist.findMany({
      where: { slug: { in: artists.map((artist) => artist.slug) } },
      include: { publicProfile: true },
    });
    for (const row of existing) {
      const metadata = row.publicProfile?.publicMetadata;
      const sameRelease = metadata && typeof metadata === 'object' && !Array.isArray(metadata) &&
        metadata.approvedRelease === 'approved-public-artists-2026-09-27';
      if (!sameRelease && !(row.slug === 'ha-yuna' && ['planned', 'candidate', 'draft'].includes(row.status))) {
        throw new Error(`Existing artist needs manual review before release: ${row.slug}`);
      }
    }
    for (const artist of artists) {
      await applyArtist(prisma, artist);
      console.log(`Prepared ${artist.slug}`);
    }
    await prisma.$transaction(async (db) => {
      const prepared = await db.artist.findMany({
        where: { slug: { in: artists.map((artist) => artist.slug) } },
        include: { publicProfile: true, artistAssets: { include: { asset: true } } },
      });
      if (prepared.length !== artists.length || prepared.some((row) => {
        const metadata = row.publicProfile?.publicMetadata;
        const releaseMatches = metadata && typeof metadata === 'object' && !Array.isArray(metadata) &&
          metadata.approvedRelease === 'approved-public-artists-2026-09-27';
        const approved = artists.find((artist) => artist.slug === row.slug);
        const keys = new Set(row.artistAssets.filter((link) => link.asset.visibility === 'public')
          .map((link) => `${link.usageType}:${link.asset.storageKey}`));
        return !releaseMatches || !approved || !keys.has(`cover:${approved.cover}`) ||
          !keys.has(`thumb:${approved.thumb}`) ||
          approved.gallery.some((key) => !keys.has(`gallery:${key}`));
      })) {
        throw new Error('Approved artist release is incomplete; no new artist was activated');
      }
      await db.artist.updateMany({
        where: { slug: { in: artists.map((artist) => artist.slug) } },
        data: { status: 'active', updatedAt: new Date() },
      });
    });
    console.log(`Activated ${artists.length} approved artists`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
