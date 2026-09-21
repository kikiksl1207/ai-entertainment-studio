import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { EXPECTED } from '../ott-media/ott-media.test-doubles';
import { LOCALES, MAX_BYTES } from '../ott-media/ott-media.contract';
import { sha256 } from '../ott-media/ott-media.storage';
import { PlaybackGraph } from './ott-playback.contract';
import { labels, playbackFixture, playbackPostgresClient } from './ott-playback.postgres-fixture';

const describePostgres = process.env.OTT_PLAYBACK_TEST_DATABASE_URL ? describe : describe.skip;
jest.setTimeout(30_000);
const error = (code: string) => ({ response: expect.objectContaining({ code: `OTT_${code}` }) });
type Fixture = Awaited<ReturnType<typeof playbackFixture>>;
type Progress = Awaited<ReturnType<Fixture['service']['startProgress']>>;
const choice = (p: Progress, key = 'take-b') => ({ manifestId: p.manifestId, expectedRevision: p.revision, nodeKey: p.node.key, choiceKey: key });
const position = (p: Progress, ms = 400) => ({ manifestId: p.manifestId, expectedRevision: p.revision, nodeKey: p.node.key, positionMs: ms });

describePostgres('private compound OTT playback with real PostgreSQL constraints (synthetic media/probe doubles)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    db = playbackPostgresClient();
    const [identity] = await db.$queryRaw<Array<{ name: string; actor: string; port: number }>>`
      SELECT current_database() AS name, current_user AS actor, inet_server_port() AS port`;
    expect(identity).toEqual({ name: 'lumina_ott_branch_qa', actor: 'lumina_qa', port: 55432 });
  });
  afterAll(async () => { await db?.$disconnect(); });

  it('assembles intro/B/C from three immutable source versions; choices reach distinct real pinned files', async () => {
    const f = await playbackFixture(db); const m = await f.manifest();
    expect(m.readiness).toMatchObject({ fiveLocaleReady: true, issues: [], publication: 'not_authorized' });
    const pins = await db.ottPlaybackAssetPin.findMany({ where: { manifestId: m.manifestId } });
    expect(pins).toHaveLength(3);
    expect(new Set(pins.map((pin) => pin.mediaVersionId)).size).toBe(3);
    expect(new Set(pins.map((pin) => pin.checksum)).size).toBe(3);
    for (const [locale, branch, clip] of [['ko', 'take-b', f.b], ['en', 'take-c', f.c]] as const) {
      const preview = await f.service.pinPreview(f.owner, m.manifestId, { locale });
      const p = await f.service.startProgress(f.owner, preview.previewId, {});
      expect(p.node.clip.fileId).toBe(f.intro.fileId);
      const next = await f.service.command(f.owner, p.progressId, 'choice', randomUUID(), choice(p, branch));
      expect(next.node.clip).toEqual(clip); expect(next.positionMs).toBe(100);
      expect(next.node.choices).toEqual([]); expect(next.status).toBe('active');
      expect(next.availableSubtitleLocales).toEqual([...LOCALES]);
      expect(next.subtitles[0].cues[0]).toMatchObject({ startMs: 100, endMs: 900 });
      const finished = await f.service.command(f.owner, p.progressId, 'position', randomUUID(), position(next, 900));
      expect(finished.status).toBe('completed');
      expect((await f.service.startProgress(f.owner, preview.previewId, {})).revision).toBe(finished.revision);
      const record = await db.ottPlaybackCommand.findFirstOrThrow({ where: { progressId: p.progressId, kind: 'choice' } });
      expect(record.request).toEqual(choice(p, branch));
      expect(JSON.stringify(next)).not.toMatch(/ownerId|authorId|storageKey|signature|secret|token|publicUrl/);
    }
  });

  it('supports only declared rejoins and can reuse offsets in the common intro file', async () => {
    const f = await playbackFixture(db);
    for (const node of f.graph.nodes.slice(1)) {
      node.ending = null;
      node.choices = [{ key: 'join', label: labels(), targetNodeKey: 'joined' }];
    }
    f.graph.nodes.push({ key: 'joined', clip: { ...f.intro, startMs: 500, endMs: 1000 }, rejoin: true,
      choices: [], ending: { key: 'joined-end', label: labels() } });
    const { progress } = await f.playable();
    const b = await f.service.command(f.owner, progress.progressId, 'choice', randomUUID(), choice(progress));
    const joined = await f.service.command(f.owner, progress.progressId, 'choice', randomUUID(), choice(b, 'join'));
    expect(joined.node.key).toBe('joined'); expect(joined.node.clip.fileId).toBe(f.intro.fileId);
    expect(joined.positionMs).toBe(500);
    f.graph.nodes[3].rejoin = false;
    await expect(f.manifest()).rejects.toMatchObject(error('INVALID'));
  });

  it('serializes same-key double click, returns the applied snapshot, and never advances twice', async () => {
    const f = await playbackFixture(db); const { progress: p } = await f.playable(); const key = randomUUID();
    const results = await Promise.all([0, 1].map(() => f.service.command(f.owner, p.progressId, 'choice', key, choice(p))));
    expect(results.map((r) => r.idempotentReplay).sort()).toEqual([false, true]);
    expect(results.map((r) => r.node.key)).toEqual(['b', 'b']);
    expect(await db.ottPlaybackCommand.count({ where: { progressId: p.progressId } })).toBe(1);
    const saved = await f.service.command(f.owner, p.progressId, 'position', randomUUID(), position(results[0]));
    expect(saved.revision).toBe(3);
    expect((await f.service.command(f.owner, p.progressId, 'choice', key, choice(p))).revision).toBe(2);
    expect((await f.service.getProgress(f.owner, p.progressId)).revision).toBe(3);
    await expect(f.service.command(f.owner, p.progressId, 'choice', key, choice(p, 'take-c'))).rejects.toMatchObject(error('CONFLICT'));
  });

  it.each(['choice', 'position'] as const)('allows exactly one competing choice versus %s at a revision', async (kind) => {
    const f = await playbackFixture(db); const { progress: p } = await f.playable();
    const results = await Promise.allSettled([
      f.service.command(f.owner, p.progressId, 'choice', randomUUID(), choice(p)),
      f.service.command(f.owner, p.progressId, kind, randomUUID(), kind === 'choice' ? choice(p, 'take-c') : position(p)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: error('CONFLICT') });
    expect((await f.service.getProgress(f.owner, p.progressId)).revision).toBe(2);
    expect(await db.ottPlaybackCommand.count({ where: { progressId: p.progressId } })).toBe(1);
  });

  it('never silently rebases old progress to a newer graph or latest source version', async () => {
    const f = await playbackFixture(db); const old = await f.playable();
    const newerSource = await f.source((await f.media.createVersion(f.owner, f.work.workId, {})).versionId, 'new-b');
    f.graph.nodes[1].clip = newerSource;
    const newer = await f.playable();
    expect(newer.manifest.graphRevision).toBe(old.manifest.graphRevision + 1);
    await expect(f.service.command(f.owner, old.progress.progressId, 'choice', randomUUID(),
      { ...choice(old.progress), manifestId: newer.manifest.manifestId })).rejects.toMatchObject(error('CONFLICT'));
    const resumed = await f.service.startProgress(f.owner, old.preview.previewId, {});
    const selected = await f.service.command(f.owner, resumed.progressId, 'choice', randomUUID(), choice(resumed));
    expect(selected.node.clip).toEqual(f.b);
    const page = await f.service.listManifests(f.owner, f.work.workId, { limit: '1' });
    expect(page.items[0].manifestId).toBe(newer.manifest.manifestId);
    expect(page.items[0].validation).toBe('not_checked');
    expect((await f.service.listManifests(f.owner, f.work.workId, { cursor: page.nextCursor, limit: '1' })).items[0].manifestId).toBe(old.manifest.manifestId);
  });

  it('replays creation by payload identity, never lets an idempotency key switch graphs', async () => {
    const f = await playbackFixture(db); const key = randomUUID(); const a = await f.manifest(f.graph, key);
    expect(await f.manifest(f.graph, key)).toMatchObject({ manifestId: a.manifestId, idempotentReplay: true });
    f.graph.nodes[0].choices[0].label.ko = 'Changed';
    await expect(f.manifest(f.graph, key)).rejects.toMatchObject(error('CONFLICT'));
    expect(await db.ottPlaybackManifest.count({ where: { ownerId: f.owner } })).toBe(1);
  });

  it('keeps missing assets/translations unready; owner locale preview does not pretend subtitles exist', async () => {
    const f = await playbackFixture(db, []);
    for (const node of f.graph.nodes) {
      for (const c of node.choices) c.label = { ko: 'Synthetic choice' };
      if (node.ending) node.ending.label = { ko: 'Synthetic ending' };
    }
    const m = await f.manifest();
    expect(m.readiness.previewReadyByLocale).toEqual({ ko: true, en: false, ja: false, 'zh-Hans': false, 'zh-Hant': false });
    expect(m.readiness.fiveLocaleReady).toBe(false);
    expect(m.readiness.issues.some((i) => i.code === 'subtitle_missing')).toBe(true);
    await expect(f.service.pinPreview(f.owner, m.manifestId, { locale: 'en' })).rejects.toMatchObject(error('NOT_READY'));
    const preview = await f.service.pinPreview(f.owner, m.manifestId, { locale: 'ko' });
    expect((await f.service.startProgress(f.owner, preview.previewId, {})).subtitles).toEqual([]);
    f.graph.nodes[1].clip = null;
    const missing = await f.manifest();
    expect(missing.readiness.issues).toContainEqual({ code: 'clip_missing', nodeKey: 'b' });
    await expect(f.service.pinPreview(f.owner, missing.manifestId, { locale: 'ko' })).rejects.toMatchObject(error('NOT_READY'));
  });

  it('rejects cross-owner, cross-work and wrong-version references before storing a manifest', async () => {
    const f = await playbackFixture(db);
    const otherWork = await f.media.createWork(f.owner, { title: 'Other synthetic work' });
    const foreignWork = await f.media.createWork(f.other, { title: 'Other synthetic owner' });
    const sources = [await f.source(otherWork.versionId, 'other-work'),
      await f.source(foreignWork.versionId, 'other-owner', f.other), { ...f.b, mediaVersionId: f.c.mediaVersionId }];
    for (const clip of sources) {
      f.graph.nodes[1].clip = clip;
      await expect(f.manifest()).rejects.toMatchObject(error('NOT_FOUND'));
    }
    expect(await db.ottPlaybackManifest.count({ where: { ownerId: f.owner } })).toBe(0);
  });

  it('rejects pending/expired uploads and clip bounds using verified duration', async () => {
    const f = await playbackFixture(db);
    const version = await f.media.createVersion(f.owner, f.work.workId, {});
    const file = await f.media.createIntent(f.owner, version.versionId, randomUUID(), EXPECTED);
    f.graph.nodes[1].clip = { ...f.b, fileId: file.fileId, mediaVersionId: version.versionId };
    await expect(f.manifest()).rejects.toMatchObject(error('NOT_READY'));
    const expiredVersion = await f.media.createVersion(f.owner, f.work.workId, {});
    const expired = await db.ottMediaUpload.create({ data: { ownerId: f.owner, versionId: expiredVersion.versionId,
      intentKey: randomUUID(), expected: EXPECTED, status: 'pending_upload', expiresAt: new Date(0) } });
    f.graph.nodes[1].clip = { ...f.b, fileId: expired.id, mediaVersionId: expiredVersion.versionId };
    await expect(f.manifest()).rejects.toMatchObject(error('EXPIRED'));
    f.graph.nodes[1].clip = { ...f.b, endMs: 1001 };
    await expect(f.manifest()).rejects.toMatchObject(error('INVALID'));
    expect(await db.ottPlaybackManifest.count({ where: { ownerId: f.owner } })).toBe(0);
  });

  it('returns no foreign graph/progress and refuses arbitrary targets, freeform and invalid positions', async () => {
    const f = await playbackFixture(db); const { manifest, preview, progress: p } = await f.playable();
    await expect(f.service.getManifest(f.other, manifest.manifestId)).rejects.toMatchObject(error('NOT_FOUND'));
    await expect(f.service.listManifests(f.other, f.work.workId, {})).rejects.toMatchObject(error('NOT_FOUND'));
    await expect(f.service.pinPreview(f.other, manifest.manifestId, { locale: 'ko' })).rejects.toMatchObject(error('NOT_FOUND'));
    await expect(f.service.startProgress(f.other, preview.previewId, {})).rejects.toMatchObject(error('NOT_FOUND'));
    await expect(f.service.getProgress(f.other, p.progressId)).rejects.toMatchObject(error('NOT_FOUND'));
    await expect(f.service.command(f.other, p.progressId, 'choice', randomUUID(), choice(p))).rejects.toMatchObject(error('NOT_FOUND'));
    for (const body of [{ ...choice(p), targetNodeKey: 'c' }, { ...choice(p), input: 'free text' }, choice(p, 'unmade')]) {
      await expect(f.service.command(f.owner, p.progressId, 'choice', randomUUID(), body)).rejects.toMatchObject(error('INVALID'));
    }
    for (const ms of [99, 901, 0.5]) await expect(f.service.command(f.owner, p.progressId, 'position', randomUUID(), position(p, ms))).rejects.toMatchObject(error('INVALID'));
    expect((await f.service.getProgress(f.owner, p.progressId)).revision).toBe(1);
  });

  it.each(['deleted', 'changed', 'revoked'] as const)('revalidates %s media for existing previews, progress and receipt replay', async (kind) => {
    const f = await playbackFixture(db); const { manifest, progress: p } = await f.playable(); const key = randomUUID();
    await f.service.command(f.owner, p.progressId, 'choice', key, choice(p));
    if (kind === 'deleted') f.storage.bytes.delete(f.b.fileId);
    if (kind === 'changed') f.storage.bytes.set(f.b.fileId, Buffer.from('different synthetic bytes'));
    if (kind === 'revoked') {
      await expect(f.media.revoke(f.other, f.b.fileId, {})).rejects.toMatchObject(error('NOT_FOUND'));
      await f.media.revoke(f.owner, f.b.fileId, {});
      expect(await f.media.revoke(f.owner, f.b.fileId, {})).toEqual({ fileId: f.b.fileId, revoked: true });
      await expect(f.media.browserSession(f.owner, f.b.fileId, {})).rejects.toMatchObject(error('NOT_READY'));
    }
    expect((await f.service.getManifest(f.owner, manifest.manifestId)).readiness.previewReadyByLocale.ko).toBe(false);
    await expect(f.service.pinPreview(f.owner, manifest.manifestId, { locale: 'ko' })).rejects.toMatchObject(error('NOT_READY'));
    await expect(f.service.getProgress(f.owner, p.progressId)).rejects.toMatchObject(error('NOT_READY'));
    await expect(f.service.command(f.owner, p.progressId, 'choice', key, choice(p))).rejects.toMatchObject(error('NOT_READY'));
    expect(await db.ottPlaybackCommand.count({ where: { progressId: p.progressId } })).toBe(1);
  });

  it.each(['deleted', 'changed'] as const)('checks %s off-path bytes only before entering that branch, with no partial transition', async (kind) => {
    const f = await playbackFixture(db); const manifest = await f.manifest();
    const preview = await f.service.pinPreview(f.owner, manifest.manifestId, { locale: 'ko' });
    if (kind === 'deleted') f.storage.bytes.delete(f.c.fileId);
    else f.storage.bytes.set(f.c.fileId, Buffer.from('damaged off-path synthetic bytes'));
    const open = jest.spyOn(f.storage, 'open');
    try {
      const p = await f.service.startProgress(f.owner, preview.previewId, {});
      expect(open.mock.calls.map(([id]) => id)).toEqual([f.intro.fileId]);
      open.mockClear();
      const healthy = await f.service.getProgress(f.owner, p.progressId);
      expect(healthy.validation).toEqual({ allReferencedPins: 'valid', bytes: 'current_scene', wholeGraphBytes: 'not_checked' });
      expect(healthy).not.toHaveProperty('readiness'); expect(healthy).not.toHaveProperty('fiveLocaleReady');
      expect(open.mock.calls.map(([id]) => id)).toEqual([f.intro.fileId]);
      open.mockClear();
      const saved = await f.service.command(f.owner, p.progressId, 'position', randomUUID(), position(p));
      expect(saved.validation.bytes).toBe('not_checked'); expect(open).not.toHaveBeenCalled();
      await expect(f.service.command(f.owner, p.progressId, 'choice', randomUUID(), choice(saved, 'take-c')))
        .rejects.toMatchObject(error('NOT_READY'));
      expect(open.mock.calls.map(([id]) => id)).toEqual([f.intro.fileId, f.c.fileId]);
      const persisted = await db.ottPlaybackProgress.findUniqueOrThrow({ where: { id: p.progressId } });
      expect(persisted).toMatchObject({ currentNodeKey: 'intro', revision: saved.revision, positionMs: 400 });
      expect(await db.ottPlaybackCommand.count({ where: { progressId: p.progressId, kind: 'choice' } })).toBe(0);
      open.mockClear();
      const b = await f.service.command(f.owner, p.progressId, 'choice', randomUUID(), choice(saved));
      expect(b.node.key).toBe('b');
      expect(open.mock.calls.map(([id]) => id)).toEqual([f.intro.fileId, f.b.fileId]);
      expect((await f.service.getManifest(f.owner, manifest.manifestId)).readiness.previewReadyByLocale.ko).toBe(false);
      await expect(f.service.pinPreview(f.owner, manifest.manifestId, { locale: 'ko' })).rejects.toMatchObject(error('NOT_READY'));
    } finally { open.mockRestore(); }
  });

  it('saves position without byte authorization, but fresh read/session/delivery still reject changed current bytes', async () => {
    const f = await playbackFixture(db); const { progress: p } = await f.playable();
    const session = await f.media.browserSession(f.owner, f.intro.fileId, {});
    const grant = f.delivery.readBrowserSession(session.cookie, f.intro.fileId);
    f.storage.bytes.set(f.intro.fileId, Buffer.from('damaged current synthetic bytes'));
    const open = jest.spyOn(f.storage, 'open'); const key = randomUUID();
    try {
      const saved = await f.service.command(f.owner, p.progressId, 'position', key, position(p));
      expect(saved.validation).toMatchObject({ bytes: 'not_checked', wholeGraphBytes: 'not_checked' });
      expect(open).not.toHaveBeenCalled();
      expect((await f.service.command(f.owner, p.progressId, 'position', key, position(p))).idempotentReplay).toBe(true);
      expect(open).not.toHaveBeenCalled();
      await expect(f.service.getProgress(f.owner, p.progressId)).rejects.toMatchObject(error('NOT_READY'));
      await expect(f.service.command(f.owner, p.progressId, 'choice', randomUUID(), choice(saved))).rejects.toMatchObject(error('NOT_READY'));
      await expect(f.media.browserSession(f.owner, f.intro.fileId, {})).rejects.toMatchObject(error('OBJECT_MISMATCH'));
      await expect(f.media.deliverBrowser(grant)).rejects.toMatchObject(error('OBJECT_MISMATCH'));
      expect((await db.ottPlaybackProgress.findUniqueOrThrow({ where: { id: p.progressId } })).revision).toBe(saved.revision);
    } finally { open.mockRestore(); }
  });

  it('checks every referenced revocation before any byte I/O, including an unvisited branch on saves and retries', async () => {
    const f = await playbackFixture(db); const { manifest, preview, progress: p } = await f.playable();
    const key = randomUUID();
    const saved = await f.service.command(f.owner, p.progressId, 'position', key, position(p));
    await f.media.revoke(f.owner, f.c.fileId, {});
    const open = jest.spyOn(f.storage, 'open');
    try {
      await expect(f.service.getProgress(f.owner, p.progressId)).rejects.toMatchObject(error('NOT_READY'));
      await expect(f.service.startProgress(f.owner, preview.previewId, {})).rejects.toMatchObject(error('NOT_READY'));
      await expect(f.service.command(f.owner, p.progressId, 'choice', randomUUID(), choice(saved))).rejects.toMatchObject(error('NOT_READY'));
      await expect(f.service.command(f.owner, p.progressId, 'position', randomUUID(), position(saved, 500))).rejects.toMatchObject(error('NOT_READY'));
      await expect(f.service.command(f.owner, p.progressId, 'position', key, position(p))).rejects.toMatchObject(error('NOT_READY'));
      expect(open).not.toHaveBeenCalled();
      await expect(f.service.pinPreview(f.owner, manifest.manifestId, { locale: 'ko' })).rejects.toMatchObject(error('NOT_READY'));
      expect((await db.ottPlaybackProgress.findUniqueOrThrow({ where: { id: p.progressId } })).revision).toBe(saved.revision);
    } finally { open.mockRestore(); }
  });

  it('rejects over-256MiB full graph validation before object I/O using explicit synthetic metadata rows, not movies', async () => {
    const f = await playbackFixture(db);
    const graph: PlaybackGraph = { entryNodeKey: 'n0', nodes: [] };
    for (let i = 0; i < 5; i++) {
      const version = await f.media.createVersion(f.owner, f.work.workId, {});
      const expected = { ...EXPECTED, sizeBytes: MAX_BYTES };
      // Artificial negative-test metadata only; no large file is allocated or claimed to exist.
      const upload = await db.ottMediaUpload.create({ data: { ownerId: f.owner, versionId: version.versionId,
        intentKey: randomUUID(), status: 'confirmed', expiresAt: new Date(0), expected,
        verified: { sha256: expected.sha256, sizeBytes: MAX_BYTES, mimeType: 'video/mp4', durationMs: 1000 },
        subtitles: [], confirmationHash: sha256('[]') } });
      graph.nodes.push({ key: `n${i}`, clip: { fileId: upload.id, mediaVersionId: version.versionId, startMs: 0, endMs: 900 },
        rejoin: false, choices: i === 4 ? [] : [{ key: 'next', label: labels(), targetNodeKey: `n${i + 1}` }],
        ending: i === 4 ? { key: 'end', label: labels() } : null });
    }
    const open = jest.spyOn(f.storage, 'open');
    try {
      await expect(f.manifest(graph)).rejects.toMatchObject(error('INVALID'));
      expect(open).not.toHaveBeenCalled();
      expect(await db.ottPlaybackManifest.count({ where: { ownerId: f.owner } })).toBe(0);
    } finally { open.mockRestore(); }
  });

  it('enforces immutable manifests/source pins/previews/receipts, owner FKs and progress bounds in PostgreSQL', async () => {
    const f = await playbackFixture(db); const { manifest: m, preview, progress: p } = await f.playable();
    await expect(db.ottPlaybackManifest.update({ where: { id: m.manifestId }, data: { revision: 9 } })).rejects.toThrow();
    await expect(db.ottPlaybackManifest.delete({ where: { id: m.manifestId } })).rejects.toThrow();
    await expect(db.ottPlaybackAssetPin.update({ where: { manifestId_fileId: { manifestId: m.manifestId, fileId: f.b.fileId } }, data: { checksum: 'a'.repeat(64) } })).rejects.toThrow();
    await expect(db.ottPlaybackPreview.update({ where: { id: preview.previewId }, data: { locale: 'en' } })).rejects.toThrow();
    await expect(db.ottPlaybackProgress.update({ where: { id: p.progressId }, data: { positionMs: 2000, revision: 2 } })).rejects.toThrow();
    await expect(db.ottPlaybackProgress.update({ where: { id: p.progressId }, data: { ownerId: f.other, revision: 2 } })).rejects.toThrow();
    await expect(db.ottPlaybackProgress.update({ where: { id: p.progressId }, data: { status: 'completed', revision: 2 } })).rejects.toThrow();
    await expect(db.ottPlaybackProgress.update({ where: { id: p.progressId }, data: { positionMs: 200 } })).rejects.toThrow();
    await expect(db.ottPlaybackPreview.create({ data: { ownerId: f.other, workId: f.work.workId, manifestId: m.manifestId, locale: 'ja' } })).rejects.toThrow();
    const selected = await f.service.command(f.owner, p.progressId, 'choice', randomUUID(), choice(p));
    await expect(db.ottPlaybackProgress.update({ where: { id: p.progressId }, data: { currentNodeKey: 'c', revision: 3 } })).rejects.toThrow();
    const receipt = await db.ottPlaybackCommand.findFirstOrThrow({ where: { progressId: p.progressId } });
    await expect(db.ottPlaybackCommand.update({ where: { id: receipt.id }, data: { snapshot: {} } })).rejects.toThrow();
    await f.media.revoke(f.owner, f.b.fileId, {});
    await expect(db.ottMediaRevocation.delete({ where: { fileId: f.b.fileId } })).rejects.toThrow();
    await expect(db.ottPlaybackProgress.update({ where: { id: p.progressId }, data: { positionMs: 200, revision: selected.revision + 1 } })).rejects.toThrow();
    const [triggers] = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='D'`;
    expect(Number(triggers.count)).toBe(0);
  });
});
