# #1896 Stage B Proof Validation Record

Bounded initial-proof candidate, 2026-09-22; independent review pending.
Stage B ran 00:28:22..00:43:35 UTC (15m13s) with own physical E dependencies
and client66. Final result: 7 suites, **97 PASS / 0 FAIL / 0 SKIP**;
first and final whole-server type checks passed. Two initial failures and their
corrections are recorded below, not erased by the final passing result.
All child commands completed, scoped Node/Prisma processes and other target DB
client sessions were zero, and the exclusive heavy slot was returned.
No paid provider, external manuscript transmission, wallet or production call.

## Bounded Fix

QR1 P2 exposed live-reader mutation after approval/publication: a later checksum
check would only reject continuation, not protect already-public canonical rows.
The migration `20260923010000_story_author_final_review_proof` adds:

- Proof-covered part/scene/beat/choice content, identity, membership and mapping
  immutability. Old and new scopes are checked for reparent; extra children and
  deletion are denied. Revocation does not unlock mutation.
- Lifecycle status/publication/update timestamps and no-op writes remain allowed;
  created_at remains immutable. Published work
  suspension and same-release resumption validate the same proof instead of
  trying to revalidate the old draft status checksum.
- Sorted work-first application locking; direct-DML trigger ancestor locks use
  NOWAIT because the target row may already be locked. Recheck ancestry; work
  timestamp MVCC barrier at proof insertion prevents a pre-proof repeatable-read
  snapshot from missing approval. A busy direct write fails, not silently retries.
- Canonical table TRUNCATE is unsupported; row-scoped legacy editing is allowed
  until proof approval. No trigger is disabled and no history is rewritten.

This freezes the INITIAL NEW-proof edition. Revision/republication/serial
additions preserving old reader pins belong to #1901, not this implementation.
The actual legacy Imjin b51 receipt/mapping gap remains unchanged.

## Executed Results

| Sequential check | Final result | Duration |
| --- | --- | --- |
| Existing lifecycle service, lifecycle policy, authored import | 3 suites / 15 PASS | 17.114s |
| Proof service unit + real PostgreSQL | 2 suites / 34 PASS (22 unit, 12 PG) | 65.604s |
| Approved-content P2 PostgreSQL counterexamples | 1 suite / 47 PASS | 17.847s |
| Default-OFF full AppModule / health HTTP / close | 1 suite / 1 PASS | 33.326s |
| Whole-server `tsc --noEmit --incremental false`, first and final | Both exit 0, no diagnostics | Separate checks |

The 47 P2 probes include post-publication fields/mapping/choices, child insertion
and deletion, inbound/outbound reparenting, TRUNCATE denial, immediate approval
freeze, legal status/no-op writes, suspension/resumption, revocation, NOWAIT
contention, stale repeatable-read snapshots and unapproved legacy editing.
Negative probes roll back even if a guard were broken; approved content hashes
are checked unchanged. Error assertions expose codes/booleans, not payloads.

The AppModule test used actual loopback health200, default-OFF providers/workers,
no provider keys/rates, proof DI resolution, clean app.close and zero external
fetches. **This is bootstrap only, not JWT/DTO/filter proof of the author
proposal/confirm/revoke routes or a complete writer UI workflow.**

## First Failures and Corrections

1. First fresh migration failed with Prisma P3018 / PostgreSQL 42601. An
   `IS DISTINCT FROM CASE ... END` expression in the new proof guard required
   parenthesized `(CASE ... END)`. Initial SQL SHA-256:
   `0748a7a829b7a3af4245d98563589041d44bf798a0a7c9870477cd62dcd472f0`.
   Own fresh DB had 65 completed migrations, one unfinished attempt and zero
   new proof table/function artifacts. With explicit PM authorization, only
   that failed attempt was marked rolled back, then corrected migration66 was
   applied. No reset, retained evidence DB change or earlier migration rewrite.
2. First proof PG run: **2 PASS / 9 FAIL / 1 SKIP**. The separately gated actual
   fixture path was still being resolved. Success paths returned safe
   `AUTHOR_FINAL_REVIEW_PERSISTENCE_UNKNOWN`: diagnostics showed the new
   submission's application-supplied Prisma timestamp did not equal the DB
   transaction timestamp, while all other binding/hash/ownership booleans were
   true. Product correction: `createAuthorFinalSubmissionTx()` uses a
   parameterized insert that omits `created_at`, preserving its DB default and
   the strict same-transaction proof guard. The applied SQL guard was not
   weakened. Unit store fixtures were adapted to that helper. The affected
   unit/PG rerun passed all 34 tests, including the first actual216 probe.

Final own DB `lumina_author_length_qa`: **66 completed / 1 rolled-back attempt /
0 unfinished**. Corrected source SQL and applied migration checksum match:
`7ef3cf3f17e0b514afe169d5f24eb96b4c279f09b1d6c9356c5ffd50be53664f`.
The connection URL remained environment-only. No retained Norse/Imjin DB was
modified. Stage A's separate first-pass 107-unit/type checkpoint remains intact.

## Actual Source Integrity

Read-only originals were hash-checked before and after, without printing prose,
copying source into Git or reading/converting the retained 72MB package:

| Fixture | Bytes | Unchanged SHA-256 |
| --- | --- | --- |
| `E:/CodexMovedCache/tmp/kaido-1883-actual-compact-20260922/authored-source-map.json` | 15,573,738 | `f6482c710acbc7b63f98783f3ca7f06ebc37d22f5566deb51e719f438eae6bc5` |
| `E:/CodexMovedCache/tmp/manuscript-intake-20260914/revision-2/norse/analysis-input.json` | 11,466,327 | `74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8` |

Fresh own DB contains **one actual216 receipt and one QA publication** via
synthetic owning-user confirmation. This is NOT actual author consent or
production publication. Continuation rows: zero. Counts/digests, not raw source,
were exposed. Existing independent publication gates remain enabled; fixtures
provide explicit QA-only rights/price/assets/capability data.

## Retained Evidence

Local logs: `E:/CodexMovedCache/qa/luffy-1896-stage-b/`.
`01..02` database precheck/create; `03..06` initial migration, zero-artifact
state, authorized rollback marker and corrected apply; `07` first type check;
`08` existing regression; `09..11` first proof failure and safe diagnostics;
`12/14` actual source hashes before/after; `13` proof unit/PG retry;
`15` P2 PG; `16` AppModule bootstrap; `17` final type check; `18` final DB state.
Own E dependencies/client66 and this QA DB are retained for independent review.

## Test Scope

The PostgreSQL fixtures create isolated QA users and explicit test review
confirmations. Their structural_legacy analysis-completed state is not semantic
AI approval. The real-source fixture demonstrates receipt/reference coverage
and transactional behavior, not actual author consent, story quality, verified
real-world rights, approved scene-specific assets or a production price decision.
Synthetic offline rate cards and capability records exercise the existing
publication economics gate without invoking a provider, wallet or paid API.
No existing independent gate is disabled or bypassed in application code.

Sources under test:

- `server/prisma/migrations/20260923010000_story_author_final_review_proof/migration.sql`
- `server/src/story-production/story-authored-import.service.ts`
- `server/src/story-production/story-author-final-review.postgres-fixture.ts`
- `server/src/story-production/story-author-final-review.postgres.spec.ts`
- `server/src/story-production/story-author-approved-content.postgres.spec.ts`
- `server/src/story-production/story-author-final-review.app.postgres.spec.ts`

## Not Complete

Independent actual JWT/DTO/filter proposal/confirm/revoke HTTP tests remain.
Length admission, pinned job inheritance, output/ending validation,
known-usage settlement, shared results and coordinated deadlines remain unwired.
No helper test or proof-stage result may be reported as complete #1896 behavior.
Full author revisions, legacy receipt upgrading and automatic author approval
remain outside this initial-only scope.
