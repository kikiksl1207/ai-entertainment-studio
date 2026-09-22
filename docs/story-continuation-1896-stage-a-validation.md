# #1896 Stage A Validation

2026-09-22. Partial uncommitted WIP on
`codex/luffy-1896-length-budget-20260922`, base `d7627ca`.
This is a type/unit checkpoint, not proof/publication acceptance or complete
continuation length/timing readiness.

Historical Stage A record below is unchanged. Subsequent migration/PG/P2 and
bootstrap results, including two initial Stage B failures, are recorded in
[Stage B](story-continuation-1896-stage-b-proof.md); they do not retroactively
turn this earlier unit checkpoint into runtime acceptance.

## First Results

All commands ran sequentially in the granted exclusive slot using the own
physical E worktree dependencies. No compile/unit failure or corrective rerun.

| Check | First result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` | Exit 0; 746 packages; wrapper elapsed 39.5 seconds |
| Own Prisma generate | Exit 0; client v6.19.3, own `.prisma/client` and `@prisma/client` |
| Prisma schema validate | Exit 0 |
| `tsc --noEmit --incremental false --pretty false` | Exit 0; zero diagnostics |
| Four focused suites, one Jest `--runInBand` invocation | 4 passed; **107 PASS / 0 FAIL / 0 SKIP**; 17.573 seconds |

Executed suites:

- `server/src/story-production/story-author-final-review.service.spec.ts`
- `server/src/story-production/story-author-review-legacy-boundary.spec.ts`
- `server/src/story-production/story-continuation-length.policy.spec.ts`
- `server/src/story-production/story-continuation-timing.policy.spec.ts`

The service suite mocks receipt verification and DB hashing/transactions; it
does not establish SQL constraint or transaction-race correctness. The legacy
boundary suite uses synthetic legacy shapes, not the retained actual Imjin b51
database. Pure length/timing tests do not establish paid quality, admission,
latency or end-to-end worker behavior.

Installation emitted existing transitive deprecation warnings; Prisma emitted
its existing `package.json#prisma` deprecation warning. No audit, upgrade or lock
rewrite was requested. No test failure was hidden by a fixture adjustment.
One legacy-key fixture correction was made by source inspection before execution;
it was not a failed test or product fix discovered by this run.

## Environment and Evidence

Worktree: `E:/CodexMovedCache/worktrees/luffy-1896-length-budget-20260922`.
`server/node_modules`, `server/node_modules/.prisma/client` and
`server/node_modules/@prisma/client` were verified as physical directories, not
junctions. No other agent's client/dependencies or C fallback were used.

TEMP/TMP/TMPDIR and Jest cache were under
`E:/CodexMovedCache/tmp/luffy-1896-stage-a`; npm cache was
`E:/CodexMovedCache/npm-cache`. Raw command logs are local generated artifacts,
not Git content:

- `E:/CodexMovedCache/qa/luffy-1896-stage-a/01-npm-ci.log`
- `E:/CodexMovedCache/qa/luffy-1896-stage-a/02-prisma-generate.log`
- `E:/CodexMovedCache/qa/luffy-1896-stage-a/03-prisma-validate.log`
- `E:/CodexMovedCache/qa/luffy-1896-stage-a/04-tsc-first.log`
- `E:/CodexMovedCache/qa/luffy-1896-stage-a/05-focused-first.log`

There are 66 migration directories in source. **Zero migrations were applied**;
no database was created or connected in Stage A. `lumina_author_length_qa` is
reserved for a later separately authorized Stage B. No PG/HTTP/AppModule test
ran, and those unexecuted tests are not included as skips in the four-suite count.

All executed sessions exited 0. A final scoped process check found zero matching
Stage A Node/Prisma child processes. Heavy slot was explicitly returned to PM
before this documentation update. No API/provider/wallet/production operation,
manuscript scan, paid activation, push or donor modification occurred.

## Still Blocks Acceptance

- QR1 P2: current work-publication checksum verification does not protect live
  canonical content after approval/publication. The narrow immutable-content/
  membership guard and actual PostgreSQL counterexample remain unimplemented.
  Includes child insert/delete/reparent and choice fields, while allowing legal
  lifecycle status transitions and revocation. Work-first locking/direct SQL
  concurrency must be tested, not assumed.
- The new proof migration and receipt-backed publication path have not been
  applied or tested in PostgreSQL. Positive/negative/race/rollback constraints,
  actual Norse receipt path and default-OFF full AppModule checks remain pending.
- Original-author resolver/length/timing helpers are not yet wired through
  enqueue/job pins/output admission/output validation/shared/direct settlement,
  received usage or coordinated worker deadlines.
- INITIAL NEW submissions only. No historical submission upgrade, terminal
  review reopening, automatic author approval or edition/republication engine.
  Future revision/serial additions are tracked separately under #1901.
- Actual Imjin b51 read/publication acceptance is not v2 anchor readiness.
  Missing receipt/source keys require a separately verified preparation path,
  not an invented key or in-place historical migration.
