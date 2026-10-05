import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryGenerationProfileService } from './story-generation-profile.service';

const timestamp = '2026-10-05 00:00:00.123456+00';
const privateDiagnostic = 'Synthetic private profile diagnostic, not operating content.';
const uuid = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const approvedResult = { profile: { status: 'approved' } } as never;

function profile(index: number) {
  return { id: uuid(index), createdAt: timestamp, ownerUserId: uuid(2001), workId: uuid(3000 + index),
    manuscriptVersionId: uuid(5000 + index), analysisJobId: uuid(7000 + index) };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options: { companyDependency?: boolean } = {}) {
  const now = jest.spyOn(Date, 'now').mockReturnValue(0);
  const db = { $queryRaw: jest.fn().mockResolvedValue([]), $transaction: jest.fn() };
  const companySubmission = { autoSubmitCompletedAnalysis: jest.fn().mockResolvedValue(null) };
  const service = options.companyDependency === false
    ? new StoryGenerationProfileService(db as never)
    : new StoryGenerationProfileService(db as never, companySubmission as never);
  // These stubs verify orchestration, not SQL atomicity, native authority or provider behavior.
  const approve = jest.spyOn(service, 'autoApproveCompany').mockResolvedValue(null);
  const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { db, service, approve, submit: companySubmission.autoSubmitCompletedAnalysis, warn, now };
}

function start(f: ReturnType<typeof fixture>): Promise<void> {
  expect(f.service.onApplicationBootstrap()).toBeUndefined();
  const pending = (f.service as any).bootstrapRecovery;
  expect(pending).toBeInstanceOf(Promise);
  return pending;
}

function queryAt(f: ReturnType<typeof fixture>, index: number) {
  return f.db.$queryRaw.mock.calls[index][0] as Prisma.Sql;
}

function approvalArguments(row: ReturnType<typeof profile>) {
  return [row.ownerUserId, row.workId,
    { manuscriptVersionId: row.manuscriptVersionId, analysisJobId: row.analysisJobId }];
}

function submissionArguments(row: ReturnType<typeof profile>) {
  return [row.ownerUserId, row.workId, row.manuscriptVersionId, row.analysisJobId];
}

function expectPrivateLogsAbsent(f: ReturnType<typeof fixture>, rows: ReturnType<typeof profile>[]) {
  const logged = JSON.stringify(f.warn.mock.calls);
  expect(logged).not.toContain(privateDiagnostic);
  for (const row of rows) {
    for (const id of [row.id, ...submissionArguments(row)]) expect(logged).not.toContain(id);
  }
}

describe('Company generation profile bootstrap orchestration', () => {
  afterEach(() => jest.restoreAllMocks());

  it('selects only owned nonfixture company needs-review profiles without excluding published works', async () => {
    const f = fixture();
    await start(f);

    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    const query = queryAt(f, 0);
    const sql = query.text.replace(/\s+/g, ' ');
    expect(sql).toContain('FROM story_work_generation_profiles AS profile');
    expect(sql).toContain('JOIN story_works AS work ON work.id = profile.work_id AND work.owner_user_id = profile.owner_user_id');
    expect(sql).toContain('WHERE profile.status = $1 AND work.author_display_name = $2');
    expect(sql).toContain('work.fixture_source = false');
    expect(sql).not.toMatch(/work\.status\s*=/);
    expect(sql).toContain('profile.created_at::text AS "createdAt"');
    expect(sql).toContain('profile.manuscript_version_id AS "manuscriptVersionId"');
    expect(sql).toContain('profile.analysis_job_id AS "analysisJobId"');
    expect(sql).toContain('ORDER BY profile.created_at ASC, profile.id ASC LIMIT $3');
    expect(query.values).toEqual(['needs_review', '\uB8E8\uBBF8\uB098', 100]);
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
  });

  it('stops on an empty page without approval, submission or another page read', async () => {
    const f = fixture();
    f.db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([profile(1)]);

    await start(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('waits for approval completion before submitting the exact same owner, work and source pins', async () => {
    const f = fixture();
    const row = profile(1), begun = deferred<void>(), commit = deferred<void>();
    const order: string[] = [];
    f.db.$queryRaw.mockResolvedValueOnce([row]);
    f.approve.mockImplementationOnce(async () => {
      order.push('approval started');
      begun.resolve();
      await commit.promise;
      order.push('approval committed');
      return approvedResult;
    });
    f.submit.mockImplementationOnce(async () => {
      expect(order).toEqual(['approval started', 'approval committed']);
      order.push('submission');
      return null;
    });
    const pending = start(f);
    await begun.promise;
    expect(f.submit).not.toHaveBeenCalled();
    commit.resolve();
    await pending;

    expect(f.approve.mock.calls).toEqual([approvalArguments(row)]);
    expect(f.submit.mock.calls).toEqual([submissionArguments(row)]);
    expect(order).toEqual(['approval started', 'approval committed', 'submission']);
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
  });

  it('does not submit when approval returns null', async () => {
    const f = fixture();
    const row = profile(1);
    f.db.$queryRaw.mockResolvedValueOnce([row]);

    await start(f);
    expect(f.approve.mock.calls).toEqual([approvalArguments(row)]);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
  });

  it('retains approval-only behavior with the optional company dependency absent', async () => {
    const f = fixture({ companyDependency: false });
    const row = profile(1);
    f.db.$queryRaw.mockResolvedValueOnce([row]);
    f.approve.mockResolvedValue(approvedResult);

    await start(f);
    expect(f.approve.mock.calls).toEqual([approvalArguments(row)]);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
  });

  it.each(['synchronous', 'asynchronous'])('continues after a %s approval failure without submitting that candidate', async mode => {
    const f = fixture();
    const rows = [profile(1), profile(2)];
    const error = new ConflictException({ message: privateDiagnostic, workId: rows[0].workId });
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    f.approve.mockResolvedValue(approvedResult);
    if (mode === 'synchronous') f.approve.mockImplementationOnce(() => { throw error; });
    else f.approve.mockRejectedValueOnce(error);

    await start(f);
    expect(f.approve.mock.calls).toEqual(rows.map(approvalArguments));
    expect(f.submit.mock.calls).toEqual([submissionArguments(rows[1])]);
    expect(f.warn.mock.calls).toEqual([['Company story profile recovery skipped: ConflictException']]);
    expectPrivateLogsAbsent(f, rows);
  });

  it('retains completed approval after a receipt failure and proceeds to the next candidate without reapproval', async () => {
    const f = fixture();
    const rows = [profile(1), profile(2)];
    const states = new Map(rows.map(row => [row.workId, 'needs_review']));
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    f.approve.mockImplementation(async (_owner, workId) => {
      states.set(workId, 'approved');
      return approvedResult;
    });
    f.submit.mockRejectedValueOnce(new Error(privateDiagnostic));

    await start(f);
    expect([...states.values()]).toEqual(['approved', 'approved']);
    expect(f.approve.mock.calls).toEqual(rows.map(approvalArguments));
    expect(f.submit.mock.calls).toEqual(rows.map(submissionArguments));
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.warn.mock.calls).toEqual([['Company story profile recovery skipped: Error']]);
    expectPrivateLogsAbsent(f, rows);
  });

  it('returns immediately, blocks duplicate bootstrap and starts the next candidate only after approval and submission', async () => {
    const f = fixture();
    const rows = [profile(1), profile(2)], begun = deferred<void>(), release = deferred<void>();
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    f.approve.mockResolvedValue(approvedResult).mockImplementationOnce(async () => {
      begun.resolve();
      await release.promise;
      return approvedResult;
    });
    const pending = start(f);
    await begun.promise;

    expect(f.service.onApplicationBootstrap()).toBeUndefined();
    expect((f.service as any).bootstrapRecovery).toBe(pending);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.approve.mock.calls).toEqual([approvalArguments(rows[0])]);
    expect(f.submit).not.toHaveBeenCalled();
    release.resolve();
    await pending;
    expect(f.approve.mock.calls).toEqual(rows.map(approvalArguments));
    expect(f.submit.mock.calls).toEqual(rows.map(submissionArguments));
    expect(f.submit.mock.invocationCallOrder[0]).toBeLessThan(f.approve.mock.invocationCallOrder[1]);
    expect((f.service as any).bootstrapRecovery).toBeUndefined();
  });

  it('drains an in-flight receipt before shutdown without approving or submitting the next candidate', async () => {
    const f = fixture();
    const rows = [profile(1), profile(2)], begun = deferred<void>(), release = deferred<void>();
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    f.approve.mockResolvedValue(approvedResult);
    f.submit.mockImplementationOnce(async () => {
      begun.resolve();
      await release.promise;
      return null;
    });
    const pending = start(f);
    await begun.promise;
    let stopped = false;
    const shutdown = f.service.beforeApplicationShutdown().then(() => { stopped = true; });
    expect((f.service as any).bootstrapStopping).toBe(true);
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(f.approve.mock.calls).toEqual([approvalArguments(rows[0])]);
    expect(f.submit.mock.calls).toEqual([submissionArguments(rows[0])]);
    release.resolve();
    await shutdown;
    await pending;

    expect(stopped).toBe(true);
    expect(f.approve).toHaveBeenCalledTimes(1);
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect((f.service as any).bootstrapRecovery).toBeUndefined();
    expect(f.service.onApplicationBootstrap()).toBeUndefined();
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.warn).not.toHaveBeenCalled();
  });

  it('uses the exact microsecond timestamp and UUID cursor for profiles beyond the first hundred', async () => {
    const f = fixture();
    const first = Array.from({ length: 100 }, (_, index) => profile(index + 1));
    const next = profile(101);
    f.db.$queryRaw.mockResolvedValueOnce(first).mockResolvedValueOnce([next]);

    await start(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(2);
    const query = queryAt(f, 1);
    expect(query.text.replace(/\s+/g, ' '))
      .toContain('AND (profile.created_at, profile.id) > ($3::timestamptz, $4::uuid)');
    expect(query.values).toEqual(['needs_review', '\uB8E8\uBBF8\uB098', timestamp, first[99].id, 100]);
    expect(query.text).not.toContain('OFFSET');
    expect(f.approve.mock.calls).toEqual([...first, next].map(approvalArguments));
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
  });

  it('caps the scan at ten full pages and 1000 candidates without an eleventh query', async () => {
    const f = fixture();
    for (let page = 0; page < 10; page++) {
      f.db.$queryRaw.mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => profile(page * 100 + index + 1)));
    }
    f.db.$queryRaw.mockResolvedValue([profile(1001)]);

    await start(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(10);
    expect(f.approve).toHaveBeenCalledTimes(1000);
    expect(f.approve.mock.calls[999]).toEqual(approvalArguments(profile(1000)));
    expect(queryAt(f, 9).values).toEqual(['needs_review', '\uB8E8\uBBF8\uB098', timestamp, profile(900).id, 100]);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn.mock.calls).toEqual([['Company story profile recovery reached the 1000-profile scan limit']]);
    expectPrivateLogsAbsent(f, [profile(900), profile(1000), profile(1001)]);
  });

  it('does not report the scan cap when the tenth page is short', async () => {
    const f = fixture();
    for (let page = 0; page < 10; page++) {
      const length = page === 9 ? 99 : 100;
      f.db.$queryRaw.mockResolvedValueOnce(Array.from({ length }, (_, index) => profile(page * 100 + index + 1)));
    }

    await start(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(10);
    expect(f.approve).toHaveBeenCalledTimes(999);
    expect(f.warn).not.toHaveBeenCalled();
  });

  it.each(['first', 'later'])('stops after the %s page query fails without rejecting the recovery promise', async page => {
    const f = fixture();
    const rows = Array.from({ length: 100 }, (_, index) => profile(index + 1));
    if (page === 'later') f.db.$queryRaw.mockResolvedValueOnce(rows);
    f.db.$queryRaw.mockRejectedValueOnce(Object.assign(new Error(privateDiagnostic), { name: rows[0].workId }))
      .mockResolvedValueOnce([profile(101)]);

    await start(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(page === 'later' ? 2 : 1);
    expect(f.approve).toHaveBeenCalledTimes(page === 'later' ? 100 : 0);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn.mock.calls).toEqual([['Company story profile recovery stopped: Error']]);
    expectPrivateLogsAbsent(f, rows);
  });

  it.each([
    ['tainted Error name', Object.assign(new Error(privateDiagnostic), { name: privateDiagnostic }), 'Error'],
    ['non-Error diagnostic', { name: privateDiagnostic, message: privateDiagnostic }, 'unknown error'],
    ['Prisma error', new Prisma.PrismaClientKnownRequestError(privateDiagnostic,
      { code: 'P2034', clientVersion: 'synthetic-qa' }), 'PrismaClientKnownRequestError'],
  ])('logs only the safe classification for a %s and proceeds to the next candidate', async (_label, error, name) => {
    const f = fixture();
    const rows = [profile(1), profile(2)];
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    f.approve.mockRejectedValueOnce(error);

    await start(f);
    expect(f.approve.mock.calls).toEqual(rows.map(approvalArguments));
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn.mock.calls).toEqual([[`Company story profile recovery skipped: ${name}`]]);
    expectPrivateLogsAbsent(f, rows);
  });

  it('starts no page read when the ten-second wall budget is already exhausted', async () => {
    const f = fixture();
    f.now.mockReturnValueOnce(0).mockReturnValue(10000);

    await start(f);
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn.mock.calls).toEqual([['Company story profile recovery reached the 10-second time limit']]);
  });

  it('starts no candidate when the page read exhausts the ten-second budget', async () => {
    const f = fixture();
    const row = profile(1);
    f.db.$queryRaw.mockResolvedValueOnce([row]);
    f.now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10000);

    await start(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn.mock.calls).toEqual([['Company story profile recovery reached the 10-second time limit']]);
    expectPrivateLogsAbsent(f, [row]);
  });

  it('finishes the current approval and its receipt after budget expiry but starts no next candidate', async () => {
    const f = fixture();
    const rows = [profile(1), profile(2)];
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    f.approve.mockImplementationOnce(async () => {
      f.now.mockReturnValue(10000);
      return approvedResult;
    });

    await start(f);
    expect(f.approve.mock.calls).toEqual([approvalArguments(rows[0])]);
    expect(f.submit.mock.calls).toEqual([submissionArguments(rows[0])]);
    expect(f.warn.mock.calls).toEqual([['Company story profile recovery reached the 10-second time limit']]);
  });

  it('allows a running receipt to finish after budget expiry without approving another candidate', async () => {
    const f = fixture();
    const rows = [profile(1), profile(2)], begun = deferred<void>(), release = deferred<void>();
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    f.approve.mockResolvedValue(approvedResult);
    f.submit.mockImplementationOnce(async () => {
      begun.resolve();
      await release.promise;
      return null;
    });
    let completed = false;
    const pending = start(f).then(() => { completed = true; });
    await begun.promise;
    f.now.mockReturnValue(10000);
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(f.warn).not.toHaveBeenCalled();
    release.resolve();
    await pending;

    expect(f.approve.mock.calls).toEqual([approvalArguments(rows[0])]);
    expect(f.submit.mock.calls).toEqual([submissionArguments(rows[0])]);
    expect(f.warn.mock.calls).toEqual([['Company story profile recovery reached the 10-second time limit']]);
  });

  it('starts no next page when the last candidate of a full page exhausts the budget', async () => {
    const f = fixture();
    const rows = Array.from({ length: 100 }, (_, index) => profile(index + 1));
    f.db.$queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([profile(101)]);
    f.approve.mockImplementation(async (_owner, _work, pin) => {
      if (pin?.analysisJobId === rows[99].analysisJobId) f.now.mockReturnValue(10000);
      return null;
    });

    await start(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.approve.mock.calls).toEqual(rows.map(approvalArguments));
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn.mock.calls).toEqual([['Company story profile recovery reached the 10-second time limit']]);
  });

  it('waits for running approval at shutdown but starts no receipt or subsequent candidate', async () => {
    const f = fixture();
    const rows = [profile(1), profile(2)], begun = deferred<void>(), release = deferred<void>();
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    f.approve.mockImplementationOnce(async () => {
      begun.resolve();
      await release.promise;
      return approvedResult;
    });
    const pending = start(f);
    await begun.promise;
    let stopped = false;
    const shutdown = f.service.beforeApplicationShutdown().then(() => { stopped = true; });
    expect((f.service as any).bootstrapStopping).toBe(true);
    await Promise.resolve();
    expect(stopped).toBe(false);
    release.resolve();
    await shutdown;
    await pending;

    expect(stopped).toBe(true);
    expect(f.approve.mock.calls).toEqual([approvalArguments(rows[0])]);
    expect(f.submit).not.toHaveBeenCalled();
    expect((f.service as any).bootstrapRecovery).toBeUndefined();
    expect(f.warn).not.toHaveBeenCalled();
  });

  it('starts no candidate when shutdown begins while the page query is pending', async () => {
    const f = fixture();
    const rows = deferred<ReturnType<typeof profile>[]>();
    f.db.$queryRaw.mockImplementationOnce(() => rows.promise);
    const pending = start(f);
    let stopped = false;
    const shutdown = f.service.beforeApplicationShutdown().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect((f.service as any).bootstrapStopping).toBe(true);
    rows.resolve([profile(1)]);
    await shutdown;
    await pending;

    expect(stopped).toBe(true);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
  });
});
