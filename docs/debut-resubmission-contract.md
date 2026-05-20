# Debut Needs-More-Info Resubmission Contract

Updated: 2026-05-20
Owner: Kaido
Tasks: Notion #346, #350 handoff

This contract opens one owner-only resubmission path for debut applications in
`needs_more_info`. It does not finalize debut, contracts, settlement, payout,
wallet, Lumina, or notification delivery.

## Owner Status Projection

When an owner application is in `needs_more_info`, the status response exposes a
real resubmission CTA:

```json
{
  "application": {
    "status": "needs_more_info",
    "messageKey": "debut.application.status.needsMoreInfo",
    "cta": {
      "enabled": true,
      "messageKey": "debut.application.cta.resubmit",
      "actionAllowed": true,
      "mutationAllowed": true,
      "contractOnly": false,
      "endpoint": "/api/v1/me/debut-applications/:applicationId/resubmit",
      "method": "POST",
      "bodyContractKey": "debut.application.resubmission.body.fullApplication"
    },
    "publicNotice": {
      "publicReason": "operator-public reason only",
      "requestedActionKey": "stable action key",
      "internalAdminNoteReturned": false,
      "settlementOrContractFinalized": false
    }
  }
}
```

For all other user-facing statuses, CTA mutation fields stay disabled.

## Resubmit Endpoint

```http
POST /api/v1/me/debut-applications/:applicationId/resubmit
Authorization: Bearer <owner token>
Content-Type: application/json
```

The body uses the same shape as `POST /api/v1/debut/applications`. The server
treats the submission as a full replacement of the applicant-visible application
fields and private material links:

- allowed only when the owned application raw status is `needs_more_info`
- keeps the same `debut_applications.id`
- resets status to `submitted`
- replaces applicant fields, consent fields, metadata, and attachments
- clears the previous public request fields (`publicStatusReason`,
  `requestedActionKey`) from the active metadata
- records non-sensitive resubmission metadata such as count, timestamp, source,
  endpoint, and replacement mode
- records a redacted audit event

## Error Contract

Stable errors for this flow:

| Condition | HTTP | code | messageKey |
| --- | --- | --- | --- |
| Application missing or not owned | 404 | `DEBUT_APPLICATION_NOT_FOUND` | `debut.application.notFound` |
| Status is not `needs_more_info` | 400 | `DEBUT_RESUBMIT_STATUS_NOT_OPEN` | `debut.resubmit.statusNotOpen` |
| Missing contact email | 400 | `DEBUT_CONTACT_EMAIL_REQUIRED` | `debut.contactEmail.required` |
| Missing intro | 400 | `DEBUT_INTRO_REQUIRED` | `debut.intro.required` |
| Missing required consent | 400 | `DEBUT_REQUIRED_CONSENT_MISSING` | `debut.consent.required` |
| Phone-consultation phone missing | 400 | `DEBUT_CONTACT_PHONE_REQUIRED` | `debut.contactPhone.requiredForPhoneConsultation` |
| Phone-consultation consent missing | 400 | `DEBUT_CONSULTATION_CONSENT_REQUIRED` | `debut.consultationConsent.requiredForPhoneConsultation` |
| Intro too short | 400 | `DEBUT_INTRO_TOO_SHORT` | `debut.intro.tooShort` |

Existing private material errors still apply to attachment asset ids, ownership,
scope, category, confirmation status, and MIME category.

## Safety Notes

- Owner response never returns contact values, intro text, admin review notes,
  internal metadata, private material URLs, signed URLs, storage keys, object
  ETags, secrets, tokens, cookies, or passwords.
- Admin internal notes and operator-only review data stay separate from
  `publicStatusReason`.
- Resubmission is not a final approval, not a contract, and not a paid or
  settlement-related action.
