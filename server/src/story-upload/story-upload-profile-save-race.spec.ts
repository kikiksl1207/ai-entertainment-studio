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

// Actual whole service and policy; ORM scheduling is synthetic, not a SQL/rollback proof.
const OWNER = '00000000-0000-4000-8000-000000000481';
const OTHER = '00000000-0000-4000-8000-000000000482';
const SUBMISSION = '00000000-0000-4000-8000-000000000483';
const PROFILE = '00000000-0000-4000-8000-000000000484';
const NEW_PROFILE = '00000000-0000-4000-8000-000000000485';
const SOURCE = 'a'.repeat(64);
const CREATED = new Date('2026-10-16T00:00:00.000Z');
type Fields = Record<string, unknown>;
type Profile = {
  id: string; submissionId: string; ownerUserId: string; sourceFingerprint: string;
  profileVersion: number; reviewRevision: number; status: string;
  draftSettings: unknown; draftFingerprint: string | null; approvedSettings: unknown;
  approvedFingerprint: string | null; approvedByUserId: string | null;
  approvedAt: Date | null; analysisErrorCode: string | null; createdAt: Date; updatedAt: Date;
};
type Submission = {
  id: string; userId: string; requestFingerprint: string; generationProfiles: Profile[];
};
type WriteArgs = { where: Fields; data: Fields };
type Event = { tx: number; method: string; args?: unknown };
type Client = {
  storyUploadSubmission: { findFirst(args: { where: Fields; include: Fields }): Promise<Submission | null> };
  storyUploadGenerationProfile: {
    update(args: WriteArgs): Promise<Profile>;
    updateMany(args: WriteArgs): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: { id: string } }): Promise<Profile>;
    create(args: { data: Fields }): Promise<Profile>;
  };
  auditEvent: { create(args: { data: Fields }): Promise<{ id: string }> };
};
type FixtureOptions = {
  profiles?: Profile[];
  pauseFirstRead?: boolean;
  beforeSaveWrite?: (rows: Profile[]) => void;
  forcedCount?: number;
  errors?: Partial<Record<'read' | 'write' | 'readback' | 'audit' | 'create', Error>>;
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

function settings(label = 'original', decision = 'accepted'): CreatorGenerationProfileSettingsDto {
  return {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'story',
    sections: [...STORY_PROFILE_SECTION_KEYS].reverse().map(key => ({
      key, decision,
      value: { summary: `${label}:${key}`, enabled: true, ordinal: 0, nested: { values: [0, false, null] } },
      evidence: [{ sourceType: 'profile', sourceRef: 'synthetic-fixture', summary: label }],
    })),
  };
}

function row(overrides: Partial<Profile> = {}): Profile {
  const draft = normalizeCreatorGenerationProfile('story', settings());
  return {
    id: PROFILE, submissionId: SUBMISSION, ownerUserId: OWNER, sourceFingerprint: SOURCE,
    profileVersion: 3, reviewRevision: 7, status: 'needs_review',
    draftSettings: draft, draftFingerprint: creatorGenerationProfileFingerprint(SOURCE, draft),
    approvedSettings: null, approvedFingerprint: null, approvedByUserId: null, approvedAt: null,
    analysisErrorCode: null, createdAt: clone(CREATED), updatedAt: clone(CREATED), ...overrides,
  };
}

function deferred() {
  let resolve: () => void = () => { throw new Error('Uninitialized fixture gate'); };
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function keys(value: object, expected: string[]) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function fields(value: unknown): Fields {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Fields;
}

function saveWhere(snapshot: Profile): Fields {
  return {
    id: snapshot.id, submissionId: SUBMISSION, ownerUserId: snapshot.ownerUserId,
    sourceFingerprint: snapshot.sourceFingerprint, status: snapshot.status,
    draftFingerprint: snapshot.draftFingerprint, reviewRevision: snapshot.reviewRevision,
  };
}

function fixture(options: FixtureOptions = {}) {
  const rows = clone(options.profiles ?? [row()]);
  const audits: Fields[] = [];
  const events: Event[] = [];
  const faults: string[] = [];
  const attempts: Record<string, number> = {};
  const firstRead = deferred();
  const resumeRead = deferred();
  let nextTx = 0;
  let intervened = false;
  let forbiddenRoot = 0;
  let forbiddenStorage = 0;

  function admit<T>(tx: number, method: string, args: unknown, validate: () => T): T {
    attempts[method] = (attempts[method] ?? 0) + 1;
    const event: Event = { tx, method };
    events.push(event);
    try {
      event.args = clone(args);
      return validate();
    } catch (error) { faults.push(method); throw error; }
  }

  // Only generic field matching/data assignment is modeled; service decides all predicates and policy.
  function matches(profile: Profile, where: Fields) {
    const record = profile as unknown as Fields;
    return Object.entries(where).every(([key, value]) => record[key] === value);
  }

  function apply(profile: Profile, data: Fields) {
    const target = profile as unknown as Fields;
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in value) {
        const increment = fields(value).increment;
        assert.equal(typeof target[key], 'number');
        assert.equal(typeof increment, 'number');
        target[key] = (target[key] as number) + (increment as number);
      } else target[key] = value === Prisma.DbNull ? null : clone(value);
    }
  }

  function client(tx: number): Client {
    let snapshot: Profile | undefined;
    function validateWrite(args: WriteArgs, legacy: boolean) {
      keys(args, ['where', 'data']);
      assert.ok(snapshot);
      const approval = args.data.status === 'approved';
      if (approval) {
        assert.equal(legacy, false);
        assert.deepEqual(args.where, {
          id: snapshot.id, status: 'needs_review', draftFingerprint: snapshot.draftFingerprint,
          sourceFingerprint: SOURCE,
        });
      } else {
        assert.equal(args.data.status, 'needs_review');
        if (legacy) assert.deepEqual(args.where, { id: snapshot.id });
        else assert.deepEqual(args.where, saveWhere(snapshot));
      }
      assert.ok(args.data.updatedAt instanceof Date && Number.isFinite(args.data.updatedAt.getTime()));
      return approval;
    }

    function intervene(approval: boolean) {
      if (!approval && !intervened && options.beforeSaveWrite) {
        intervened = true;
        options.beforeSaveWrite(rows);
      }
    }

    return {
      storyUploadSubmission: {
        async findFirst(args) {
          admit(tx, 'read', args, () => {
            keys(args, ['where', 'include']);
            keys(args.where, ['id', 'userId']);
            assert.equal(args.where.id, SUBMISSION);
            assert.equal(typeof args.where.userId, 'string');
            assert.deepEqual(args.include, {
              generationProfiles: { orderBy: { profileVersion: 'desc' }, take: 1 },
            });
          });
          if (options.errors?.read) throw options.errors.read;
          if (args.where.userId !== OWNER) return null;
          const latest = [...rows].sort((left, right) => right.profileVersion - left.profileVersion)[0];
          snapshot = latest ? clone(latest) : undefined;
          const result: Submission = {
            id: SUBMISSION, userId: OWNER, requestFingerprint: SOURCE,
            generationProfiles: snapshot ? [clone(snapshot)] : [],
          };
          if (options.pauseFirstRead && tx === 1) {
            firstRead.resolve();
            await resumeRead.promise;
          }
          return result;
        },
      },
      storyUploadGenerationProfile: {
        async update(args) {
          const approval = admit(tx, 'legacyUpdate', args, () => validateWrite(args, true));
          intervene(approval);
          if (options.errors?.write) throw options.errors.write;
          const target = rows.find(profile => matches(profile, args.where));
          assert.ok(target);
          apply(target, args.data);
          return clone(target);
        },
        async updateMany(args) {
          const approval = admit(tx, 'updateMany', args, () => validateWrite(args, false));
          const method = approval ? 'approveCas' : 'saveCas';
          attempts[method] = (attempts[method] ?? 0) + 1;
          events[events.length - 1].method = method;
          intervene(approval);
          if (options.errors?.write) throw options.errors.write;
          if (!approval && options.forcedCount !== undefined) return { count: options.forcedCount };
          const selected = rows.filter(profile => matches(profile, args.where));
          for (const profile of selected) apply(profile, args.data);
          return { count: selected.length };
        },
        async findUniqueOrThrow(args) {
          admit(tx, 'readback', args, () => {
            keys(args, ['where']);
            assert.deepEqual(args.where, { id: snapshot?.id });
          });
          if (options.errors?.readback) throw options.errors.readback;
          const result = rows.find(profile => profile.id === args.where.id);
          assert.ok(result);
          return clone(result);
        },
        async create(args) {
          admit(tx, 'create', args, () => {
            keys(args, ['data']);
            assert.equal(args.data.submissionId, SUBMISSION);
            assert.equal(args.data.profileVersion, (snapshot?.profileVersion ?? 0) + 1);
            assert.equal(args.data.status, 'needs_review');
            assert.equal(args.data.ownerUserId, OWNER);
          });
          if (options.errors?.create) throw options.errors.create;
          const created = row({ id: NEW_PROFILE, profileVersion: args.data.profileVersion as number, reviewRevision: 0 });
          apply(created, args.data);
          rows.push(created);
          return clone(created);
        },
      },
      auditEvent: {
        async create(args) {
          admit(tx, 'audit', args, () => {
            keys(args, ['data']);
            assert.equal(args.data.actorUserId, OWNER);
            assert.equal(args.data.actorType, 'user');
            assert.equal(args.data.targetType, 'story_upload_generation_profile');
            assert.ok(['story_generation_profile.draft_saved', 'story_generation_profile.approved']
              .includes(args.data.action as string));
            assert.ok(rows.some(profile => profile.id === args.data.targetId));
          });
          if (options.errors?.audit) throw options.errors.audit;
          audits.push(clone(args.data));
          return { id: `synthetic-audit-${audits.length}` };
        },
      },
    };
  }

  const forbiddenDelegate = new Proxy({}, {
    get() {
      forbiddenRoot += 1;
      faults.push('rootDelegate');
      throw new Error('Fixture denies root/pool ORM delegates');
    },
  });
  const prisma = {
    storyUploadSubmission: forbiddenDelegate,
    storyUploadGenerationProfile: forbiddenDelegate,
    auditEvent: forbiddenDelegate,
    async $transaction<T>(callback: (tx: Client) => Promise<T>, ...extra: unknown[]): Promise<T> {
      const tx = ++nextTx;
      admit(tx, 'transaction', undefined, () => {
        assert.equal(typeof callback, 'function');
        assert.equal(extra.length, 0);
      });
      try {
        const result = await callback(client(tx));
        events.push({ tx, method: 'callbackReturned' });
        return result;
      } catch (error) {
        // No restoration: this fixture cannot establish database transaction rollback.
        events.push({ tx, method: 'callbackRejected' });
        throw error;
      }
    },
  };
  const storage = new Proxy({}, {
    get() {
      forbiddenStorage += 1;
      faults.push('storage');
      throw new Error('Fixture denies storage/provider operations');
    },
  });
  const makeService = () => new StoryUploadService(
    prisma as unknown as PrismaService, storage as StoryUploadStorageService,
  );
  return {
    service: makeService(), secondService: makeService(), rows, audits, events, attempts,
    firstRead: firstRead.promise, releaseRead: resumeRead.resolve,
    snapshot: () => clone({ rows, audits }),
    count: (method: string) => attempts[method] ?? 0,
    check() {
      assert.deepEqual(faults, [], 'FIXTURE_ADMISSION_FAULT');
      assert.equal(forbiddenRoot, 0);
      assert.equal(forbiddenStorage, 0);
    },
  };
}

function assertConflict(error: unknown) {
  assert.ok(error instanceof ConflictException);
  assert.equal(error.getStatus(), 409);
  assert.equal(fields(error.getResponse()).code, 'GENERATION_PROFILE_DRAFT_CHANGED');
}

async function outcome<T>(operation: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try { return { value: await operation }; } catch (error) { return { error }; }
}

const SUITE = 'StoryUploadService profile draft save snapshot';
describe(SUITE, () => {
  it('01 stale draft save cannot overwrite a committed approval', async () => {
    const f = fixture({ pauseFirstRead: true });
    const pending = outcome(f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings('late-save') }));
    try {
      await f.firstRead;
      const approval = await f.secondService.approveGenerationProfile(OWNER, SUBMISSION, {
        expectedDraftFingerprint: row().draftFingerprint as string,
      });
      assert.equal(approval.profile.status, 'approved');
      assert.equal(f.count('approveCas'), 1);
      assert.equal(f.audits.length, 1);
      assert.equal(f.audits[0].action, 'story_generation_profile.approved');
      const winner = f.snapshot();
      assert.equal(f.events.filter(event => event.method === 'callbackReturned').length, 1);
      f.releaseRead();
      const stale = await pending;
      assert.equal(stale.error instanceof ConflictException, true,
        'STORY_UPLOAD_DRAFT_SAVE_OVERWROTE_APPROVAL');
      assertConflict(stale.error);
      assert.equal(stale.value, undefined);
      assert.deepEqual(f.snapshot(), winner, 'Approved row and approval audit must remain the winner');
      assert.equal(f.count('transaction'), 2);
      assert.equal(f.count('read'), 2);
      assert.equal(f.count('saveCas'), 1);
      assert.equal(f.count('legacyUpdate'), 0);
      assert.equal(f.count('create'), 0);
      assert.equal(f.count('audit'), 1);
      assert.equal(f.count('readback'), 1);
      assert.deepEqual(f.events.filter(event => event.method === 'callbackReturned').map(event => event.tx), [2]);
    } finally {
      f.releaseRead();
      await pending;
      f.check();
    }
  });

  it('02 rejects changed draft revision status source or snapshot owner without a stale audit', async () => {
    const variants: Array<[string, (profile: Profile) => void]> = [
      ['draft', profile => { profile.draftFingerprint = 'c'.repeat(64); }],
      ['revision', profile => { profile.reviewRevision += 1; }],
      ['status', profile => { profile.status = 'analysis_failed'; }],
      ['source', profile => { profile.sourceFingerprint = 'd'.repeat(64); }],
      ['owner', profile => { profile.ownerUserId = OTHER; }],
    ];
    for (const [label, change] of variants) {
      let winner: Profile[] = [];
      const f = fixture({ beforeSaveWrite: profiles => { change(profiles[0]); winner = clone(profiles); } });
      try {
        const result = await outcome(f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings(label) }));
        assertConflict(result.error);
        assert.deepEqual(f.rows, winner, label);
        assert.equal(f.rows[0].updatedAt.getTime(), CREATED.getTime(), 'No timestamp-CAS assumption');
        assert.equal(f.count('transaction'), 1);
        assert.equal(f.count('saveCas'), 1);
        assert.equal(f.count('readback'), 0);
        assert.equal(f.count('audit'), 0);
        assert.equal(f.count('create'), 0);
        assert.deepEqual(f.audits, []);
      } finally { f.check(); }
    }
  });

  it('03 saves full nonapproved settings with exact snapshot CAS readback and no auto approval', async () => {
    for (const variant of [
      { status: 'needs_review', draftFingerprint: row().draftFingerprint, ownerUserId: OWNER, sourceFingerprint: SOURCE },
      { status: 'pending_analysis', draftFingerprint: null, ownerUserId: OTHER, sourceFingerprint: 'e'.repeat(64) },
    ]) {
      const original = row({
        ...variant, approvedSettings: { historical: true }, approvedFingerprint: 'f'.repeat(64),
        approvedByUserId: OTHER, approvedAt: clone(CREATED), analysisErrorCode: 'SYNTHETIC_OLD_ERROR',
      });
      const f = fixture({ profiles: [original] });
      try {
        const input = settings('replacement', 'edited');
        const normalized = normalizeCreatorGenerationProfile('story', input);
        const result = await f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: input });
        const profile = f.rows[0];
        assert.deepEqual(profile.draftSettings, normalized);
        assert.equal(profile.draftFingerprint, creatorGenerationProfileFingerprint(original.sourceFingerprint, normalized));
        assert.equal(profile.sourceFingerprint, original.sourceFingerprint);
        assert.equal(profile.ownerUserId, OWNER);
        assert.equal(profile.reviewRevision, original.reviewRevision);
        assert.equal(profile.profileVersion, original.profileVersion);
        assert.equal(profile.status, 'needs_review');
        assert.equal(profile.approvedSettings, null);
        assert.equal(profile.approvedFingerprint, null);
        assert.equal(profile.approvedByUserId, null);
        assert.equal(profile.approvedAt, null);
        assert.equal(profile.analysisErrorCode, null);
        assert.deepEqual(profile.createdAt, original.createdAt);
        assert.ok(profile.updatedAt instanceof Date && Number.isFinite(profile.updatedAt.getTime()));
        assert.deepEqual(result, { submissionId: SUBMISSION, profile: creatorGenerationProfileProjection(profile) });
        assert.equal(result.profile.reviewRequired, true);
        const write = f.events.find(event => event.method === 'saveCas');
        assert.ok(write);
        const args = fields(write.args);
        assert.deepEqual(args.where, saveWhere(original));
        keys(fields(args.data), [
          'ownerUserId', 'sourceFingerprint', 'status', 'draftSettings', 'draftFingerprint',
          'approvedSettings', 'approvedFingerprint', 'approvedByUserId', 'approvedAt', 'analysisErrorCode', 'updatedAt',
        ]);
        assert.equal(fields(args.data).approvedSettings, Prisma.DbNull);
        assert.deepEqual(f.audits, [{
          actorUserId: OWNER, actorType: 'user', action: 'story_generation_profile.draft_saved',
          targetType: 'story_upload_generation_profile', targetId: PROFILE,
          beforeData: { status: original.status, profileVersion: original.profileVersion, draftFingerprint: original.draftFingerprint },
          afterData: { status: profile.status, profileVersion: profile.profileVersion, draftFingerprint: profile.draftFingerprint },
          metadata: { submissionId: SUBMISSION, sourceFingerprint: original.sourceFingerprint },
        }]);
        assert.deepEqual(f.events.map(event => event.method),
          ['transaction', 'read', 'saveCas', 'readback', 'audit', 'callbackReturned']);
        assert.ok(f.events.every(event => event.tx === 1));
        assert.equal(f.count('legacyUpdate'), 0);
        assert.equal(f.count('create'), 0);
        assert.equal(f.count('approveCas'), 0);
      } finally { f.check(); }
    }
  });

  it('04 keeps the approved version immutable and creates only an explicit next draft or first draft', async () => {
    const approved = row({ status: 'approved', approvedSettings: row().draftSettings,
      approvedFingerprint: row().draftFingerprint, approvedByUserId: OWNER, approvedAt: clone(CREATED) });
    for (const originals of [[approved], []] as Profile[][]) {
      const f = fixture({ profiles: originals });
      try {
        const before = clone(f.rows);
        const result = await f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings('new-version') });
        assert.deepEqual(f.rows.slice(0, before.length), before);
        assert.equal(f.rows.length, before.length + 1);
        const created = f.rows[f.rows.length - 1];
        assert.equal(created.id, NEW_PROFILE);
        assert.equal(created.profileVersion, (before[0]?.profileVersion ?? 0) + 1);
        assert.equal(created.reviewRevision, 0);
        assert.equal(created.status, 'needs_review');
        assert.equal(created.approvedSettings, null);
        assert.equal(created.approvedFingerprint, null);
        assert.equal(created.approvedAt, null);
        assert.equal(created.sourceFingerprint, before[0]?.sourceFingerprint ?? SOURCE);
        assert.equal(result.profile.reviewRequired, true);
        assert.deepEqual(result.profile, creatorGenerationProfileProjection(created));
        assert.equal(f.count('create'), 1);
        assert.equal(f.count('saveCas'), 0);
        assert.equal(f.count('legacyUpdate'), 0);
        assert.equal(f.count('readback'), 0);
        assert.equal(f.count('audit'), 1);
        assert.equal(f.audits[0].targetId, NEW_PROFILE);
        assert.equal(f.audits[0].action, 'story_generation_profile.draft_saved');
        if (!before.length) assert.equal(f.audits[0].beforeData, Prisma.JsonNull);
        else assert.deepEqual(f.audits[0].beforeData, {
          status: 'approved', profileVersion: approved.profileVersion, draftFingerprint: approved.draftFingerprint,
        });
      } finally { f.check(); }
    }
  });

  it('05 requires exactly one CAS match and propagates write readback and audit failures without retry', async () => {
    for (const count of [0, 2]) {
      const f = fixture({ forcedCount: count });
      try {
        const before = f.snapshot();
        const result = await outcome(f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings() }));
        assertConflict(result.error);
        assert.deepEqual(f.snapshot(), before, 'Forced count fixture does not apply a write');
        assert.equal(f.count('saveCas'), 1);
        assert.equal(f.count('readback'), 0);
        assert.equal(f.count('audit'), 0);
        assert.equal(f.count('create'), 0);
      } finally { f.check(); }
    }
    const known = new Prisma.PrismaClientKnownRequestError('Synthetic update error',
      { code: 'P2025', clientVersion: 'synthetic' });
    const variants: Array<['write' | 'readback' | 'audit' | 'read', Error]> = [
      ['write', new Error('Synthetic write failure')], ['write', known],
      ['readback', new Error('Synthetic readback failure')], ['audit', new Error('Synthetic audit failure')],
      ['read', new Error('Synthetic owner lookup failure')],
    ];
    for (const [stage, error] of variants) {
      const f = fixture({ errors: { [stage]: error } });
      try {
        const result = await outcome(f.service.updateGenerationProfile(OWNER, SUBMISSION, { settings: settings('failure') }));
        assert.equal(result.error, error);
        assert.equal(result.value, undefined);
        assert.equal(f.count('transaction'), 1);
        assert.equal(f.count('read'), 1);
        assert.equal(f.count('saveCas'), stage === 'read' ? 0 : 1);
        assert.equal(f.count('readback'), stage === 'audit' || stage === 'readback' ? 1 : 0);
        assert.equal(f.count('audit'), stage === 'audit' ? 1 : 0);
        assert.equal(f.count('create'), 0);
        assert.deepEqual(f.audits, []);
        assert.equal(f.events[f.events.length - 1].method, 'callbackRejected');
        // Readback/audit failures follow fake writes; physical rollback is intentionally not asserted.
      } finally { f.check(); }
    }
  });

  it('06 rejects invalid IDs settings and a nonowner before any write or draft audit', async () => {
    for (const variant of ['invalid-id', 'nonowner', 'invalid-settings'] as const) {
      const f = fixture();
      try {
        const before = f.snapshot();
        const result = await outcome(f.service.updateGenerationProfile(
          variant === 'nonowner' ? OTHER : OWNER,
          variant === 'invalid-id' ? 'not-a-uuid' : SUBMISSION,
          { settings: variant === 'invalid-settings' ? { ...settings(), sections: [] } : settings() },
        ));
        if (variant === 'nonowner') {
          assert.ok(result.error instanceof NotFoundException);
          assert.equal(f.count('transaction'), 1);
          assert.equal(f.count('read'), 1);
          const read = f.events.find(event => event.method === 'read');
          assert.ok(read);
          assert.deepEqual(fields(read.args).where, { id: SUBMISSION, userId: OTHER });
        } else {
          assert.ok(result.error instanceof BadRequestException);
          assert.equal(f.count('transaction'), 0);
          assert.equal(f.count('read'), 0);
          if (variant === 'invalid-id') assert.equal(fields(result.error.getResponse()).code, 'STORY_UPLOAD_ID_INVALID');
        }
        for (const method of ['saveCas', 'approveCas', 'legacyUpdate', 'create', 'readback', 'audit']) {
          assert.equal(f.count(method), 0, method);
        }
        assert.deepEqual(f.snapshot(), before);
      } finally { f.check(); }
    }
  });
});
