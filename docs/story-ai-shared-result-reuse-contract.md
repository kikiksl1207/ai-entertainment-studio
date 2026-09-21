# Story AI shared result reuse contract

## Product rule

Reader progress stays private per user. A generated continuation may become a
shared result only after the exact source context and all approval evidence are
the same. Later readers receive a new personal progress record that references
the approved shared result, so the reader experience is immediate without a
second provider call.

The shared result registry is not the author's canonical manuscript. Canonical
writer scenes and approved reusable AI scenes remain separate data layers even
when the player renders both as ordinary story scenes.

## What remains personal

- user and progress identifiers
- choice history, checkpoints, resets, allowance and entitlement state
- custom or free-form input
- unapproved/generated private branches
- personal moderation or provider request payloads

None of these fields may be stored in the shared result registry or included in
its reuse key.

## Exact reuse identity

A cache hit requires all of the following to match:

- work release and release checksum
- manuscript version and source ownership
- canonical scene/choice, or an already approved shared source and choice
- semantic path and normalized context fingerprints
- locale
- prompt and output-schema versions
- provider and model versions
- rate-card and cost-policy versions
- legal-rights activation snapshot
- moderation and quality policy/evidence versions

Matching only a choice number, similar text, or the same ending label is never
enough. Text that happens to be identical under a different story context must
not merge reader routes. A result checksum may detect duplicate payloads for
auditing or asset storage, but it does not replace the exact route identity.

## Lifecycle

1. The first eligible request creates a `pending` shared claim and one personal
   continuation.
2. Concurrent requests for the same identity receive a recoverable pending
   state. They do not create another provider request.
3. The generated result is written to the first reader's personal branch.
4. A persistent gate verifies legal activation, moderation evidence and quality
   approval.
5. Only a complete result can transition from `pending` to `approved`.
6. A later exact match creates a new personal scene/progress/event/ledger entry
   from the approved snapshot. Provider calls, token usage, allowance mutation
   and AI cost are all zero for this reuse.
7. A revoked result is never served as a shared hit. Existing audit provenance
   remains available to administrators.

Direct insertion as `approved` or `revoked` is forbidden. Shared source links
must belong to the same work and release, and a generated source must point to
an actual approved shared choice.

## Reader exposure

- An approved hit returns a completed continuation receipt immediately.
- The player advances by reloading the reader's newly created personal scene;
  it does not render raw shared-registry data directly.
- The safe receipt can distinguish `ai_generated` from `ai_reused` without
  exposing cache keys, provider payloads, private input or internal cost data.
- A still-pending shared result displays a recoverable waiting state in all five
  locales. Explicit recheck uses the same idempotency key; automatic duplicate
  POST requests are forbidden.
- Mobile behavior is verified at 390px and 400px together with desktop behavior.

## Fail-closed activation

The production approval adapter remains disabled until persisted legal-rights,
moderation and quality evidence stores are connected and explicitly approved.
Configuration flags alone do not establish legal permission. Missing or stale
evidence causes a miss or unavailable response, never an unreviewed shared hit.

## Required verification

- first miss, approval, and second-reader zero-cost hit
- two concurrent first requests and worker crash/retry recovery
- custom/private/generated-source rejection
- revoked-result rejection
- cross-work and cross-release source rejection at the database layer
- nonexistent shared-choice rejection at the database layer
- direct approved/revoked insert rejection
- fresh migration and legacy Imjin fixture preservation
- exact safe API response and five-locale mobile waiting/recovery behavior
