import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  ARTIST_PROFILE_SECTION_KEYS,
  CREATOR_GENERATION_PROFILE_SCHEMA,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { UpdateArtistStoryIdentityProfileDto } from '../generation-profile/dto/creator-generation-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorStudioService } from './creator-studio.service';
import { AdminService } from '../admin/admin.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Creator artist identity (real PostgreSQL, no files or providers)', () => {
  let db: PrismaClient;
  let service: CreatorStudioService;
  const runId = randomUUID();
  const owned = {
    users: new Set<string>(), artists: new Set<string>(), assets: new Set<string>(),
    operators: new Set<string>(), attachments: new Set<string>(),
    publicProfiles: new Set<string>(), visualProfiles: new Set<string>(),
    profiles: new Set<string>(), knowledgeUrls: new Set<string>(), audits: new Set<string>(),
  };
  const config = new ConfigService({});

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (process.env.NODE_ENV !== 'test' || parsed.protocol !== 'postgresql:' ||
        parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_creator_identity_qa' ||
        parsed.search || parsed.hash || url !== url!.trim() ||
        !/^postgresql:\/\/lumina_qa(?::[^@/?#]*)?@127\.0\.0\.1:55432\/lumina_creator_identity_qa$/.test(url!)) {
      throw new Error('Dedicated loopback creator identity QA database required');
    }
    // Main applies normal migrations first. Never migrate, reset or relax constraints here.
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const identity = await db.$queryRaw<Array<{ database: string; username: string }>>`
      SELECT current_database() AS database, current_user AS username`;
    expect(identity).toEqual([{ database: 'lumina_creator_identity_qa', username: 'lumina_qa' }]);
    service = new CreatorStudioService(db as unknown as PrismaService, config);
  });

  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Provider network forbidden'));
  });

  afterEach(async () => {
    try {
      if (db && owned.artists.size) {
        const profiles = await db.artistStoryIdentityProfile.findMany({
          where: { artistId: { in: [...owned.artists] } }, select: { id: true },
        });
        profiles.forEach(row => owned.profiles.add(row.id));
        const publicProfiles = await db.artistPublicProfile.findMany({
          where: { artistId: { in: [...owned.artists] } }, select: { artistId: true },
        });
        publicProfiles.forEach(row => owned.publicProfiles.add(row.artistId));
        const knowledgeUrls = await db.artistKnowledgeUrl.findMany({
          where: { artistId: { in: [...owned.artists] } }, select: { id: true },
        });
        knowledgeUrls.forEach(row => owned.knowledgeUrls.add(row.id));
        const audits = await db.auditEvent.findMany({
          where: { actorUserId: { in: [...owned.users] } },
          select: { id: true },
        });
        audits.forEach(row => owned.audits.add(row.id));
      }
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });

  afterAll(async () => {
    // Keep append-only/restricted rows intact. Main owns safety-checked dedicated DB cleanup.
    try {
      if (owned.users.size) console.info('Creator identity QA owned fixtures', JSON.stringify({
        runId, ...Object.fromEntries(Object.entries(owned).map(([key, ids]) => [key, [...ids]])),
      }));
    } finally {
      await db?.$disconnect();
    }
  });

  function settings(summary = 'Synthetic adult identity', decision = 'accepted') {
    return normalizeCreatorGenerationProfile('artist', {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'artist',
      sections: ARTIST_PROFILE_SECTION_KEYS.map(key => ({
        key, decision, value: { summary: `${summary}: ${key}` }, evidence: [],
      })),
    });
  }

  async function fixture() {
    const owner = await db.user.create({ data: {} }); owned.users.add(owner.id);
    const outsider = await db.user.create({ data: {} }); owned.users.add(outsider.id);
    const artist = await db.artist.create({ data: {
      slug: `creator-identity-qa-${runId}-${randomUUID()}`,
      displayName: 'Synthetic identity QA artist', status: 'active',
    } }); owned.artists.add(artist.id);
    const operator = await db.artistOperator.create({ data: {
      userId: owner.id, artistId: artist.id, role: 'owner', status: 'active', revokedAt: null,
    } }); owned.operators.add(operator.id);
    const visual = await db.artistVisualProfile.create({ data: {
      artistId: artist.id, visualKeywords: ['synthetic', 'adult'], styleNotes: 'Fixed identity QA',
      primaryColor: '#223344', secondaryColor: '#667788',
    } }); owned.visualProfiles.add(visual.artistId);
    const asset = await makeAsset();
    const attachment = await db.artistAsset.create({ data: {
      artistId: artist.id, assetId: asset.id, usageType: 'cover', isPrimary: true,
    } }); owned.attachments.add(attachment.id);
    return { owner, outsider, artist, operator, visual, asset, attachment };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function makeAsset() {
    const asset = await db.asset.create({ data: {
      assetType: 'image', visibility: 'public', storageProvider: 'local',
      storageKey: `qa/creator-identity/${runId}/${randomUUID()}.webp`, mimeType: 'image/webp',
      checksum: createHash('sha256').update(`synthetic-metadata-${randomUUID()}`).digest('hex'),
      fileSizeBytes: BigInt(128), metadata: { qaRunId: runId, lifecycle: { status: 'active' } },
    } }); owned.assets.add(asset.id);
    return asset;
  }

  function input(f: Fixture, profileSettings: unknown = settings(), references = [f.asset.id]) {
    return { referenceAssetIds: references, settings: profileSettings } as UpdateArtistStoryIdentityProfileDto;
  }

  async function save(f: Fixture, profileSettings: unknown = settings()) {
    return service.updateArtistStoryIdentityProfile(f.owner.id, f.artist.id, input(f, profileSettings));
  }

  async function snapshot(f: Fixture) {
    return {
      profiles: await db.artistStoryIdentityProfile.findMany({
        where: { artistId: f.artist.id }, orderBy: { profileVersion: 'asc' },
      }),
      audits: await db.auditEvent.findMany({
        where: { actorUserId: { in: [f.owner.id, f.outsider.id] } }, orderBy: { id: 'asc' },
      }),
    };
  }

  async function rejectsUnchanged(f: Fixture, action: () => Promise<unknown>, error: object) {
    const before = await snapshot(f);
    await expect(action()).rejects.toMatchObject(error);
    expect(await snapshot(f)).toEqual(before);
  }

  const code = (value: string) => ({ response: { code: value } });

  it('updates only the public summary with a persisted user artist-profile audit', async () => {
    const f = await fixture();
    const publicProfile = await db.artistPublicProfile.create({ data: {
      artistId: f.artist.id, summary: 'Original synthetic summary', tagline: 'Keep tagline',
      personalityKeywords: ['synthetic'], publicStory: 'Keep public story',
      publicMetadata: { qaRunId: runId },
    } }); owned.publicProfiles.add(publicProfile.artistId);
    const summary = 'Updated synthetic public summary';
    const contentBefore = await db.artistContentProfile.findUnique({ where: { artistId: f.artist.id } });
    const operatorBefore = await db.artistOperator.findUniqueOrThrow({ where: { id: f.operator.id } });
    await service.updateArtistProfile({ id: f.owner.id }, f.artist.id, { publicProfile: { summary } });
    expect(await db.artistPublicProfile.findUniqueOrThrow({ where: { artistId: f.artist.id } }))
      .toMatchObject({ ...publicProfile, summary, updatedAt: expect.any(Date) });
    expect(await db.artistVisualProfile.findUniqueOrThrow({ where: { artistId: f.artist.id } })).toEqual(f.visual);
    expect(await db.artistContentProfile.findUnique({ where: { artistId: f.artist.id } })).toEqual(contentBefore);
    expect(await db.artistOperator.findUniqueOrThrow({ where: { id: f.operator.id } })).toEqual(operatorBefore);
    const state = await snapshot(f);
    expect(state.profiles).toHaveLength(0);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ actorType: 'user', actorUserId: f.owner.id,
      action: 'creator_studio.artist_profile.update', targetType: 'artist', targetId: f.artist.id,
      beforeData: { publicProfile: { summary: publicProfile.summary } },
      afterData: { publicProfile: { summary } }, metadata: null });
    expect((await db.artist.findUniqueOrThrow({ where: { id: f.artist.id } })).status).toBe('active');
  });

  it('creates and updates a pending YouTube reference with two sanitized user audits and no fetch', async () => {
    const f = await fixture();
    const safeUrl = 'https://www.youtube.com/watch?v=qaIdentity1';
    const description = 'Synthetic creator reference description';
    const created = await service.createKnowledgeUrl({ id: f.owner.id }, {
      artistId: f.artist.id, type: 'youtube', url: safeUrl, description, allowChatRef: false,
    });
    owned.knowledgeUrls.add(created.item.id);
    expect(created.item).toMatchObject({ artistId: f.artist.id, status: 'pending', allowChatRef: false });
    const revisedDescription = 'Revised synthetic creator reference description';
    const updated = await service.updateKnowledgeUrl({ id: f.owner.id }, created.item.id, {
      description: revisedDescription,
    });
    expect(updated.item).toMatchObject({ id: created.item.id, status: 'pending', allowChatRef: false });
    const rows = await db.artistKnowledgeUrl.findMany({ where: { artistId: f.artist.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ submittedByUserId: f.owner.id, sourceType: 'youtube',
      status: 'pending', url: safeUrl, canonicalUrl: safeUrl, artistDescription: revisedDescription,
      summary: revisedDescription, allowChatReference: false, reviewedByUserId: null, reviewedAt: null,
      metadata: { externalFetchPerformed: false, rawPageBodyStored: false,
        summarySource: 'artist_description_revision' } });
    const state = await snapshot(f);
    expect(state.profiles).toHaveLength(0);
    expect(state.audits).toHaveLength(2);
    expect(state.audits.map(row => row.action).sort()).toEqual([
      'creator_studio.artist_knowledge_url.create', 'creator_studio.artist_knowledge_url.update',
    ]);
    for (const audit of state.audits) expect(audit).toMatchObject({ actorUserId: f.owner.id,
      actorType: 'user', targetType: 'artist_knowledge_url', targetId: created.item.id,
      afterData: { status: 'pending', artistId: f.artist.id, summaryPresent: true },
      metadata: { rawUrlStored: false, rawPageBodyStored: false, tokenCookiePasswordStored: false,
        providerPayloadStored: false, dbUrlStored: false } });
    const auditText = JSON.stringify(state.audits);
    for (const sensitive of [safeUrl, description, revisedDescription]) expect(auditText).not.toContain(sensitive);
    expect(await db.artistOperator.findUniqueOrThrow({ where: { id: f.operator.id } })).toEqual(f.operator);
  });

  it('persists update then approval with SQL-allowed user audits and exact identity pins', async () => {
    const f = await fixture();
    const normalized = settings();
    const sourceFingerprint = createHash('sha256').update(stableJson({
      artistId: f.artist.id, displayName: f.artist.displayName,
      visualProfile: { visualKeywords: f.visual.visualKeywords, styleNotes: f.visual.styleNotes,
        primaryColor: f.visual.primaryColor, secondaryColor: f.visual.secondaryColor },
      references: [{ assetId: f.asset.id, checksum: f.asset.checksum, usageType: f.attachment.usageType }],
    })).digest('hex');
    const draftFingerprint = creatorGenerationProfileFingerprint(sourceFingerprint, normalized);
    const saved = await save(f);
    expect(saved).toMatchObject({ artistId: f.artist.id, profile: {
      status: 'needs_review', profileVersion: 1, reviewRevision: 0, reviewRequired: true,
      sourceFingerprint, draftFingerprint, referenceAssetIds: [f.asset.id], draftSettings: normalized,
      approvedSettings: null, approvedFingerprint: null, approvedAt: null,
    } });
    const approved = await service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: draftFingerprint,
    });
    expect(approved.profile).toMatchObject({ id: saved.profile.id, status: 'approved',
      reviewRequired: false, reviewRevision: 1, approvedFingerprint: draftFingerprint,
      approvedSettings: normalized, approvedAt: expect.any(Date) });
    const stored = await snapshot(f);
    expect(stored.profiles).toHaveLength(1);
    expect(stored.profiles[0]).toMatchObject({ approvedByUserId: f.owner.id, status: 'approved',
      reviewRevision: 1, approvedAt: expect.any(Date), draftFingerprint, approvedFingerprint: draftFingerprint });
    expect(stored.audits).toHaveLength(2);
    for (const audit of stored.audits) expect(audit).toMatchObject({
      actorType: 'user', actorUserId: f.owner.id, targetType: 'artist_story_identity_profile',
      targetId: saved.profile.id, metadata: { artistId: f.artist.id,
        referenceAssetCount: 1, referenceChecksums: [f.asset.checksum] },
    });
    expect(stored.audits.find(row => row.action === 'artist_story_identity_profile.draft_saved'))
      .toMatchObject({ beforeData: null, afterData: { status: 'needs_review', profileVersion: 1,
        sourceFingerprint, draftFingerprint } });
    expect(stored.audits.find(row => row.action === 'artist_story_identity_profile.approved'))
      .toMatchObject({ beforeData: { status: 'needs_review', reviewRevision: 0 },
        afterData: { status: 'approved', profileVersion: 1, reviewRevision: 1,
          approvedFingerprint: draftFingerprint } });
    await rejectsUnchanged(f, () => service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: draftFingerprint,
    }), code('GENERATION_PROFILE_DRAFT_CHANGED'));
  });

  it('updates an unapproved draft in place but versions a newly reviewed approved identity', async () => {
    const f = await fixture();
    const first = await save(f);
    const second = await save(f, settings('Edited identity'));
    expect(second.profile).toMatchObject({ id: first.profile.id, profileVersion: 1, reviewRevision: 0 });
    expect(second.profile.draftFingerprint).not.toBe(first.profile.draftFingerprint);
    await rejectsUnchanged(f, () => service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: first.profile.draftFingerprint!,
    }), code('GENERATION_PROFILE_DRAFT_CHANGED'));
    await service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: second.profile.draftFingerprint!,
    });
    const frozen = await db.artistStoryIdentityProfile.findUniqueOrThrow({ where: { id: first.profile.id } });
    const third = await save(f, settings('Next reviewed identity'));
    expect(third.profile).toMatchObject({ profileVersion: 2, status: 'needs_review',
      reviewRevision: 0, approvedSettings: null, approvedFingerprint: null, approvedAt: null });
    expect(third.profile.id).not.toBe(first.profile.id);
    expect(await db.artistStoryIdentityProfile.findUniqueOrThrow({ where: { id: first.profile.id } })).toEqual(frozen);
    await rejectsUnchanged(f, () => service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: second.profile.draftFingerprint!,
    }), code('GENERATION_PROFILE_DRAFT_CHANGED'));
  });

  it.each(['outsider', 'inactive', 'revoked'] as const)('rejects %s access with zero identity/audit writes', async access => {
    const f = await fixture();
    const saved = await save(f);
    if (access === 'inactive') await db.artistOperator.update({ where: { id: f.operator.id }, data: { status: 'revoked' } });
    if (access === 'revoked') await db.artistOperator.update({ where: { id: f.operator.id }, data: { revokedAt: new Date() } });
    const userId = access === 'outsider' ? f.outsider.id : f.owner.id;
    const transactions = jest.spyOn(db, '$transaction');
    await rejectsUnchanged(f, () => service.updateArtistStoryIdentityProfile(userId, f.artist.id, input(f)), { status: 403 });
    await rejectsUnchanged(f, () => service.approveArtistStoryIdentityProfile(userId, f.artist.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    }), { status: 403 });
    expect(transactions).not.toHaveBeenCalled();
  });

  it.each(['empty', 'too_many', 'duplicate', 'missing', 'unattached', 'other_artist'] as const)
    ('rejects %s source references before persistence', async referenceCase => {
      const f = await fixture();
      let references: string[] = [f.asset.id];
      let expectedCode = 'ARTIST_IDENTITY_REFERENCE_NOT_OWNED';
      if (referenceCase === 'empty') { references = []; expectedCode = 'ARTIST_IDENTITY_REFERENCE_COUNT_INVALID'; }
      if (referenceCase === 'too_many') { references = Array.from({ length: 9 }, () => randomUUID()); expectedCode = 'ARTIST_IDENTITY_REFERENCE_COUNT_INVALID'; }
      if (referenceCase === 'duplicate') { references = [f.asset.id, f.asset.id]; expectedCode = 'ARTIST_IDENTITY_REFERENCE_DUPLICATE'; }
      if (referenceCase === 'missing') references = [randomUUID()];
      if (referenceCase === 'unattached') references = [(await makeAsset()).id];
      if (referenceCase === 'other_artist') references = [(await fixture()).asset.id];
      await rejectsUnchanged(f, () => service.updateArtistStoryIdentityProfile(f.owner.id, f.artist.id,
        input(f, settings(), references)), code(expectedCode));
      expect((await snapshot(f)).profiles).toHaveLength(0);
      expect((await snapshot(f)).audits).toHaveLength(0);
    });

  const invalidAssets: Array<[string, Prisma.AssetUpdateInput]> = [
    ['non-image', { assetType: 'video' }],
    ['non-image MIME', { mimeType: 'application/octet-stream' }],
    ['missing checksum', { checksum: null }],
    ['archived', { metadata: { lifecycle: { status: 'archived' } } }],
    ['pending upload', { metadata: { lifecycle: { status: 'active' }, uploadIntent: { status: 'pending_upload' } } }],
  ];
  it.each(invalidAssets)('rejects a %s asset on both save and approval', async (_label, data) => {
    const f = await fixture();
    const saved = await save(f);
    await db.asset.update({ where: { id: f.asset.id }, data });
    await rejectsUnchanged(f, () => save(f), code('ARTIST_IDENTITY_REFERENCE_NOT_READY'));
    await rejectsUnchanged(f, () => service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    }), code('ARTIST_IDENTITY_REFERENCE_NOT_READY'));
  });

  it.each(['checksum', 'display_name', 'visual_profile', 'usage_type'] as const)
    ('rejects approval after %s changes and creates a fresh source version', async sourceCase => {
      const f = await fixture();
      const saved = await save(f);
      if (sourceCase === 'checksum') await db.asset.update({ where: { id: f.asset.id }, data: { checksum: 'f'.repeat(64) } });
      if (sourceCase === 'display_name') await db.artist.update({ where: { id: f.artist.id }, data: { displayName: 'Changed identity name' } });
      if (sourceCase === 'visual_profile') await db.artistVisualProfile.update({ where: { artistId: f.artist.id }, data: { styleNotes: 'Changed visual basis' } });
      if (sourceCase === 'usage_type') await db.artistAsset.update({ where: { id: f.attachment.id }, data: { usageType: 'thumb' } });
      await rejectsUnchanged(f, () => service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
        expectedDraftFingerprint: saved.profile.draftFingerprint!,
      }), code('ARTIST_IDENTITY_SOURCE_CHANGED'));
      await rejectsUnchanged(f, () => service.updateArtistStoryIdentityProfile(f.owner.id, f.artist.id,
        input(f), saved.profile.sourceFingerprint), code('ARTIST_IDENTITY_SOURCE_CHANGED'));
      const frozen = await db.artistStoryIdentityProfile.findUniqueOrThrow({ where: { id: saved.profile.id } });
      const refreshed = await save(f);
      expect(refreshed.profile).toMatchObject({ profileVersion: 2, status: 'needs_review' });
      expect(refreshed.profile.sourceFingerprint).not.toBe(saved.profile.sourceFingerprint);
      expect(await db.artistStoryIdentityProfile.findUniqueOrThrow({ where: { id: saved.profile.id } })).toEqual(frozen);
    });

  it('rejects approval when an originally attached reference is detached', async () => {
    const f = await fixture();
    const saved = await save(f);
    await db.artistAsset.delete({ where: { id: f.attachment.id } });
    await rejectsUnchanged(f, () => service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    }), code('ARTIST_IDENTITY_REFERENCE_NOT_OWNED'));
  });

  it('requires a current draft and accepted decisions for both artist sections', async () => {
    const f = await fixture();
    await rejectsUnchanged(f, () => service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: 'a'.repeat(64),
    }), code('GENERATION_PROFILE_DRAFT_CHANGED'));
    for (const unresolved of [settings('Unreviewed', 'proposed'),
      { ...settings(), sections: settings().sections.slice(0, 1) }]) {
      const saved = await save(f, unresolved);
      await rejectsUnchanged(f, () => service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
        expectedDraftFingerprint: saved.profile.draftFingerprint!,
      }), code('GENERATION_PROFILE_REVIEW_INCOMPLETE'));
    }
  });

  it('rejects invalid profile sections and evidence source references without writes', async () => {
    const f = await fixture();
    const valid = settings();
    for (const [invalid, expectedCode] of [
      [{ ...valid, kind: 'story' }, 'GENERATION_PROFILE_SCHEMA_MISMATCH'],
      [{ ...valid, sections: [valid.sections[0], valid.sections[0]] }, 'GENERATION_PROFILE_SECTION_INVALID'],
      [{ ...valid, sections: [{ ...valid.sections[0], evidence: [{ sourceType: 'visual', sourceRef: '', summary: 'QA' }] }] }, 'GENERATION_PROFILE_EVIDENCE_INVALID'],
      [{ ...valid, sections: [{ ...valid.sections[0], evidence: [{ sourceType: 'external', sourceRef: f.asset.id, summary: 'QA' }] }] }, 'GENERATION_PROFILE_EVIDENCE_INVALID'],
    ] as const) {
      await rejectsUnchanged(f, () => save(f, invalid), code(expectedCode));
    }
  });

  function auditFault() {
    const observed: Array<{ id: string; status: string; profileVersion: number }> = [];
    const client = new Proxy(db, {
      get(target, key) {
        if (key === '$transaction') return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          target.$transaction(tx => callback(new Proxy(tx, {
            get(transaction, field) {
              if (field === 'auditEvent') return {
                create: async (args: Prisma.AuditEventCreateArgs) => {
                  const row = await transaction.artistStoryIdentityProfile.findUniqueOrThrow({
                    where: { id: args.data.targetId! },
                  });
                  observed.push({ id: row.id, status: row.status, profileVersion: row.profileVersion });
                  // Only fault the audit INSERT; profile writes and SQL CHECK are real.
                  return transaction.auditEvent.create({ ...args, data: { ...args.data, actorType: 'creator' } });
                },
              };
              return Reflect.get(transaction, field);
            },
          })));
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return { service: new CreatorStudioService(client as unknown as PrismaService, config), observed };
  }

  it('rolls back initial draft insertion on an actual audit CHECK failure and permits retry', async () => {
    const f = await fixture();
    const fault = auditFault();
    const before = await snapshot(f);
    await expect(fault.service.updateArtistStoryIdentityProfile(f.owner.id, f.artist.id, input(f)))
      .rejects.toThrow(/audit_events_actor_type_check/);
    expect(fault.observed).toEqual([{ id: expect.any(String), status: 'needs_review', profileVersion: 1 }]);
    expect(await snapshot(f)).toEqual(before);
    expect((await save(f)).profile).toMatchObject({ status: 'needs_review', profileVersion: 1 });
  });

  it('rolls back draft replacement and approval including every pin, revision and timestamp', async () => {
    const f = await fixture();
    const saved = await save(f);
    const before = await snapshot(f);
    const fault = auditFault();
    await expect(fault.service.updateArtistStoryIdentityProfile(f.owner.id, f.artist.id,
      input(f, settings('Must roll back')))).rejects.toThrow(/audit_events_actor_type_check/);
    expect(await snapshot(f)).toEqual(before);
    await expect(fault.service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    })).rejects.toThrow(/audit_events_actor_type_check/);
    expect(fault.observed).toEqual([
      { id: saved.profile.id, status: 'needs_review', profileVersion: 1 },
      { id: saved.profile.id, status: 'approved', profileVersion: 1 },
    ]);
    expect(await snapshot(f)).toEqual(before);
    expect((await service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    })).profile).toMatchObject({ status: 'approved', reviewRevision: 1 });
    expect((await snapshot(f)).audits).toHaveLength(2);
  });

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }

  function transactionClient(name: string, gate?: {
    delegate: 'artist' | 'artistStoryIdentityProfile' | 'artistAsset'; method: 'findUnique' | 'findFirst' | 'updateMany';
    entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>;
  }) {
    let gated = false;
    return new Proxy(db, {
      get(target, field) {
        if (field === '$transaction') return (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options = {},
        ) => target.$transaction(async tx => {
          await tx.$queryRaw`SELECT set_config('application_name', ${name}, true)`;
          return callback(new Proxy(tx, {
            get(transaction, key) {
              const value = Reflect.get(transaction, key);
              if (gate && key === gate.delegate) return new Proxy(value, {
                get(delegate, method) {
                  const original = Reflect.get(delegate, method);
                  if (method === gate.method) return async (...args: unknown[]) => {
                    const row = await original.apply(delegate, args);
                    if (!gated) {
                      gated = true; gate.entered.resolve(); await gate.release.promise;
                    }
                    return row;
                  };
                  return typeof original === 'function' ? original.bind(delegate) : original;
                },
              });
              return typeof value === 'function' ? value.bind(transaction) : value;
            },
          }));
        }, { ...options, maxWait: 10_000, timeout: 20_000 });
        const value = Reflect.get(target, field, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as unknown as PrismaService;
  }

  async function enteredWithin(promise: Promise<void>) {
    let timer!: NodeJS.Timeout;
    try {
      await Promise.race([promise, new Promise<never>((_done, reject) => {
        timer = setTimeout(() => reject(new Error('Commit fence gate not reached')), 5_000);
      })]);
    } finally { clearTimeout(timer); }
  }

  async function assertDatabaseLock(name: string, blockerName?: string) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity waiter
          WHERE waiter.datname=current_database() AND waiter.application_name=${name}
            AND waiter.wait_event_type='Lock' AND (${blockerName ?? null}::text IS NULL OR EXISTS (
              SELECT 1 FROM pg_stat_activity blocker WHERE blocker.pid=ANY(pg_blocking_pids(waiter.pid))
                AND blocker.datname=current_database() AND blocker.application_name=${blockerName ?? null}))) AS waiting`;
      if (rows[0]?.waiting) return;
      await new Promise(done => setTimeout(done, 20));
    }
    throw new Error('Expected an observed PostgreSQL lock wait, not a timing-only assertion');
  }

  it.each(['empty', 'approved'] as const)
    ('identity commit fence serializes two draft saves from an %s version', async state => {
      const f = await fixture();
      let frozen: unknown;
      if (state === 'approved') {
        const saved = await save(f);
        await service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
          expectedDraftFingerprint: saved.profile.draftFingerprint!,
        });
        frozen = await db.artistStoryIdentityProfile.findUniqueOrThrow({ where: { id: saved.profile.id } });
      }
      const gate = { delegate: 'artistStoryIdentityProfile' as const, method: 'findFirst' as const,
        entered: deferred(), release: deferred() };
      const firstService = new CreatorStudioService(transactionClient(`identity-first-${randomUUID()}`, gate), config);
      const secondName = `identity-second-${randomUUID()}`;
      const secondService = new CreatorStudioService(transactionClient(secondName), config);
      const first = firstService.updateArtistStoryIdentityProfile(f.owner.id, f.artist.id,
        input(f, settings('First concurrent save')));
      const firstSettled = first.then(value => ({ value }), error => ({ error }));
      let secondSettled: Promise<unknown> | undefined;
      try {
        await enteredWithin(gate.entered.promise);
        const second = secondService.updateArtistStoryIdentityProfile(f.owner.id, f.artist.id,
          input(f, settings('Second concurrent save')));
        secondSettled = second.then(value => ({ value }), error => ({ error }));
        await assertDatabaseLock(secondName);
        gate.release.resolve();
        const results = await Promise.all([first, second]);
        expect(results[1].profile.id).toBe(results[0].profile.id);
        expect(results[1].profile.draftFingerprint).not.toBe(results[0].profile.draftFingerprint);
        const rows = (await snapshot(f)).profiles;
        expect(rows).toHaveLength(state === 'empty' ? 1 : 2);
        expect(rows.at(-1)).toMatchObject({ profileVersion: state === 'empty' ? 1 : 2,
          draftSettings: settings('Second concurrent save'), status: 'needs_review' });
        if (frozen) expect(rows[0]).toEqual(frozen);
      } finally {
        gate.release.resolve(); await firstSettled; await secondSettled;
      }
    }, 30_000);

  it('identity commit fence accepts only one simultaneous approval and one user audit', async () => {
    const f = await fixture(), saved = await save(f);
    const gate = { delegate: 'artistStoryIdentityProfile' as const, method: 'findFirst' as const,
      entered: deferred(), release: deferred() };
    const firstService = new CreatorStudioService(transactionClient(`identity-approve-${randomUUID()}`, gate), config);
    const secondName = `identity-double-${randomUUID()}`;
    const secondService = new CreatorStudioService(transactionClient(secondName), config);
    const approval = { expectedDraftFingerprint: saved.profile.draftFingerprint! };
    const first = firstService.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, approval);
    const firstSettled = first.then(value => ({ value }), error => ({ error }));
    let secondSettled: Promise<unknown> | undefined;
    try {
      await enteredWithin(gate.entered.promise);
      const second = secondService.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, approval);
      secondSettled = second.then(value => ({ value }), error => ({ error }));
      await assertDatabaseLock(secondName); gate.release.resolve();
      expect((await first).profile).toMatchObject({ status: 'approved', reviewRevision: 1 });
      await expect(second).rejects.toMatchObject(code('GENERATION_PROFILE_DRAFT_CHANGED'));
      const state = await snapshot(f);
      expect(state.profiles).toHaveLength(1);
      expect(state.audits.filter(row => row.action === 'artist_story_identity_profile.approved')).toHaveLength(1);
    } finally { gate.release.resolve(); await firstSettled; await secondSettled; }
  }, 30_000);

  const mutations = ['new version', 'current draft', 'operator', 'checksum', 'archive', 'detach',
    'usage', 'visual', 'creator visual', 'name', 'admin link'] as const;
  it.each(mutations)('identity commit fence holds %s until approval and audit commit', async mutation => {
    const f = await fixture(), saved = await save(f);
    const gate = { delegate: 'artist' as const, method: 'findUnique' as const,
      entered: deferred(), release: deferred() };
    const approvalService = new CreatorStudioService(transactionClient(`identity-source-${randomUUID()}`, gate), config);
    const mutationName = `identity-mutation-${randomUUID()}`;
    const mutationClient = transactionClient(mutationName);
    const first = approvalService.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    });
    const firstSettled = first.then(value => ({ value }), error => ({ error }));
    let mutationSettled: Promise<unknown> | undefined;
    try {
      await enteredWithin(gate.entered.promise);
      let change: Promise<unknown>;
      if (mutation === 'creator visual') {
        change = new CreatorStudioService(mutationClient, config).updateArtistProfile({ id: f.owner.id }, f.artist.id, {
          visualProfile: { styleNotes: 'Concurrent creator visual' },
        });
      } else if (mutation === 'admin link') {
        change = new AdminService(mutationClient, config).linkArtistAsset({ id: f.owner.id }, f.artist.id, {
          assetId: f.asset.id, usageType: 'cover', isPrimary: true, sortOrder: 17,
        });
      } else {
        change = mutationClient.$transaction(async tx => {
          if (mutation === 'new version') return tx.artistStoryIdentityProfile.create({ data: {
            artistId: f.artist.id, profileVersion: 2, sourceFingerprint: saved.profile.sourceFingerprint,
            referenceAssetIds: [f.asset.id], status: 'needs_review', draftSettings: settings('New direct version') as unknown as Prisma.InputJsonValue,
            draftFingerprint: creatorGenerationProfileFingerprint(saved.profile.sourceFingerprint, settings('New direct version')),
          } });
          if (mutation === 'current draft') return tx.artistStoryIdentityProfile.update({ where: { id: saved.profile.id }, data: {
            status: 'needs_review', draftSettings: settings('Changed direct draft') as unknown as Prisma.InputJsonValue,
            draftFingerprint: creatorGenerationProfileFingerprint(saved.profile.sourceFingerprint, settings('Changed direct draft')),
            approvedSettings: Prisma.DbNull, approvedFingerprint: null, approvedAt: null, approvedByUserId: null,
          } });
          if (mutation === 'operator') return tx.artistOperator.update({ where: { id: f.operator.id },
            data: { status: 'revoked', revokedAt: new Date() } });
          if (mutation === 'checksum') return tx.asset.update({ where: { id: f.asset.id }, data: { checksum: 'd'.repeat(64) } });
          if (mutation === 'archive') return tx.asset.update({ where: { id: f.asset.id },
            data: { metadata: { qaRunId: runId, lifecycle: { status: 'archived' } } } });
          if (mutation === 'detach') return tx.artistAsset.delete({ where: { id: f.attachment.id } });
          if (mutation === 'usage') return tx.artistAsset.update({ where: { id: f.attachment.id }, data: { usageType: 'thumb' } });
          if (mutation === 'visual') return tx.artistVisualProfile.update({ where: { artistId: f.artist.id },
            data: { styleNotes: 'Concurrent visual change' } });
          return tx.artist.update({ where: { id: f.artist.id }, data: { displayName: 'Concurrent name change' } });
        });
      }
      mutationSettled = change.then(value => ({ value }), error => ({ error }));
      await assertDatabaseLock(mutationName); gate.release.resolve();
      expect((await first).profile).toMatchObject({ id: saved.profile.id, status: 'approved',
        approvedFingerprint: saved.profile.draftFingerprint, reviewRevision: 1 });
      await change;
      const state = await snapshot(f);
      expect(state.audits.filter(row => row.action === 'artist_story_identity_profile.approved')).toHaveLength(1);
      if (mutation === 'operator') await expect(save(f)).rejects.toMatchObject({ status: 403 });
      else if (mutation === 'current draft' || mutation === 'new version') {
        await expect(service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
          expectedDraftFingerprint: saved.profile.draftFingerprint!,
        })).rejects.toMatchObject(code('GENERATION_PROFILE_DRAFT_CHANGED'));
      } else if (mutation === 'archive' || mutation === 'detach') {
        await expect(save(f)).rejects.toMatchObject(code(mutation === 'archive'
          ? 'ARTIST_IDENTITY_REFERENCE_NOT_READY' : 'ARTIST_IDENTITY_REFERENCE_NOT_OWNED'));
      } else if (mutation === 'admin link') {
        expect(await db.artistAsset.findUniqueOrThrow({ where: { id: f.attachment.id } })).toMatchObject({ sortOrder: 17 });
      } else {
        const refreshed = await save(f);
        expect(refreshed.profile.sourceFingerprint).not.toBe(saved.profile.sourceFingerprint);
        expect(refreshed.profile.profileVersion).toBe(2);
      }
    } finally { gate.release.resolve(); await firstSettled; await mutationSettled; }
  }, 30_000);

  it.each(['operator', 'version', 'source'] as const)
    ('identity commit fence rejects %s committed between access preflight and transaction', async change => {
      const f = await fixture(), saved = await save(f);
      let mutated = false;
      const client = new Proxy(db, {
        get(target, field) {
          if (field === '$transaction') return async (
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options = {},
          ) => {
            if (!mutated) {
              mutated = true;
              if (change === 'operator') await db.artistOperator.update({ where: { id: f.operator.id }, data: { status: 'revoked' } });
              if (change === 'source') await db.asset.update({ where: { id: f.asset.id }, data: { checksum: 'e'.repeat(64) } });
              if (change === 'version') await db.artistStoryIdentityProfile.create({ data: {
                artistId: f.artist.id, profileVersion: 2, sourceFingerprint: saved.profile.sourceFingerprint,
                referenceAssetIds: [f.asset.id], status: 'needs_review', draftSettings: settings('New preflight version') as unknown as Prisma.InputJsonValue,
                draftFingerprint: creatorGenerationProfileFingerprint(saved.profile.sourceFingerprint, settings('New preflight version')),
              } });
            }
            return target.$transaction(callback, options);
          };
          const value = Reflect.get(target, field, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const raced = new CreatorStudioService(client as unknown as PrismaService, config);
      await expect(raced.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
        expectedDraftFingerprint: saved.profile.draftFingerprint!,
      })).rejects.toMatchObject(change === 'operator' ? { status: 403 }
        : code(change === 'version' ? 'GENERATION_PROFILE_DRAFT_CHANGED' : 'ARTIST_IDENTITY_SOURCE_CHANGED'));
      const state = await snapshot(f);
      expect(state.profiles.find(row => row.id === saved.profile.id)).toMatchObject({ status: 'needs_review', reviewRevision: 0 });
      expect(state.audits).toHaveLength(1);
    });

  it('identity commit fence requires every distinct image despite repeated usage links', async () => {
    const f = await fixture();
    const duplicate = await db.artistAsset.create({ data: {
      artistId: f.artist.id, assetId: f.asset.id, usageType: 'thumb', isPrimary: true,
    } }); owned.attachments.add(duplicate.id);
    const missing = await makeAsset();
    await rejectsUnchanged(f, () => service.updateArtistStoryIdentityProfile(f.owner.id, f.artist.id,
      input(f, settings(), [f.asset.id, missing.id])), code('ARTIST_IDENTITY_REFERENCE_NOT_OWNED'));
    const saved = await save(f);
    await service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    });
    expect((await snapshot(f)).profiles).toHaveLength(1);
    expect(saved.profile.referenceAssetIds).toEqual([f.asset.id]);
    expect((await snapshot(f)).audits[0].metadata).toMatchObject({ referenceAssetCount: 1,
      referenceChecksums: [f.asset.checksum] });
  });

  it('identity commit fence rejects settings modified without their content fingerprint', async () => {
    const f = await fixture(), saved = await save(f);
    await db.artistStoryIdentityProfile.update({ where: { id: saved.profile.id }, data: {
      draftSettings: settings('Modified without checksum') as unknown as Prisma.InputJsonValue,
    } });
    await rejectsUnchanged(f, () => service.approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    }), code('GENERATION_PROFILE_DRAFT_CHANGED'));
  });

  it('identity commit fence sees a new version whose insert obtained the parent first', async () => {
    const f = await fixture(), saved = await save(f);
    const entered = deferred(), release = deferred();
    const insert = db.$transaction(async tx => {
      await tx.artistStoryIdentityProfile.create({ data: {
        artistId: f.artist.id, profileVersion: 2, sourceFingerprint: saved.profile.sourceFingerprint,
        referenceAssetIds: [f.asset.id], status: 'needs_review',
        draftSettings: settings('Insert before approval') as unknown as Prisma.InputJsonValue,
        draftFingerprint: creatorGenerationProfileFingerprint(saved.profile.sourceFingerprint, settings('Insert before approval')),
      } });
      entered.resolve(); await release.promise;
    }, { timeout: 20_000 });
    const inserted = insert.then(value => ({ value }), error => ({ error }));
    const name = `identity-insert-first-${randomUUID()}`;
    let approved: Promise<unknown> | undefined;
    try {
      await enteredWithin(entered.promise);
      const approval = new CreatorStudioService(transactionClient(name), config).approveArtistStoryIdentityProfile(
        f.owner.id, f.artist.id, { expectedDraftFingerprint: saved.profile.draftFingerprint! });
      approved = approval.then(value => ({ value }), error => ({ error }));
      await assertDatabaseLock(name); release.resolve(); await insert;
      await expect(approval).rejects.toMatchObject(code('GENERATION_PROFILE_DRAFT_CHANGED'));
      expect((await snapshot(f)).profiles.map(row => row.status)).toEqual(['needs_review', 'needs_review']);
      expect((await snapshot(f)).audits).toHaveLength(1);
    } finally { release.resolve(); await inserted; await approved; }
  }, 30_000);

  it('identity commit fence versions a save that follows a committed approval', async () => {
    const f = await fixture(), saved = await save(f);
    const gate = { delegate: 'artistStoryIdentityProfile' as const, method: 'findFirst' as const,
      entered: deferred(), release: deferred() };
    const approving = new CreatorStudioService(transactionClient(`identity-approve-first-${randomUUID()}`, gate), config)
      .approveArtistStoryIdentityProfile(f.owner.id, f.artist.id, { expectedDraftFingerprint: saved.profile.draftFingerprint! });
    const approvalSettled = approving.then(value => ({ value }), error => ({ error }));
    const name = `identity-save-after-${randomUUID()}`;
    let savingSettled: Promise<unknown> | undefined;
    try {
      await enteredWithin(gate.entered.promise);
      const saving = new CreatorStudioService(transactionClient(name), config)
        .updateArtistStoryIdentityProfile(f.owner.id, f.artist.id, input(f, settings('Save after approval')));
      savingSettled = saving.then(value => ({ value }), error => ({ error }));
      await assertDatabaseLock(name); gate.release.resolve();
      const approved = await approving, updated = await saving;
      expect(approved.profile).toMatchObject({ status: 'approved', profileVersion: 1 });
      expect(updated.profile).toMatchObject({ status: 'needs_review', profileVersion: 2 });
      expect(updated.profile.id).not.toBe(saved.profile.id);
      expect((await snapshot(f)).profiles[0]).toMatchObject({ status: 'approved',
        draftFingerprint: saved.profile.draftFingerprint, approvedFingerprint: saved.profile.draftFingerprint, reviewRevision: 1 });
    } finally { gate.release.resolve(); await approvalSettled; await savingSettled; }
  }, 30_000);

  it('identity commit fence completes a new primary link begun before approval without a reverse lock cycle', async () => {
    const f = await fixture(), saved = await save(f), nextAsset = await makeAsset();
    const gate = { delegate: 'artistAsset' as const, method: 'updateMany' as const,
      entered: deferred(), release: deferred() };
    const writerName = `identity-link-first-${randomUUID()}`;
    const admin = new AdminService(transactionClient(writerName, gate), config);
    const linking = admin.linkArtistAsset({ id: f.owner.id }, f.artist.id, {
      assetId: nextAsset.id, usageType: 'cover', isPrimary: true,
    });
    const linked = linking.then(value => ({ value }), error => ({ error }));
    const approvalName = `identity-after-link-${randomUUID()}`;
    let approvalSettled: Promise<unknown> | undefined;
    try {
      await enteredWithin(gate.entered.promise);
      const approving = new CreatorStudioService(transactionClient(approvalName), config).approveArtistStoryIdentityProfile(
        f.owner.id, f.artist.id, { expectedDraftFingerprint: saved.profile.draftFingerprint! });
      approvalSettled = approving.then(value => ({ value }), error => ({ error }));
      await assertDatabaseLock(approvalName, writerName); gate.release.resolve();
      await linking;
      expect((await approving).profile).toMatchObject({ id: saved.profile.id, status: 'approved', reviewRevision: 1 });
      const links = await db.artistAsset.findMany({ where: { artistId: f.artist.id }, orderBy: { assetId: 'asc' } });
      links.forEach(row => owned.attachments.add(row.id));
      expect(links).toHaveLength(2);
      expect(links.find(row => row.assetId === nextAsset.id)).toMatchObject({ isPrimary: true, usageType: 'cover' });
      expect(links.find(row => row.assetId === f.asset.id)).toMatchObject({ isPrimary: false });
      expect((await snapshot(f)).audits).toHaveLength(3);
    } finally { gate.release.resolve(); await linked; await approvalSettled; }
  }, 30_000);

  it('identity commit fence returns the committed profile when access is revoked before response delivery', async () => {
    const f = await fixture();
    const client = new Proxy(db, {
      get(target, field) {
        if (field === '$transaction') return async (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options = {},
        ) => {
          const result = await target.$transaction(callback, options);
          await db.artistOperator.update({ where: { id: f.operator.id }, data: { status: 'revoked', revokedAt: new Date() } });
          return result;
        };
        const value = Reflect.get(target, field, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const response = await new CreatorStudioService(client as unknown as PrismaService, config).updateArtistProfile(
      { id: f.owner.id }, f.artist.id, { publicProfile: { summary: 'Committed before access revocation' } });
    expect(response.artist).toMatchObject({ id: f.artist.id, publicProfile: { summary: 'Committed before access revocation' } });
    expect(await db.artistOperator.findUniqueOrThrow({ where: { id: f.operator.id } })).toMatchObject({ status: 'revoked' });
    expect((await snapshot(f)).audits).toHaveLength(1);
    await expect(service.updateArtistProfile({ id: f.owner.id }, f.artist.id, { publicProfile: { summary: 'Not allowed' } }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('identity commit fence rolls back primary links when the admin audit violates its SQL constraint', async () => {
    const f = await fixture(), nextAsset = await makeAsset();
    const before = await db.artistAsset.findMany({ where: { artistId: f.artist.id }, orderBy: { id: 'asc' } });
    const client = new Proxy(db, {
      get(target, field) {
        if (field === '$transaction') return (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options = {},
        ) => target.$transaction(tx => callback(new Proxy(tx, {
          get(transaction, key) {
            if (key === 'auditEvent') return { create: async (args: Prisma.AuditEventCreateArgs) => {
              expect(await transaction.artistAsset.count({ where: { artistId: f.artist.id } })).toBe(2);
              return transaction.auditEvent.create({ ...args, data: { ...args.data, actorType: 'creator' } });
            } };
            const value = Reflect.get(transaction, key);
            return typeof value === 'function' ? value.bind(transaction) : value;
          },
        })), options);
        const value = Reflect.get(target, field, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(new AdminService(client as unknown as PrismaService, config).linkArtistAsset({ id: f.owner.id }, f.artist.id, {
      assetId: nextAsset.id, usageType: 'cover', isPrimary: true,
    })).rejects.toThrow(/audit_events_actor_type_check/);
    expect(await db.artistAsset.findMany({ where: { artistId: f.artist.id }, orderBy: { id: 'asc' } })).toEqual(before);
    expect((await snapshot(f)).audits).toHaveLength(0);
  });
});
