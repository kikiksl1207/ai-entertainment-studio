# Trust, Identity Verification, And Abuse Policy

Updated: 2026-05-03

This document fixes the backend direction for Notion tasks #097-#099.
The goal is low-friction signup with stronger checks only when money, rewards,
ranking manipulation, or settlement liability appears.

## Core Principle

Signup stays easy. Verification is required for high-risk actions.

Unverified users can:

- browse artists
- use free basic chat
- read feeds
- follow artists or users
- use daily free likes

Verified or higher-trust users are required for:

- referral reward eligibility
- promotional Lumina use on settlement-generating products
- paid likes / Lumina boosts
- fan letters
- premium character-chat modes when settlement eligible
- creator settlement application
- payout account registration
- high-value or repeated charge attempts

## Free Like Vs Paid Support

Free like:

- daily participation signal
- ranking / fan-temperature input
- no wallet ledger debit
- settlement excluded
- can be down-weighted or delayed for new/risky accounts

Paid support:

- Lumina is debited
- writes wallet ledger
- creates boost/chat/fan-letter event
- settlement candidate when policy allows
- should require verified or sufficiently trusted account before public launch

## Suggested Trust Levels

| Level | Code | User state | Allowed scope |
| --- | --- | --- | --- |
| 0 | `basic` | email/social signup | browse, free basic chat, free like |
| 1 | `verified_phone` | phone identity verified | referrals, paid support, bonus-spend unlock |
| 2 | `creator_candidate` | debut/creator review started | applicant review |
| 3 | `creator_settlement` | payout/tax/contract completed | settlement dashboard and payout |
| 9 | `admin` | admin access | operations only |

Do not store raw resident registration numbers or sensitive identity documents.
Use a real identity provider later and store only provider id, verification
status, and non-reversible hashes needed for duplicate checks.

## Account Limit

Initial policy:

- one verified identity may own up to 3 user accounts.
- referral rewards and promotional settlement exposure are capped per verified
  identity, not per account.
- unverified accounts can exist but cannot create unlimited settlement liability.

## Promotional Lumina

Promotional Lumina spent on paid creator products remains settlement eligible.
This protects creator trust.

Abuse controls:

- promotional spend that creates settlement liability can enter `pending` or
  `hold` until the fraud window passes.
- self-referral and related-account spending should be flagged.
- new accounts, same IP/device bursts, and repeated same-artist spending patterns
  should be flagged for review.

Creator-facing settlement should not split paid/free Lumina. Internal admin
reporting should track promotional cost as marketing spend.

## Backend Data Draft

Recommended future tables:

```txt
user_identity_verifications
- id
- user_id
- provider
- provider_subject_hash
- phone_hash
- identity_group_hash
- status: pending / verified / rejected / revoked
- verified_at
- revoked_at
- metadata
- created_at
- updated_at

user_trust_profiles
- user_id
- trust_level
- risk_score
- referral_eligible
- paid_support_eligible
- settlement_spend_eligible
- identity_group_hash
- account_count_in_group
- last_reviewed_at
- metadata
- created_at
- updated_at

user_risk_events
- id
- user_id
- event_type
- severity
- source
- target_type
- target_id
- metadata
- created_at
```

Recommended event types:

- `same_device_signup_burst`
- `same_ip_signup_burst`
- `self_referral_attempt`
- `related_account_creator_spend`
- `promo_lumina_settlement_spike`
- `paid_support_velocity`
- `identity_group_account_limit`

## API Draft

```http
GET /api/v1/me/trust
GET /api/v1/me/identity-verifications/policy
POST /api/v1/me/identity-verifications
POST /api/v1/me/identity-verifications/:verificationId/confirm
```

Implementation status:

- `GET /api/v1/me/identity-verifications/policy` is implemented as a
  NICE-first provider skeleton with account policy flags.
- `GET /api/v1/me/trust` returns `accountState` with
  `signupAllowedWithoutIdentityVerification: true`,
  `identityVerificationBeforeSignupRequired: false`, derived `ageGate`,
  `cleanMode`, and non-sensitive storage policy.
- `POST /api/v1/me/identity-verifications` records only an `unverified`
  request marker and non-sensitive metadata.
- `POST /api/v1/me/identity-verifications/self/confirm` fails closed with
  `IDENTITY_VERIFICATION_PROVIDER_NOT_CONNECTED` until the real NICE callback
  and signature verification contract are connected.
- The server must not store resident registration numbers, raw identity
  documents, NICE raw names/phone numbers, raw provider tokens, or provider
  secrets.
- Signup must not be blocked before identity verification. Minor clean mode is
  enforced only after a verified provider birth date proves the account is under
  the adult threshold.

Restricted action error shape:

```json
{
  "code": "IDENTITY_VERIFICATION_REQUIRED",
  "message": "Identity verification is required for this action.",
  "action": {
    "type": "identity_verification",
    "label": "본인인증 후 이용하기"
  }
}
```

## Role Split

Chamo:

- trust levels, future identity provider skeleton, API action codes
- free-like / paid-support settlement eligibility flags
- promotional Lumina hold/risk policy

Cloud:

- unlock CTA when a restricted action is clicked
- separate free like and paid support UI
- artist dashboard metrics split

Emily:

- non-threatening identity verification copy
- free-like and paid-support labels
- fair-support / anti-abuse help text

