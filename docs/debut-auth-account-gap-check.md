# Debut Auth Account Gap Check

Updated: 2026-05-20
Owner: Kaido
Task: Notion #340

This document fixes the final account/auth gap map for the AI Debut application
flow. It does not connect NICE, i-PIN, mobile identity, settlement, payout,
wallet, or contract finalization.

## Endpoint Gate Summary

| Endpoint | Auth | Mutation | Gate |
| --- | --- | --- | --- |
| `GET /api/v1/debut/policy` | Public | No | Form policy only. |
| `POST /api/v1/debut/applications` | `JwtAuthGuard` | Creates application | Active logged-in user, `isAdult=true`, required consents, private material rules. |
| `POST /api/v1/debut/application-materials/upload-intents` | `JwtAuthGuard` | Creates private asset marker | Active logged-in user, private `debut_application_material` scope. |
| `POST /api/v1/debut/application-materials/:assetId/confirm-upload` | `JwtAuthGuard` | Confirms private material | Owner-only private asset, storage verification when not local. |
| `GET /api/v1/me/debut-applications*` | `JwtAuthGuard` | No | Owner-only status projection. |
| `PATCH /admin/api/v1/debut/applications/:applicationId/review` | Admin guards | Review metadata only | `*` admin permission; no final debut/contract/settlement/payout/wallet mutation. |

## Account State Matrix

| Account state | Submit application | Notes |
| --- | --- | --- |
| Logged out | Blocked | `JwtAuthGuard` blocks submit/material/status owner APIs. |
| Active email account, email unverified | Allowed for MVP | `/me.emailVerification` exposes `auth.emailVerification.required`, but debut submit is low-friction and not hard-gated. |
| Active email verified | Allowed | Same submit rules; email state is still visible to frontend. |
| Active social-only user | Allowed | Password is not required; `/me.hasPassword=false` and `/me.isSocialOnly=true` are separate account-management signals. |
| Identity unverified | Allowed for MVP | NICE/i-PIN/mobile provider remains a skeleton and is not a submit gate. |
| Identity verified adult | Allowed | When provider birth date is available and adult, no extra block. |
| Identity verified minor | Blocked | Server returns `DEBUT_APPLICANT_MINOR_NOT_ALLOWED` / `debut.applicant.minorNotAllowed`. |
| Declared minor, `isAdult=false` | Blocked | Server returns `DEBUT_APPLICANT_ADULT_CONFIRMATION_REQUIRED` / `debut.applicant.adultConfirmationRequired`. |
| Inactive/deleted user | Blocked | Auth layer cannot establish an active user. |

## What Was Hardened

- `POST /api/v1/debut/applications` now keeps the existing `isAdult=true`
  requirement and also blocks a verified identity record with a known minor
  birth date.
- The minor check is inactive for unknown/unverified identities so the MVP does
  not depend on a NICE real provider before that integration exists.
- Stable codes/messageKeys were added for the debut adult-confirmation and
  verified-minor blocks.

## Remaining Deferred Gaps

- NICE/i-PIN/mobile callback, signature verification, and provider subject hash
  are still outside this task.
- If PM decides email verification must become a hard debut gate, add an
  explicit email-verified server check before frontend enables submit. Current
  MVP contract leaves submit open to active logged-in users.
- No live mutation was run because safe QA credentials are not stored in the
  repo/session and should not be transmitted through Notion/chat.
