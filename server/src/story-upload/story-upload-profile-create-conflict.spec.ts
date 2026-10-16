import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  creatorGenerationProfileProjection,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
import { CreatorGenerationProfileSettingsDto } from '../generation-profile/dto/creator-generation-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StoryUploadStorageService } from './story-upload-storage.service';
import { StoryUploadService } from './story-upload.service';

// AUTHOR UNRUN. Actual whole service/policy; synthetic ORM staging is not SQL rollback proof.
const OWNER = '00000000-0000-4000-8000-000000000511';
const OTHER = '00000000-0000-4000-8000-000000000512';
const SUBMISSION = '00000000-0000-4000-8000-000000000513';
const PROFILE = '00000000-0000-4000-8000-000000000514';
const SOURCE = 'a'.repeat(64);
const CREATED = new Date('2026-10-16T00:00:00.000Z');
const TARGET = ['submission_id', 'profile_version'];
type Fields = Record<string, unknown>;
type Profile = {
  id: string; submissionId: string; ownerUserId: string; sourceFingerprint: string;
  profileVersion: number; reviewRevision: number; status: string;
  draftSettings: unknown; draftFingerprint: string | null; approvedSettings: unknown;
  approvedFingerprint: string | null; approvedByUserId: string | null; approvedAt: Date | null;
  analysisErrorCode: string | null; createdAt: Date; updatedAt: Date;
};
type Event = { tx: number; method: string; args?: unknown };
type Client = {
  storyUploadSubmission: { findFirst(args: { where: Fields; include: Fields }): Promise<{
    id: string; userId: string; requestFingerprint: string; generationProfiles: Profile[];
  } | null> };
  storyUploadGenerationProfile: { create(args: { data: Fields }): Promise<Profile> };
  auditEvent: { create(args: { data: Fields }): Promise<{ id: string }> };
};
type Options = {
  profiles?: Profile[]; pauseFirstRead?: boolean; missingSubmission?: boolean;
  createError?: unknown; auditError?: unknown; readError?: unknown; transactionError?: unknown;
};

function clone<T>(value: T): T {
  if (value === Prisma.DbNull || value === Prisma.JsonNull) return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => clone(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}

function settings(label = 'draft'): CreatorGenerationProfileSettingsDto {
  return { schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: [...STORY_PROFILE_SECTION_KEYS].map(key => ({ key, decision: 'accepted',
      value: { summary: `${label}:${key}`, enabled: true, ordinal: 0 },
      evidence: [{ sourceType: 'profile', sourceRef: 'synthetic-fixture', summary: label }],
    })),
  };
}

function profile(overrides: Partial<Profile> = {}): Profile {
  const draft = normalizeCreatorGenerationProfile('story', settings('approved-history'));
  const fingerprint = creatorGenerationProfileFingerprint(SOURCE, draft);
  return { id: PROFILE, submissionId: SUBMISSION, ownerUserId: OWNER, sourceFingerprint: SOURCE,
    profileVersion: 3, reviewRevision: 7, status: 'approved', draftSettings: draft,
    draftFingerprint: fingerprint, approvedSettings: clone(draft), approvedFingerprint: fingerprint,
    approvedByUserId: OWNER, approvedAt: clone(CREATED), analysisErrorCode: null,
    createdAt: clone(CREATED), updatedAt: clone(CREATED), ...overrides };
}

function known(code = 'P2002', meta?: Fields) {
  return new Prisma.PrismaClientKnownRequestError('Synthetic database failure', {
    code, clientVersion: 'synthetic', ...(meta === undefined ? {} : { meta }),
  });
}

function deferred() {
  let resolve: () => void = () => { throw new Error('Uninitialized fixture gate'); };
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function keys(value: object, expected: string[]) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function object(value: unknown): Fields {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Fields;
}

function fixture(options: Options = {}) {
  const rows = clone(options.profiles ?? [profile()]), audits: Fields[] = [];
  const attempts: Record<string, number> = {}, events: Event[] = [], faults: string[] = [];
  const firstRead = deferred(), releaseRead = deferred();
  let nextTx = 0;
  let collision: Prisma.PrismaClientKnownRequestError | undefined;
  function admit<T>(tx: number, method: string, args: unknown, validate: () => T): T {
    attempts[method] = (attempts[method] ?? 0) + 1;
    const event: Event = { tx, method }; events.push(event);
    try { event.args = clone(args); return validate(); }
    catch (error) { faults.push(method); throw error; }
  }
  function forbidden(method: string) {
    return new Proxy({}, { get() {
      attempts[method] = (attempts[method] ?? 0) + 1; faults.push(method);
      throw new Error('Fixture forbids root, retry, storage or unadmitted delegate');
    } });
  }
  const prisma = {
    storyUploadSubmission: forbidden('root'), storyUploadGenerationProfile: forbidden('root'), auditEvent: forbidden('root'),
    async $transaction<T>(callback: (tx: Client) => Promise<T>, ...extra: unknown[]): Promise<T> {
      const tx = ++nextTx;
      admit(tx, 'transaction', undefined, () => { assert.equal(typeof callback, 'function'); assert.equal(extra.length, 0); });
      if (Object.prototype.hasOwnProperty.call(options, 'transactionError')) throw options.transactionError;
      const stagedRows: Profile[] = [], stagedAudits: Fields[] = [];
      let snapshot: Profile | undefined;
      const client: Client = {
        storyUploadSubmission: {
          async findFirst(args) {
            admit(tx, 'read', args, () => {
              keys(args, ['where', 'include']); keys(args.where, ['id', 'userId']);
              assert.equal(args.where.id, SUBMISSION); assert.equal(typeof args.where.userId, 'string');
              assert.deepEqual(args.include, { generationProfiles: { orderBy: { profileVersion: 'desc' }, take: 1 } });
            });
            if (Object.prototype.hasOwnProperty.call(options, 'readError')) throw options.readError;
            if (args.where.userId !== OWNER || options.missingSubmission) return null;
            const latest = [...rows].sort((left, right) => right.profileVersion - left.profileVersion)[0];
            snapshot = latest ? clone(latest) : undefined;
            const result = { id: SUBMISSION, userId: OWNER, requestFingerprint: SOURCE,
              generationProfiles: snapshot ? [clone(snapshot)] : [] };
            if (options.pauseFirstRead && tx === 1) { firstRead.resolve(); await releaseRead.promise; }
            return result;
          },
        },
        storyUploadGenerationProfile: {
          async create(args) {
            admit(tx, 'create', args, () => {
              keys(args, ['data']);
              keys(args.data, ['submissionId', 'profileVersion', 'ownerUserId', 'sourceFingerprint', 'status',
                'draftSettings', 'draftFingerprint', 'approvedSettings', 'approvedFingerprint', 'approvedByUserId',
                'approvedAt', 'analysisErrorCode', 'updatedAt']);
              assert.ok(!snapshot || snapshot.status === 'approved');
              assert.equal(args.data.submissionId, SUBMISSION); assert.equal(args.data.profileVersion, (snapshot?.profileVersion ?? 0) + 1);
              assert.equal(args.data.ownerUserId, OWNER); assert.equal(args.data.sourceFingerprint, snapshot?.sourceFingerprint ?? SOURCE);
              assert.equal(args.data.status, 'needs_review'); assert.equal(args.data.approvedSettings, Prisma.DbNull);
              assert.equal(args.data.approvedFingerprint, null); assert.equal(args.data.approvedByUserId, null);
              assert.equal(args.data.approvedAt, null); assert.equal(args.data.analysisErrorCode, null);
              assert.ok(args.data.updatedAt instanceof Date && Number.isFinite(args.data.updatedAt.getTime()));
              const normalized = normalizeCreatorGenerationProfile('story', args.data.draftSettings);
              assert.deepEqual(args.data.draftSettings, normalized);
              assert.equal(args.data.draftFingerprint, creatorGenerationProfileFingerprint(args.data.sourceFingerprint as string, normalized));
            });
            if (Object.prototype.hasOwnProperty.call(options, 'createError')) throw options.createError;
            // A generic unique-tuple fake emits a real SDK error; this is not a PostgreSQL simulator.
            if ([...rows, ...stagedRows].some(row => row.submissionId === args.data.submissionId && row.profileVersion === args.data.profileVersion)) {
              collision = known('P2002', { modelName: 'StoryUploadGenerationProfile', target: [...TARGET] });
              throw collision;
            }
            const created = profile({ id: '00000000-0000-4000-8000-' + String(5110 + tx).padStart(12, '0'),
              profileVersion: args.data.profileVersion as number, reviewRevision: 0, status: 'needs_review',
              draftSettings: clone(args.data.draftSettings), draftFingerprint: args.data.draftFingerprint as string,
              sourceFingerprint: args.data.sourceFingerprint as string, approvedSettings: null,
              approvedFingerprint: null, approvedByUserId: null, approvedAt: null,
              updatedAt: clone(args.data.updatedAt as Date) });
            stagedRows.push(created); return clone(created);
          },
        },
        auditEvent: {
          async create(args) {
            admit(tx, 'audit', args, () => {
              keys(args, ['data']);
              keys(args.data, ['actorUserId', 'actorType', 'action', 'targetType', 'targetId', 'beforeData', 'afterData', 'metadata']);
              assert.equal(args.data.actorUserId, OWNER); assert.equal(args.data.actorType, 'user');
              assert.equal(args.data.action, 'story_generation_profile.draft_saved');
              assert.equal(args.data.targetType, 'story_upload_generation_profile');
              assert.equal(stagedRows.length, 1); assert.equal(args.data.targetId, stagedRows[0].id);
              if (snapshot) assert.deepEqual(args.data.beforeData, {
                status: snapshot.status, profileVersion: snapshot.profileVersion, draftFingerprint: snapshot.draftFingerprint,
              });
              else assert.equal(args.data.beforeData, Prisma.JsonNull);
              assert.deepEqual(args.data.afterData, { status: stagedRows[0].status,
                profileVersion: stagedRows[0].profileVersion, draftFingerprint: stagedRows[0].draftFingerprint });
              assert.deepEqual(args.data.metadata, { submissionId: SUBMISSION, sourceFingerprint: snapshot?.sourceFingerprint ?? SOURCE });
            });
            if (Object.prototype.hasOwnProperty.call(options, 'auditError')) throw options.auditError;
            stagedAudits.push(clone(args.data)); return { id: `synthetic-audit-${tx}` };
          },
        },
      };
      try {
        const result = await callback(client);
        rows.push(...clone(stagedRows)); audits.push(...clone(stagedAudits)); events.push({ tx, method: 'callbackReturned' });
        return result;
      } catch (error) {
        // The memory fixture discards its own staging; no physical DB rollback is established.
        events.push({ tx, method: 'callbackRejected' }); throw error;
      }
    },
  };
  const storage = forbidden('storage');
  const makeService = () => new StoryUploadService(prisma as unknown as PrismaService, storage as unknown as StoryUploadStorageService);
  return { service: makeService(), secondService: makeService(), rows, audits, events,
    firstRead: firstRead.promise, releaseRead: releaseRead.resolve,
    snapshot: () => clone({ rows, audits }), collision: () => collision,
    count: (method: string) => attempts[method] ?? 0,
    check() { assert.deepEqual(faults, [], 'FIXTURE_ADMISSION_FAULT'); assert.equal(attempts.root ?? 0, 0); assert.equal(attempts.storage ?? 0, 0); },
  };
}

async function outcome<T>(operation: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try { return { value: await operation }; } catch (error) { return { error }; }
}

function assertConflict(error: unknown) {
  assert.ok(error instanceof ConflictException); assert.equal(error.getStatus(), 409);
  assert.deepEqual(error.getResponse(), { code: 'GENERATION_PROFILE_DRAFT_CHANGED',
    message: 'Review the latest generation profile before saving' });
}

const SUITE = 'StoryUploadService profile version create conflict';
describe(SUITE, () => {
  it('01 concurrent next version creates reject the loser without replacing its winner', async () => {
    for (const originals of [[], [profile()]] as Profile[][]) {
      const f = fixture({ profiles: originals, pauseFirstRead: true });
      const pending = outcome(f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings('loser') }));
      try {
        await f.firstRead;
        const winner = await f.secondService.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings('winner') });
        assert.equal(winner.profile.status, 'needs_review');
        assert.equal(winner.profile.profileVersion, (originals[0]?.profileVersion ?? 0) + 1);
        assert.equal(f.audits.length, 1); assert.equal(f.count('audit'), 1);
        const committed = f.snapshot(); f.releaseRead();
        const loser = await pending;
        assert.equal(loser.error instanceof ConflictException, true, 'STORY_UPLOAD_PROFILE_CREATE_CONFLICT_NOT_CLASSIFIED');
        assertConflict(loser.error); assert.equal(loser.value, undefined);
        assert.ok(f.collision() instanceof Prisma.PrismaClientKnownRequestError);
        assert.deepEqual(f.collision()?.meta?.target, TARGET);
        assert.deepEqual(f.snapshot(), committed, 'The committed winner and approved history are not replaced or returned');
        assert.deepEqual(f.rows.slice(0, originals.length), originals);
        assert.equal(f.count('transaction'), 2); assert.equal(f.count('read'), 2); assert.equal(f.count('create'), 2);
        assert.equal(f.count('audit'), 1);
        assert.deepEqual(f.events.filter(event => event.method === 'callbackReturned').map(event => event.tx), [2]);
        assert.deepEqual(f.events.filter(event => event.method === 'callbackRejected').map(event => event.tx), [1]);
      } finally { f.releaseRead(); await pending; f.check(); }
    }
  });

  it('02 classifies only the actual known create error with the exact ordered version target', async () => {
    const targets: unknown[] = [undefined, null, 'uq_story_upload_generation_profiles_version', [], ['submission_id'],
      ['profile_version', 'submission_id'], ['submissionId', 'profileVersion'], ['id'], ['id', 'owner_user_id'],
      ['submission_id', 'profile_version', 'id']];
    const errors: unknown[] = targets.map(target => known('P2002', { target }));
    errors.push(known(), known('P2003', { target: [...TARGET] }), new Error('Synthetic unrelated create failure'),
      { code: 'P2002', meta: { target: [...TARGET] } },
      Object.assign(new Error('Synthetic error-shaped object'), { code: 'P2002', meta: { target: [...TARGET] } }));
    for (const error of errors) {
      const f = fixture({ createError: error });
      try {
        const before = f.snapshot();
        const result = await outcome(f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings() }));
        assert.equal(result.error, error); assert.equal(result.value, undefined); assert.deepEqual(f.snapshot(), before);
        assert.equal(f.count('transaction'), 1); assert.equal(f.count('read'), 1); assert.equal(f.count('create'), 1);
        assert.equal(f.count('audit'), 0);
      } finally { f.check(); }
    }
    const exact = known('P2002', { modelName: 'StoryUploadGenerationProfile', target: [...TARGET] });
    const f = fixture({ createError: exact });
    try {
      const before = f.snapshot();
      const result = await outcome(f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings() }));
      assertConflict(result.error); assert.equal(result.value, undefined); assert.deepEqual(f.snapshot(), before);
      assert.equal(f.count('create'), 1); assert.equal(f.count('read'), 1); assert.equal(f.count('audit'), 0);
    } finally { f.check(); }
  });

  it('03 preserves normal next draft data and does not map or retry audit errors', async () => {
    for (const originals of [[], [profile()]] as Profile[][]) {
      const f = fixture({ profiles: originals });
      try {
        const input = settings('normal'), normalized = normalizeCreatorGenerationProfile('story', input);
        const result = await f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: input });
        const created = f.rows[f.rows.length - 1];
        assert.equal(f.rows.length, originals.length + 1); assert.deepEqual(f.rows.slice(0, originals.length), originals);
        assert.equal(created.profileVersion, (originals[0]?.profileVersion ?? 0) + 1); assert.equal(created.reviewRevision, 0);
        assert.equal(created.status, 'needs_review'); assert.equal(created.ownerUserId, OWNER);
        assert.deepEqual(created.draftSettings, normalized);
        assert.equal(created.draftFingerprint, creatorGenerationProfileFingerprint(SOURCE, normalized));
        assert.equal(created.approvedSettings, null); assert.equal(created.approvedFingerprint, null);
        assert.equal(created.approvedByUserId, null); assert.equal(created.approvedAt, null);
        assert.deepEqual(result, { submissionId: SUBMISSION, profile: creatorGenerationProfileProjection(created) });
        assert.equal(result.profile.reviewRequired, true); assert.equal(f.audits.length, 1);
        assert.deepEqual(f.events.map(event => event.method), ['transaction', 'read', 'create', 'audit', 'callbackReturned']);
        assert.ok(f.events.every(event => event.tx === 1));
      } finally { f.check(); }
    }
    for (const error of [new Error('Synthetic audit failure'), known('P2002', { target: [...TARGET] })]) {
      const f = fixture({ auditError: error });
      try {
        const before = f.snapshot();
        const result = await outcome(f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings('audit-error') }));
        assert.equal(result.error, error); assert.equal(result.value, undefined);
        assert.equal(f.count('transaction'), 1); assert.equal(f.count('create'), 1); assert.equal(f.count('audit'), 1);
        assert.deepEqual(f.snapshot(), before, 'Only synthetic staging discard, not SQL rollback proof');
        assert.equal(f.events[f.events.length - 1].method, 'callbackRejected');
      } finally { f.check(); }
    }
  });

  it('04 preserves input owner missing and upstream errors before any profile create', async () => {
    for (const variant of ['invalid-id', 'invalid-settings', 'nonowner', 'missing'] as const) {
      const f = fixture({ missingSubmission: variant === 'missing' });
      try {
        const before = f.snapshot();
        const result = await outcome(f.service.updateGenerationProfile(variant === 'nonowner' ? OTHER : OWNER,
          variant === 'invalid-id' ? 'not-a-uuid' : SUBMISSION,
          { settings: variant === 'invalid-settings' ? { ...settings(), sections: [] } : settings() }));
        if (variant === 'nonowner' || variant === 'missing') {
          assert.ok(result.error instanceof NotFoundException); assert.equal(f.count('transaction'), 1); assert.equal(f.count('read'), 1);
        } else {
          assert.ok(result.error instanceof BadRequestException); assert.equal(f.count('transaction'), 0); assert.equal(f.count('read'), 0);
          if (variant === 'invalid-id') assert.equal(object(result.error.getResponse()).code, 'STORY_UPLOAD_ID_INVALID');
        }
        assert.deepEqual(f.snapshot(), before); assert.equal(f.count('create'), 0); assert.equal(f.count('audit'), 0);
      } finally { f.check(); }
    }
    for (const stage of ['readError', 'transactionError'] as const) {
      const error = known('P2002', { target: [...TARGET] }), f = fixture({ [stage]: error });
      try {
        const before = f.snapshot();
        const result = await outcome(f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings() }));
        assert.equal(result.error, error); assert.equal(result.value, undefined); assert.deepEqual(f.snapshot(), before);
        assert.equal(f.count('transaction'), 1); assert.equal(f.count('read'), stage === 'readError' ? 1 : 0);
        assert.equal(f.count('create'), 0); assert.equal(f.count('audit'), 0);
      } finally { f.check(); }
    }
  });
});
