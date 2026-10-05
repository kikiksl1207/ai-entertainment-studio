import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryCompanyFinalSubmissionService } from './story-company-final-submission.service';

const timestamp = '2026-10-05 00:00:00.123456+00';
const privateDiagnostic = 'Synthetic private manuscript diagnostic, not operating content.';
const uuid = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

function profile(index: number) {
  return { id: uuid(index), createdAt: timestamp, ownerUserId: uuid(2001), workId: uuid(3000 + index),
    manuscriptVersionId: uuid(5000 + index), analysisJobId: uuid(7000 + index) };
}

function fixture() {
  const now = jest.spyOn(Date, 'now').mockReturnValue(0);
  const db = { $queryRaw: jest.fn().mockResolvedValue([]), $transaction: jest.fn() };
  const service = new StoryCompanyFinalSubmissionService(db as never);
  // Bootstrap orchestration only; the real submission method retains native authority, receipts and SQL write guards.
  const submit = jest.spyOn(service, 'autoSubmitCompletedAnalysis').mockResolvedValue(null);
  const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { db, service, submit, warn, now };
}

async function recover(f: ReturnType<typeof fixture>) {
  expect(f.service.onApplicationBootstrap()).toBeUndefined();
  const pending = (f.service as any).bootstrapRecovery;
  expect(pending).toBeInstanceOf(Promise);
  await expect(pending).resolves.toBeUndefined();
}

function queryAt(f: ReturnType<typeof fixture>, index: number) {
  return f.db.$queryRaw.mock.calls[index][0] as Prisma.Sql;
}

function argumentsFor(row: ReturnType<typeof profile>) {
  return [row.ownerUserId, row.workId, row.manuscriptVersionId, row.analysisJobId];
}

function expectPrivateLogsAbsent(f: ReturnType<typeof fixture>, rows: ReturnType<typeof profile>[]) {
  const logged = JSON.stringify(f.warn.mock.calls);
  expect(logged).not.toContain(privateDiagnostic);
  for (const row of rows) {
    for (const id of [row.id, ...argumentsFor(row)]) expect(logged).not.toContain(id);
  }
}

describe('Company final submission bootstrap recovery', () => {
  afterEach(() => jest.restoreAllMocks());

  it('selects only approved nonfixture company drafts with owned work bindings and a stable 100-row order', async () => {
    const f = fixture();
    await recover(f);

    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    const query = queryAt(f, 0);
    const sql = query.text.replace(/\s+/g, ' ');
    expect(sql).toContain('FROM story_work_generation_profiles AS profile');
    expect(sql).toContain('JOIN story_works AS work ON work.id = profile.work_id AND work.owner_user_id = profile.owner_user_id');
    expect(sql).toContain('WHERE profile.status = $1 AND work.author_display_name = $2');
    expect(sql).toContain('work.fixture_source = false AND work.status = $3');
    expect(sql).toContain('profile.created_at::text AS "createdAt"');
    expect(sql).toContain('ORDER BY profile.created_at ASC, profile.id ASC LIMIT $4');
    expect(query.values).toEqual(['approved', '\uB8E8\uBBF8\uB098', 'draft', 100]);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
  });

  it('stops after an empty page without submitting or approving any profile', async () => {
    const f = fixture();
    f.db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([profile(1)]);

    await recover(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('returns immediately, prevents concurrent bootstrap duplication, and drains only the running submission before shutdown', async () => {
    const f = fixture();
    const rows = [profile(1), profile(2)];
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    let release!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    f.submit.mockImplementationOnce(async () => {
      const held = new Promise<void>(resolve => { release = resolve; });
      signalStarted();
      await held;
      return null;
    });
    expect(f.service.onApplicationBootstrap()).toBeUndefined();
    const recovery = (f.service as any).bootstrapRecovery;
    expect(recovery).toBeInstanceOf(Promise);
    await started;

    expect(f.service.onApplicationBootstrap()).toBeUndefined();
    expect((f.service as any).bootstrapRecovery).toBe(recovery);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.submit.mock.calls).toEqual([argumentsFor(rows[0])]);
    let stopped = false;
    const shutdown = f.service.beforeApplicationShutdown().then(() => { stopped = true; });
    expect((f.service as any).bootstrapStopping).toBe(true);
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await shutdown;
    expect(stopped).toBe(true);
    expect((f.service as any).bootstrapRecovery).toBeUndefined();
    expect(f.submit.mock.calls).toEqual([argumentsFor(rows[0])]);
    expect(f.service.onApplicationBootstrap()).toBeUndefined();
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.warn).not.toHaveBeenCalled();
  });

  it('advances past 100 profiles using the exact microsecond timestamp and id cursor without offsets', async () => {
    const f = fixture();
    const first = Array.from({ length: 100 }, (_, index) => profile(index + 1));
    const next = profile(101);
    f.db.$queryRaw.mockResolvedValueOnce(first).mockResolvedValueOnce([next]);

    await recover(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(2);
    const second = queryAt(f, 1);
    expect(second.text.replace(/\s+/g, ' '))
      .toContain('AND (profile.created_at, profile.id) > ($4::timestamptz, $5::uuid)');
    expect(second.values).toEqual(['approved', '\uB8E8\uBBF8\uB098', 'draft', timestamp, first[99].id, 100]);
    expect(second.text).not.toContain('OFFSET');
    expect(f.submit.mock.calls).toEqual([...first, next].map(argumentsFor));
    expect(f.warn).not.toHaveBeenCalled();
  });

  it('caps recovery at ten full pages and 1000 profiles with one identifier-free warning and no eleventh read', async () => {
    const f = fixture();
    for (let page = 0; page < 10; page++) {
      f.db.$queryRaw.mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => profile(page * 100 + index + 1)));
    }
    f.db.$queryRaw.mockResolvedValue([profile(1001)]);

    await recover(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(10);
    expect(f.submit).toHaveBeenCalledTimes(1000);
    expect(f.submit.mock.calls[999]).toEqual(argumentsFor(profile(1000)));
    expect(queryAt(f, 9).values).toEqual(['approved', '\uB8E8\uBBF8\uB098', 'draft', timestamp, profile(900).id, 100]);
    expect(f.warn.mock.calls).toEqual([['Company manuscript submission recovery reached the 1000-profile scan limit']]);
    expectPrivateLogsAbsent(f, [profile(900), profile(1000), profile(1001)]);
  });

  it('does not report the cap when the tenth page contains fewer than 100 profiles', async () => {
    const f = fixture();
    for (let page = 0; page < 10; page++) {
      const length = page === 9 ? 99 : 100;
      f.db.$queryRaw.mockResolvedValueOnce(Array.from({ length }, (_, index) => profile(page * 100 + index + 1)));
    }

    await recover(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(10);
    expect(f.submit).toHaveBeenCalledTimes(999);
    expect(f.warn).not.toHaveBeenCalled();
  });

  it('rechecks an existing receipt through the same submission method on each bootstrap invocation', async () => {
    const f = fixture();
    const row = profile(1);
    f.db.$queryRaw.mockResolvedValue([row]);
    // The replay result is a wiring stub, not proof that a synthetic receipt passed native policy validation.
    f.submit.mockResolvedValue({ idempotentReplay: true } as never);

    await recover(f);
    expect((f.service as any).bootstrapRecovery).toBeUndefined();
    await recover(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(f.submit.mock.calls).toEqual([argumentsFor(row), argumentsFor(row)]);
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
  });

  it.each(['synchronous', 'asynchronous'])('continues after a %s item failure without exposing receipt or source identifiers', async mode => {
    const f = fixture();
    const rows = [profile(1), profile(2)];
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    const error = new ConflictException({ code: 'COMPANY_FINAL_SUBMISSION_CHANGED',
      message: privateDiagnostic, ownerUserId: rows[0].ownerUserId, manuscriptVersionId: rows[0].manuscriptVersionId });
    if (mode === 'synchronous') f.submit.mockImplementationOnce(() => { throw error; });
    else f.submit.mockRejectedValueOnce(error);

    await recover(f);
    expect(f.submit.mock.calls).toEqual(rows.map(argumentsFor));
    expect(f.warn.mock.calls).toEqual([['Company manuscript submission recovery skipped: ConflictException']]);
    expectPrivateLogsAbsent(f, rows);
  });

  it.each([
    ['a tainted Error name', Object.assign(new Error(privateDiagnostic), { name: privateDiagnostic }), 'Error'],
    ['a non-Error diagnostic', { name: privateDiagnostic, message: privateDiagnostic }, 'unknown error'],
    ['a Prisma error', new Prisma.PrismaClientKnownRequestError(privateDiagnostic,
      { code: 'P2034', clientVersion: 'synthetic-qa' }), 'PrismaClientKnownRequestError'],
  ])('logs only the safe classification for %s and continues', async (_label, error, name) => {
    const f = fixture();
    const rows = [profile(1), profile(2)];
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    f.submit.mockRejectedValueOnce(error);

    await recover(f);
    expect(f.submit.mock.calls).toEqual(rows.map(argumentsFor));
    expect(f.warn.mock.calls).toEqual([[`Company manuscript submission recovery skipped: ${name}`]]);
    expectPrivateLogsAbsent(f, rows);
  });

  it.each(['first', 'later'])('stops after the %s page query fails without failing application initialization', async page => {
    const f = fixture();
    const rows = Array.from({ length: 100 }, (_, index) => profile(index + 1));
    if (page === 'later') f.db.$queryRaw.mockResolvedValueOnce(rows);
    const diagnostic = Object.assign(new Error(`${privateDiagnostic} ${rows[0].workId}`), { name: rows[0].id });
    f.db.$queryRaw.mockRejectedValueOnce(diagnostic).mockResolvedValueOnce([profile(101)]);

    await recover(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(page === 'later' ? 2 : 1);
    expect(f.submit).toHaveBeenCalledTimes(page === 'later' ? 100 : 0);
    expect(f.warn.mock.calls).toEqual([['Company manuscript submission recovery stopped: Error']]);
    expectPrivateLogsAbsent(f, rows);
  });

  it('stops before the first page read when the wall budget has already reached ten seconds', async () => {
    const f = fixture();
    f.now.mockReturnValueOnce(0).mockReturnValue(10000);

    await recover(f);
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn.mock.calls).toEqual([['Company manuscript submission recovery reached the 10-second time limit']]);
  });

  it('stops before the first candidate when the page read exhausts the wall budget', async () => {
    const f = fixture();
    const row = profile(1);
    f.db.$queryRaw.mockResolvedValueOnce([row]);
    f.now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10000);

    await recover(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn.mock.calls).toEqual([['Company manuscript submission recovery reached the 10-second time limit']]);
    expectPrivateLogsAbsent(f, [row]);
  });

  it('allows an already running submission to finish after the budget expires without starting another candidate', async () => {
    const f = fixture();
    const rows = [profile(1), profile(2)];
    f.db.$queryRaw.mockResolvedValueOnce(rows);
    let release!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    f.submit.mockImplementationOnce(async () => {
      const held = new Promise<void>(resolve => { release = resolve; });
      signalStarted();
      await held;
      return null;
    });
    f.service.onApplicationBootstrap();
    await started;
    f.now.mockReturnValue(10000);
    let stopped = false;
    const pending = ((f.service as any).bootstrapRecovery as Promise<void>).then(() => { stopped = true; });
    await Promise.resolve();

    expect(stopped).toBe(false);
    expect(f.warn).not.toHaveBeenCalled();
    release();
    await pending;
    expect(f.submit.mock.calls).toEqual([argumentsFor(rows[0])]);
    expect(f.warn.mock.calls).toEqual([['Company manuscript submission recovery reached the 10-second time limit']]);
    expect((f.service as any).bootstrapRecovery).toBeUndefined();
    expectPrivateLogsAbsent(f, rows);
  });

  it('stops before the next page when the last candidate of a full page exhausts the wall budget', async () => {
    const f = fixture();
    const rows = Array.from({ length: 100 }, (_, index) => profile(index + 1));
    f.db.$queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([profile(101)]);
    f.submit.mockImplementation(async (_owner, _work, _manuscript, analysisJobId) => {
      if (analysisJobId === rows[99].analysisJobId) f.now.mockReturnValue(10000);
      return null;
    });

    await recover(f);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.submit.mock.calls).toEqual(rows.map(argumentsFor));
    expect(f.warn.mock.calls).toEqual([['Company manuscript submission recovery reached the 10-second time limit']]);
    expectPrivateLogsAbsent(f, rows);
  });

  it('stops before the first candidate when shutdown starts during the page read', async () => {
    const f = fixture();
    const row = profile(1);
    let release!: (rows: ReturnType<typeof profile>[]) => void;
    f.db.$queryRaw.mockImplementationOnce(() => new Promise<ReturnType<typeof profile>[]>(resolve => { release = resolve; }));
    expect(f.service.onApplicationBootstrap()).toBeUndefined();
    let stopped = false;
    const shutdown = f.service.beforeApplicationShutdown().then(() => { stopped = true; });
    await Promise.resolve();

    expect(stopped).toBe(false);
    expect((f.service as any).bootstrapStopping).toBe(true);
    release([row]);
    await shutdown;
    expect(stopped).toBe(true);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
    expect((f.service as any).bootstrapRecovery).toBeUndefined();
  });

  it('does not read another page when shutdown starts in the final submission of a full page', async () => {
    const f = fixture();
    const rows = Array.from({ length: 100 }, (_, index) => profile(index + 1));
    f.db.$queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([profile(101)]);
    let shutdown: Promise<void> | undefined;
    f.submit.mockImplementation(async (_owner, _work, _manuscript, analysisJobId) => {
      if (analysisJobId === rows[99].analysisJobId) shutdown = f.service.beforeApplicationShutdown();
      return null;
    });

    await recover(f);
    expect(shutdown).toBeInstanceOf(Promise);
    await shutdown;
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.submit.mock.calls).toEqual(rows.map(argumentsFor));
    expect(f.warn).not.toHaveBeenCalled();
    expect((f.service as any).bootstrapStopping).toBe(true);
  });
});
