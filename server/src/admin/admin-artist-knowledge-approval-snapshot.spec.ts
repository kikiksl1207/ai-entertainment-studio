// AUTHOR UNRUN. Portable Jest companion of the private focused CJS; three new
// registrations, actual full AdminService, synthetic staged Prisma delegates.
// No AST extraction, path/source pins, PrismaClient, ConfigService lookup or DB.
import { strict as assert } from 'node:assert';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  ARTIST_URL_KNOWLEDGE_CONTRACT,
  buildArtistKnowledgeAuditPayload,
} from '../chat/artist-url-knowledge-contract';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ADMIN = Object.freeze({ id: '33333333-3333-4333-8333-333333333333' });
const ARTIST = '44444444-4444-4444-8444-444444444444';
const SUBMITTER = '55555555-5555-4555-8555-555555555555';
type KnowledgeRow = {
  id: string; artistId: string; submittedByUserId: string; reviewedByUserId: string | null;
  status: string; sourceType: string; url: string; canonicalUrl: string;
  artistDescription: string; summary: string; allowChatReference: boolean;
  rejectionReason: string | null; metadata: Prisma.JsonValue;
  createdAt: Date; updatedAt: Date; reviewedAt: Date | null; archivedAt: Date | null;
};
type JoinedRow = KnowledgeRow & {
  artist: { id: string; slug: string; displayName: string; status: string };
  submittedBy: { id: string; email: string };
  reviewedBy: { id: string; email: string } | null;
};
type Stage = 'read' | 'readonly' | 'snapshot-version' | 'lock' | 'update' | 'commit' | 'audit';
type Options = {
  initial?: KnowledgeRow | null;
  change?: (rows: Map<string, KnowledgeRow>, versions: Map<string, string>) => void;
  noSnapshotVersion?: boolean; noLockedVersion?: boolean; failAt?: Stage; error?: unknown;
};
type Tx = {
  readOnly: boolean; marked: boolean; read: boolean; versionRead: boolean; locked: boolean; wrote: boolean;
  before: KnowledgeRow | null; rowVersion: string | null; staged: Map<string, KnowledgeRow>;
};
type Approval = Awaited<ReturnType<AdminService['approveBackstageArtistKnowledgeUrl']>>;
type Outcome = { value: Approval | null; error: unknown };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return Array.from(value, item => clone(item)) as unknown as T;
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}
function seed(id = ID): KnowledgeRow {
  return {
    id, artistId: ARTIST, submittedByUserId: SUBMITTER, reviewedByUserId: null,
    status: 'pending', sourceType: 'other', url: 'https://example.invalid/synthetic',
    canonicalUrl: 'https://example.invalid/synthetic', artistDescription: 'Synthetic submission A',
    summary: 'Synthetic  reviewed\nsummary', allowChatReference: false,
    rejectionReason: null, metadata: { synthetic: true, revisionLabel: 'A' },
    createdAt: new Date(1000), updatedAt: new Date(1000), reviewedAt: null, archivedAt: null,
  };
}
function joined(row: KnowledgeRow): JoinedRow {
  return {
    ...clone(row), artist: { id: ARTIST, slug: 'synthetic-artist', displayName: 'Synthetic artist', status: 'active' },
    submittedBy: { id: SUBMITTER, email: 'submitter@example.invalid' },
    reviewedBy: row.reviewedByUserId ? { id: row.reviewedByUserId, email: 'reviewer@example.invalid' } : null,
  };
}
function fixture(options: Options = {}) {
  const initial = options.initial === undefined ? seed() : clone(options.initial);
  const rows = new Map<string, KnowledgeRow>([[OTHER, seed(OTHER)]]);
  const versions = new Map<string, string>([[OTHER, '701']]);
  if (initial) { rows.set(ID, initial); versions.set(ID, '700'); }
  let pendingChange = options.change;
  let active: Tx | null = null;
  const faults: string[] = [], audits: Record<string, unknown>[] = [], events: string[] = [];
  const attempts = { rootRead: 0, rootUpdate: 0, transactions: 0, execute: 0, snapshotRead: 0,
    snapshotVersion: 0, lock: 0, update: 0, audit: 0, readonlyCommit: 0, writeCommit: 0, rollback: 0,
    configuration: 0 };
  let lastBefore: KnowledgeRow | null = null, lastWritten: JoinedRow | null = null;
  function inspect<T>(label: string, check: () => T): T {
    try { return check(); } catch (error: unknown) {
      faults.push(label + ': ' + (error instanceof Error ? error.message : 'unknown admission error'));
      throw error;
    }
  }
  function admit<T>(kind: keyof typeof attempts, check: () => T): T {
    attempts[kind]++;
    return inspect(kind, check);
  }
  function scripted(stage: Stage) { if (options.failAt === stage) throw options.error; }
  function change() {
    if (pendingChange) {
      const run = pendingChange; pendingChange = undefined;
      run(rows, versions); events.push('external-change');
    }
  }
  function checkFind(args: unknown) { assert.deepStrictEqual(clone(args), { where: { id: ID } }); }
  function query(parts: unknown, values: unknown[], lock: boolean) {
    const strings: unknown[] = Array.isArray(parts) ? Array.from(parts)
      : record(parts) && Array.isArray(parts.strings) ? Array.from(parts.strings) : [];
    const bound: unknown[] = Array.isArray(parts) ? values
      : record(parts) && Array.isArray(parts.values) ? Array.from(parts.values) : [];
    assert(strings.length > 0 && strings.every(value => typeof value === 'string'));
    assert.deepStrictEqual(clone(bound), [ID]);
    assert.equal(strings.join('?').replace(/\s+/g, ' ').trim(),
      'SELECT xmin::text AS "rowVersion" FROM artist_knowledge_urls WHERE id = ?::uuid' + (lock ? ' FOR UPDATE' : ''));
  }
  function update(args: unknown, tx: Tx | null): JoinedRow {
    const data = admit(tx ? 'update' : 'rootUpdate', () => {
      assert.equal(active, tx); assert(record(args)); assert(record(args.data));
      if (tx) assert(tx.before && tx.locked, 'Update only after current row lock/version observation');
      assert.deepStrictEqual(clone(args.where), tx ? { id: ID, status: tx.before?.status } : { id: ID });
      assert.deepStrictEqual(clone(args.include), { artist: true, submittedBy: true, reviewedBy: true });
      assert.deepStrictEqual(Object.keys(args.data).sort(), [
        'status', 'summary', 'allowChatReference', 'rejectionReason', 'reviewedByUserId',
        'reviewedAt', 'archivedAt', 'updatedAt', 'metadata',
      ].sort());
      assert.equal(args.data.status, 'approved'); assert.equal(args.data.reviewedByUserId, ADMIN.id);
      assert.equal(args.data.archivedAt, null); assert.equal(args.data.rejectionReason, null);
      assert(args.data.reviewedAt instanceof Date && Number.isFinite(args.data.reviewedAt.getTime()));
      assert(args.data.updatedAt instanceof Date && Number.isFinite(args.data.updatedAt.getTime()));
      return args.data;
    });
    scripted('update');
    const store = tx ? tx.staged : rows;
    const row = inspect('update-target', () => {
      const value = store.get(ID); assert(value, 'Admitted update target exists'); return value;
    });
    const after = { ...clone(row), ...clone(data) } as KnowledgeRow;
    store.set(ID, after);
    if (tx) tx.wrote = true;
    else versions.set(ID, String(Number(versions.get(ID)) + 1));
    lastWritten = joined(after); events.push(tx ? 'tx-update' : 'root-update');
    return clone(lastWritten);
  }
  const root = {
    artistKnowledgeUrl: {
      // The old direct read/update path is admitted so baseline01 can reach its
      // archive-resurrection oracle, not fail because a new helper is missing.
      findUnique: async (args: unknown) => {
        admit('rootRead', () => { assert.equal(active, null); checkFind(args); });
        scripted('read');
        const before = clone(rows.get(ID) || null); lastBefore = clone(before); change(); return before;
      },
      update: async (args: unknown) => update(args, null),
    },
    auditEvent: {
      create: async (args: unknown) => {
        const data = admit('audit', () => {
          assert.equal(active, null, 'Original audit stays outside both transactions');
          assert(record(args)); assert.deepStrictEqual(Object.keys(args), ['data']); assert(record(args.data));
          const expected = buildArtistKnowledgeAuditPayload('artist_knowledge_url.approve', lastBefore, lastWritten);
          assert.deepStrictEqual(clone(args.data), {
            actorUserId: ADMIN.id, actorType: 'admin', action: 'artist_knowledge_url.approve',
            targetType: 'artist_knowledge_url', targetId: ID, beforeData: clone(expected.beforeData),
            afterData: clone(expected.afterData), metadata: clone(expected.metadata),
          });
          return args.data;
        });
        scripted('audit'); audits.push(clone(data)); events.push('audit');
        return { id: '66666666-6666-4666-8666-666666666666', ...clone(data) };
      },
    },
    $transaction: async (callback: unknown, txOptions: unknown): Promise<unknown> => {
      const isolation = admit('transactions', () => {
        assert.equal(active, null); assert.equal(typeof callback, 'function'); assert(record(txOptions));
        assert.deepStrictEqual(Object.keys(txOptions), ['isolationLevel']);
        assert(txOptions.isolationLevel === Prisma.TransactionIsolationLevel.RepeatableRead ||
          txOptions.isolationLevel === Prisma.TransactionIsolationLevel.ReadCommitted);
        if (txOptions.isolationLevel === Prisma.TransactionIsolationLevel.ReadCommitted)
          assert.equal(attempts.readonlyCommit, attempts.writeCommit + attempts.rollback + 1);
        return txOptions.isolationLevel;
      });
      const readOnly = isolation === Prisma.TransactionIsolationLevel.RepeatableRead;
      const tx: Tx = { readOnly, marked: false, read: false, versionRead: false, locked: false, wrote: false,
        before: clone(rows.get(ID) || null), rowVersion: versions.get(ID) || null,
        staged: new Map(Array.from(rows, ([k, v]) => [k, clone(v)])) };
      const client = {
        $executeRaw: async (parts: unknown, ...values: unknown[]) => {
          admit('execute', () => {
            assert.equal(active, tx); assert(readOnly && !tx.marked && !tx.read && !tx.versionRead);
            assert.deepStrictEqual(values, []); assert(Array.isArray(parts));
            assert.equal(parts.join('').trim(), 'SET TRANSACTION READ ONLY');
          });
          scripted('readonly'); tx.marked = true; events.push('readonly'); return 0;
        },
        artistKnowledgeUrl: {
          findUnique: async (args: unknown) => {
            admit('snapshotRead', () => {
              assert.equal(active, tx); assert(readOnly && tx.marked && !tx.read); checkFind(args);
            });
            scripted('read'); tx.read = true; lastBefore = clone(tx.before); events.push('snapshot-row');
            return clone(tx.before);
          },
          update: async (args: unknown) => update(args, tx),
        },
        $queryRaw: async (parts: unknown, ...values: unknown[]) => {
          admit(readOnly ? 'snapshotVersion' : 'lock', () => {
            assert.equal(active, tx); query(parts, values, !readOnly);
            assert(readOnly ? tx.marked && tx.read && !tx.versionRead : !tx.locked && !tx.wrote);
          });
          scripted(readOnly ? 'snapshot-version' : 'lock');
          if (readOnly) {
            tx.versionRead = true; events.push('snapshot-version');
            return options.noSnapshotVersion || !tx.rowVersion ? [] : [{ rowVersion: tx.rowVersion }];
          }
          tx.locked = true; events.push('lock'); const current = versions.get(ID);
          return options.noLockedVersion || !current ? [] : [{ rowVersion: current }];
        },
      };
      active = tx;
      try {
        const invoke = inspect('transaction-callback', () => {
          assert(typeof callback === 'function'); return callback;
        });
        const result: unknown = await invoke(client);
        if (readOnly) {
          inspect('readonly-completion', () => { assert(tx.marked && tx.read && tx.versionRead && !tx.wrote); });
          attempts.readonlyCommit++; events.push('readonly-commit');
        } else {
          inspect('write-completion', () => { assert(tx.locked && tx.wrote); }); scripted('commit');
          rows.clear(); for (const [k, v] of tx.staged) rows.set(k, clone(v));
          versions.set(ID, String(Number(versions.get(ID)) + 1));
          attempts.writeCommit++; events.push('write-commit');
        }
        active = null; if (readOnly) change(); return result;
      } catch (error: unknown) {
        attempts.rollback++; events.push(readOnly ? 'readonly-rollback' : 'write-rollback'); active = null; throw error;
      }
    },
  };
  const config = { get() {
    return admit('configuration', () => { throw new Error('Configuration access not admitted'); });
  } } as unknown as ConfigService;
  const service = new AdminService(root as unknown as PrismaService, config);
  return {
    attempts, faults, audits, events,
    row: () => clone(rows.get(ID) || null), other: () => clone(rows.get(OTHER)),
    state: () => clone(Array.from(rows)),
    async invoke(input: Record<string, unknown> = {}, id = ID): Promise<Outcome> {
      try { return { value: await service.approveBackstageArtistKnowledgeUrl(ADMIN, id, input), error: null }; }
      catch (error: unknown) { return { value: null, error }; }
    },
    check() {
      assert.deepStrictEqual(faults, [], 'Fixture admission failures cannot be swallowed by product');
      assert.equal(active, null); assert.equal(attempts.configuration, 0);
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
function errorCode(result: Outcome, status: number, code: string) {
  assert(result.error instanceof HttpException, 'Expected original Nest exception');
  assert.equal(result.error.getStatus(), status);
  const response: unknown = result.error.getResponse(); assert(record(response)); assert.equal(response.code, code);
}
function assertNoApproval(f: Fixture, expected: KnowledgeRow | null) {
  f.check(); assert.deepStrictEqual(f.row(), expected);
  assert.equal(f.attempts.update, 0); assert.equal(f.attempts.rootUpdate, 0);
  assert.equal(f.attempts.audit, 0); assert.equal(f.audits.length, 0); assert.equal(f.attempts.writeCommit, 0);
}
function assertApproved(f: Fixture, result: Outcome, summary: string, allow: boolean) {
  f.check(); assert.equal(result.error, null); assert(result.value);
  const row = f.row(); assert(row); const item = result.value.item;
  assert.equal(row.status, 'approved'); assert.equal(row.summary, summary); assert.equal(row.allowChatReference, allow);
  assert.equal(row.archivedAt, null); assert.equal(row.rejectionReason, null);
  assert.equal(item.id, ID); assert.equal(item.description, row.artistDescription);
  assert.equal(item.summary, summary); assert.equal(item.allowChatRef, allow);
  assert.equal(item.submittedBy?.emailMasked, 'su***@example.invalid');
  assert.equal(item.reviewedBy?.emailMasked, 're***@example.invalid');
  assert.deepStrictEqual(item.chatReference, { eligible: allow && Boolean(summary), approvedOnly: true, rawUrlIncludedInPrompt: false });
  assert.deepStrictEqual(result.value.contract, ARTIST_URL_KNOWLEDGE_CONTRACT.apiContracts.adminApprove);
  assert(record(row.metadata));
  assert.equal(row.metadata.contractVersion, ARTIST_URL_KNOWLEDGE_CONTRACT.version);
  assert.equal(row.metadata.externalFetchPerformed, false); assert.equal(row.metadata.rawPageBodyStored, false);
  assert.equal(f.attempts.audit, 1); assert.equal(f.audits.length, 1);
  assert.equal(f.attempts.snapshotRead, 1); assert.equal(f.attempts.update, 1);
  assert.equal(f.attempts.rootRead, 0); assert.equal(f.attempts.rootUpdate, 0);
  assert.equal(f.attempts.transactions, 2); assert.equal(f.attempts.execute, 1);
  assert.equal(f.attempts.snapshotVersion, 1); assert.equal(f.attempts.lock, 1); assert.equal(f.attempts.writeCommit, 1);
  assert.deepStrictEqual(f.events.slice(0, 7), ['readonly', 'snapshot-row', 'snapshot-version', 'readonly-commit', 'lock', 'tx-update', 'write-commit']);
}

describe('AdminService artist knowledge approval snapshot portable', () => {
  it('01 stale approval cannot revive an archive written after the actual read snapshot', async () => {
    const archived = seed(); archived.status = 'archived'; archived.archivedAt = new Date(2000);
    archived.metadata = { synthetic: true, chatReferenceBlocked: true }; archived.updatedAt = new Date(2000);
    const f = fixture({ change(rows, versions) { rows.set(ID, clone(archived)); versions.set(ID, '702'); } });
    const other = f.other();
    try {
      const result = await f.invoke({ summary: 'Synthetic approved summary', allowChatRef: true }); f.check();
      assert.equal(f.row()?.status, 'archived', 'ARTIST_KNOWLEDGE_REVIEW_REVIVED_ARCHIVE');
      errorCode(result, 409, 'ARTIST_KNOWLEDGE_URL_REVIEW_STALE');
      assertNoApproval(f, archived); assert.deepStrictEqual(f.other(), other);
      assert.equal(f.attempts.transactions, 2); assert.equal(f.attempts.rollback, 1);
      assert.equal(f.attempts.lock, 1); assert.equal(f.attempts.rootRead, 0);
    } finally { f.check(); }
  });

  it('02 target version changes including equal dates and content ABA require an explicit fresh review', async () => {
    const schedules: Array<[string, (row: KnowledgeRow) => void]> = [
      ['operator-edit', row => { row.artistDescription = 'Synthetic submission B'; row.updatedAt = new Date(2000); }],
      ['same-date-edit', row => { row.artistDescription = 'Synthetic same-date edit'; }],
      ['metadata-only', row => { row.metadata = { synthetic: true, revisionLabel: 'B' }; }],
      ['rejection', row => { row.status = 'rejected'; row.rejectionReason = 'Synthetic rejection'; }],
      ['content-ABA', row => { row.artistDescription = 'Synthetic intermediate'; row.artistDescription = seed().artistDescription; }],
    ];
    for (const [label, mutate] of schedules) {
      let changed = seed(), applied = false;
      const f = fixture({ change(rows, versions) {
        const row = rows.get(ID); assert(row); const next = clone(row); mutate(next); changed = clone(next); applied = true;
        rows.set(ID, next); versions.set(ID, label === 'content-ABA' ? '703' : '702');
      } });
      try {
        const result = await f.invoke(); f.check(); errorCode(result, 409, 'ARTIST_KNOWLEDGE_URL_REVIEW_STALE');
        assert(applied); assertNoApproval(f, changed);
        assert.equal(f.attempts.snapshotRead, 1); assert.equal(f.attempts.lock, 1);
        assert.equal(f.attempts.transactions, 2, label + ' has no automatic retry');
        if (['same-date-edit', 'metadata-only', 'content-ABA'].includes(label))
          assert.equal(changed.updatedAt.getTime(), 1000, 'Date equality is not the version oracle');
        const retried = await f.invoke({ summary: 'Explicitly reviewed current synthetic content' });
        f.check(); assert.equal(retried.error, null); assert.equal(f.row()?.status, 'approved');
        assert.equal(f.row()?.artistDescription, changed.artistDescription);
        assert.equal(f.attempts.audit, 1); assert.equal(f.attempts.transactions, 4);
      } finally { f.check(); }
    }
    for (const mode of ['deleted', 'missing-snapshot-version', 'missing-locked-version']) {
      const f = fixture({
        noSnapshotVersion: mode === 'missing-snapshot-version', noLockedVersion: mode === 'missing-locked-version',
        change: mode === 'deleted' ? (rows, versions) => { rows.delete(ID); versions.delete(ID); } : undefined,
      });
      try {
        const result = await f.invoke(); f.check(); errorCode(result, 409, 'ARTIST_KNOWLEDGE_URL_REVIEW_STALE');
        assertNoApproval(f, mode === 'deleted' ? null : seed()); assert.equal(f.attempts.transactions, 2);
      } finally { f.check(); }
    }
    const f = fixture({ change(rows, versions) {
      const row = rows.get(OTHER); assert(row); const other = clone(row); other.artistDescription = 'Synthetic unrelated edit';
      rows.set(OTHER, other); versions.set(OTHER, '702');
    } });
    try {
      const result = await f.invoke(); f.check(); assert.equal(result.error, null);
      assert.equal(f.row()?.status, 'approved'); assert.equal(f.other()?.artistDescription, 'Synthetic unrelated edit');
      assert.equal(f.attempts.audit, 1); assert.equal(f.attempts.writeCommit, 1);
    } finally { f.check(); }
  });

  it('03 normal approval and existing guards preserve projection audit and original database error identities', async () => {
    for (const variant of [
      { input: {}, summary: 'Synthetic reviewed summary', allow: false, source: 'artist_description_reviewed' },
      { input: { summary: '  Explicit\n synthetic  summary ', allowChatRef: 'true' }, summary: 'Explicit synthetic summary', allow: true, source: 'admin_review_summary' },
    ]) {
      const f = fixture();
      try {
        const result = await f.invoke(variant.input); assertApproved(f, result, variant.summary, variant.allow);
        const row = f.row(); assert(row && record(row.metadata));
        assert.equal(row.metadata.summarySource, variant.source); assert.equal(row.metadata.synthetic, true);
      } finally { f.check(); }
    }
    const guards: Array<{ initial: KnowledgeRow | null; id?: string; status: number; code: string; reads: number }> = [
      { initial: null, status: 404, code: 'ARTIST_KNOWLEDGE_URL_NOT_FOUND', reads: 1 },
      { initial: { ...seed(), status: 'archived', archivedAt: new Date(2000) }, status: 409, code: 'ARTIST_KNOWLEDGE_URL_ARCHIVED', reads: 1 },
      { initial: { ...seed(), summary: '   ' }, status: 400, code: 'ARTIST_KNOWLEDGE_URL_SUMMARY_REQUIRED', reads: 1 },
      { initial: seed(), id: 'not-a-uuid', status: 400, code: 'ARTIST_KNOWLEDGE_URL_INVALID_ID', reads: 0 },
    ];
    for (const guard of guards) {
      const f = fixture({ initial: guard.initial }); const before = f.state();
      try {
        const result = await f.invoke({}, guard.id || ID); f.check(); errorCode(result, guard.status, guard.code);
        assert.deepStrictEqual(f.state(), before); assert.equal(f.attempts.audit, 0);
        assert.equal(f.attempts.rootRead + f.attempts.snapshotRead, guard.reads);
        assert.equal(f.attempts.rootUpdate + f.attempts.update, 0); assert.equal(f.attempts.lock, 0);
      } finally { f.check(); }
    }
    const known = new Prisma.PrismaClientKnownRequestError('Synthetic known DB failure', { code: 'P2025', clientVersion: 'synthetic-qa' });
    assert(known instanceof Prisma.PrismaClientKnownRequestError);
    const errors: Array<[Stage, Error]> = [
      ['read', new Error('Synthetic read failure')], ['snapshot-version', new Error('Synthetic snapshot failure')],
      ['lock', new Error('Synthetic lock failure')], ['update', known],
      ['update', new Error('Synthetic unrelated update failure')], ['commit', new Error('Synthetic commit rejection')],
    ];
    for (const [stage, error] of errors) {
      const f = fixture({ failAt: stage, error }); const before = f.state();
      try {
        const result = await f.invoke(); f.check(); assert.strictEqual(result.error, error, stage + ' identity');
        assert.deepStrictEqual(f.state(), before); assert.equal(f.attempts.audit, 0);
        assert.equal(f.attempts.rootRead, 0); assert.equal(f.attempts.rootUpdate, 0);
        assert(f.attempts.transactions <= 2, 'No implicit DB retry'); assert.equal(f.attempts.writeCommit, 0);
      } finally { f.check(); }
    }
  });
});

// The memory versions are fixture observations, not native xmin/precision/lock
// proof. Controller/auth, real FK enforcement and UI review-start revisions are
// outside this file. The original postcommit audit boundary is not made atomic.
