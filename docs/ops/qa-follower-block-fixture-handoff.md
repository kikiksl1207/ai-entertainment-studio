# Follower/block QA fixture handoff

Purpose: prepare a disposable QA-only public profile target with at least one
active follower row so QR can verify Lumina Feed follower and block entry points
without touching normal user data.

## Safety

- Do not run against production unless PM/Ops explicitly approves the QA-only
  fixture run.
- Do not record raw email, password, token, cookie, API key, or DB URL.
- Record only non-secret handoff fields: `runId`, `dryRun`,
  `fixtureStatus`, `publicProfileHandle`, `publicProfilePath`,
  `publicProfileApiPath`, `followersApiPath`, `followingApiPath`,
  `blockApiPath`, and `followerPublicHandle`.
- Use `fixtureStatus=dry_run_preview_only` only as a shape check. It is not
  PASS evidence for #1256.
- Use `fixtureStatus=confirmed_ready` as the only confirmed-run readiness
  status QR can consume.
- The script refuses to touch public handles outside the `qa-fb-` prefix.
- The `qa-fb-` prefix is reserved for approved disposable fixture rows only;
  normal user signup or profile handle changes must not allocate that namespace.
- The script creates or reactivates only disposable QA users and one active
  `user_follows` row for the generated run id.
- It does not create blocks, posts, wallet ledger rows, Lumina entries,
  settlement rows, payout rows, auth tokens, or passwords.

## Dry run

Dry run is the default and does not require a database connection.

```powershell
cd server
$env:FOLLOWER_BLOCK_QA_RUN_ID="qa-20260627-run1"
npm.cmd run qa:follower-block-fixture
```

The output is the public handoff shape QR can expect after a confirmed run.
Dry-run output must show `dryRun: true` and
`fixtureStatus: "dry_run_preview_only"`.

## Confirmed fixture run

Use only in an approved staging/local or explicitly approved QA environment.

```powershell
cd server
$env:FOLLOWER_BLOCK_QA_RUN_ID="qa-20260627-run1"
$env:FOLLOWER_BLOCK_QA_FIXTURE_DRY_RUN="false"
$env:FOLLOWER_BLOCK_QA_FIXTURE_CONFIRM="CREATE_FOLLOWER_BLOCK_QA_FIXTURE"
npm.cmd run qa:follower-block-fixture
```

Record only the returned non-secret handoff fields.
Confirmed output must show `dryRun: false` and
`fixtureStatus: "confirmed_ready"`.

If the approved environment is not available, do not ask for passwords or
private connection strings. Leave one required action: run the confirmed command
above in an approved staging/local/QA DB environment and return only the
non-secret handoff fields.

## QR read-only checks

After the confirmed run, QR should verify:

- `GET /api/v1/users/handle/<publicProfileHandle>/profile` returns 200.
- `GET /api/v1/users/handle/<publicProfileHandle>/followers` returns 200 and
  at least one active follower item.
- `GET /api/v1/users/handle/<publicProfileHandle>/following-users` returns 200.
- `/user-profile?handle=<publicProfileHandle>` opens the public profile UI.
- The block entry point can be located by handle, but no live block mutation is
  required unless a separate safe session and cleanup path are approved.

If any check fails, keep the run id and public handle in the blocker report
without secrets.
