# Lumina Stage AI Debut Application Policy And Data Spec

Status: Draft for product, backend, and operations planning.
Owner: Chamo / Codex A.
Last updated: 2026-05-05.

This document is not a final legal contract. Before public launch, the consent copy,
privacy policy, revenue share terms, and creator agreement must be reviewed by a
qualified legal/privacy professional.

## 1. Product Intent

`AI Debut` lets a real person apply to become a Lumina Stage AI artist.

The target applicants are:

- People who want an artist identity but do not want to appear exactly as themselves.
- Undiscovered singers, dancers, actors, creators, or planners.
- People who want to contribute appearance, voice, song, story, or creative direction.

Lumina Stage provides:

- AI character transformation.
- Image/content production.
- Character profile and gallery operation.
- Fan voting, gifts, boosts, premium content, and future chat products.
- Revenue sharing according to the applicant's approved contribution tier.

## 2. Participation Types

| Type | Backend value | Applicant contribution | Draft share range |
| --- | --- | --- | --- |
| Appearance only | `appearance_only` | Face/body reference or visual identity direction | 20-30% |
| Voice or song | `voice_or_song` | Appearance plus voice sample, vocal recording, or song asset | 30-45% |
| Performance | `performance` | Appearance plus singing, dance, acting, choreography, or performance material | 45-60% |
| Co-creator | `co_creator` | Ongoing planning, concept writing, content ideas, fan communication, or viral contribution | Up to 70% |

The approved share is not automatic. Admin review sets the final `shareTierApproved`
after identity, rights, risk, and contribution review.

## 3. Data To Collect

### Required Initial Form Fields

- `applicantName`: review name. It may be legal name or review name, depending on the final identity process.
- `applicationChannel`: `phone_consultation` for MVP default, or `online_review` for a later richer application path.
- `displayName`: optional public stage/name idea.
- `contactEmail`: contact email.
- `contactPhone`: required for `phone_consultation`.
- `preferredContactTime`: optional preferred call time.
- `isAdult`: must be true for MVP. Minor applications are not accepted until a guardian flow exists.
- `participationType`: one of `appearance_only`, `voice_or_song`, `performance`, `co_creator`.
- `shareTierRequested`: applicant requested share percentage, integer 0-70.
- `intro`: motivation, story, concept, and expected contribution.
- `portfolioUrl`: optional portfolio or social link.
- `consentAppearance`: required true.
- `consentVoice`: true only when voice/song/performance material is submitted.
- `consentRevenuePolicy`: required true.
- `consentPrivacy`: required true.
- `consentMarketing`: optional marketing-receive consent. Store separately from required consents.
- `consultationConsent`: required true for `phone_consultation`.
- `metadata`: structured extension object for non-sensitive detail.

For `applicationType=partnership_other`, the MVP treats the form as a low-friction
consultation inquiry, not a personal AI debut consent. Required consents are
reduced to `consentPrivacy=true` plus `consultationConsent=true` for
`phone_consultation`; `consentAppearance` and `consentRevenuePolicy` are optional
and default to false when omitted. The minimum `intro` length is 10 characters
for this inquiry path, while normal debut applications keep the 20 character
minimum.

### MVP Application Channels

- `phone_consultation`: default MVP path. It collects basic contact data, self-introduction/concept, participation type, requested share, and preferred call time. No file upload is requested. A human operator follows up by phone.
- `online_review`: planned richer path for applicants who want to submit images or portfolio materials online. It remains no-file-upload in the current MVP backend until a separate secure upload flow is approved.

### Recommended Metadata Fields

Keep these inside `metadata` until the DB is expanded:

```json
{
  "stageConcept": "Desired artist mood and positioning",
  "applicationChannel": "phone_consultation",
  "preferredContactTime": "Weekdays after 7 PM",
  "preferredGenres": ["dance", "rnb"],
  "providedMaterials": ["photos", "voice_sample", "song_demo"],
  "prohibitedUses": ["adult content", "political messaging"],
  "availableForInterviews": true,
  "socialLinks": ["https://..."],
  "portfolioNotes": "Context for review",
  "expectedRole": "appearance provider / vocalist / co-creator",
  "settlementCountry": "KR",
  "reviewRiskNotes": "Admin-only later"
}
```

AI creator partner extension:

```json
{
  "applicationType": "ai_creator_partner",
  "plannedCharacterCount": 10,
  "creatorTools": ["ComfyUI", "Flux", "Photoshop"],
  "productionExperience": "Character image pack production and shortform editing",
  "sampleUrls": ["https://..."],
  "rightsOwnershipConfirmed": true
}
```

MVP slot policy:

- AI creator partners can submit up to 10 character candidates on the first
  application.
- These are review candidate slots, not guaranteed public launch slots.
- Approved characters are managed later in Creator Studio, not normal My Page.
- After real operations and settlement quality are proven, additional review
  slots can be sold/opened in 5-slot units.
- Additional slots also require review; purchase or approval to submit does not
  guarantee public launch.

Do not collect resident registration numbers, raw ID images, bank account details,
final contract files, or public-form file uploads in Notion, chat, or Git. Those require a later secure upload
and contract process. For the MVP phone-consultation path, collect text only and confirm details by phone.

## 4. Consent Checklist

MVP required consent:

- Applicant confirms submitted materials are their own or they have the right to submit them.
- Applicant allows Lumina Stage to review submitted appearance/reference materials.
- Applicant allows AI transformation and derivative character design for review.
- Applicant agrees to the draft revenue policy being non-final until admin approval and contract.
- Applicant agrees to privacy processing for application review.

Conditional consent:

- Voice/song/performance use consent is required if the applicant submits audio, vocal, song, dance, acting, or performance material.
- Marketing/public promotion consent should be separate from mandatory review consent.
- Training/fine-tuning consent should be separate from display/production consent.

Recommended checkbox labels for frontend:

- `I confirm that I own or have permission to submit all materials.`
- `I agree that Lumina Stage may review my submitted appearance/reference materials.`
- `I agree that Lumina Stage may create AI-transformed character drafts for review.`
- `I understand that revenue share is reviewed and finalized separately before launch.`
- `I agree to the privacy policy for application review.`
- `If I submit voice/song/performance material, I agree to its review use.`
- `Optional: I agree to marketing/public promotion use if my application is approved.`
- `Optional: I agree to model training or fine-tuning use under a separate approved scope.`

## 5. Review Workflow

Current backend statuses:

- `submitted`: user submitted the application.
- `reviewing`: admin is reviewing.
- `needs_more_info`: admin needs more data or clarification.
- `approved`: candidate can move to contract/production discussion.
- `rejected`: not selected.
- `withdrawn`: user or operator withdrew the application.

Recommended future statuses:

- `contracting`: agreement is being prepared.
- `contracted`: contract/consent package completed.
- `production`: image/voice/content production started.
- `launched`: AI artist is public.
- `suspended`: public operation paused due to dispute, policy, or safety issue.

## 6. Revenue Share Draft

Revenue share applies only to eligible net revenue assigned to the launched AI artist.
It should not include tax, PG fees, refunds, chargebacks, platform fees, company-wide
marketing spend, or unrelated revenue unless the final contract says otherwise.

Draft range:

- 20-30%: appearance/reference contribution only.
- 30-45%: appearance plus voice/song sample or recognizable musical contribution.
- 45-60%: performance contribution, recurring recording, choreography, acting, or high-value creative material.
- Up to 70%: co-creator role with ongoing planning, content direction, fan activation, and measurable viral contribution.

Admin should store:

- requested share: `shareTierRequested`.
- approved share: `shareTierApproved`.
- reason for approved share: `reviewNote` or future structured review table.
- contract version and effective date: future secure contract table.

## 7. Risk And Guardrails

### Core Risks

- Identity fraud or use of another person's face, voice, or performance.
- Minor applicant without guardian consent.
- Disputes about whether the AI artist is the applicant's persona or a separate character.
- Withdrawal requests after public launch.
- Revenue share disputes.
- Voice likeness or deepfake misunderstanding.
- Sexualized, defamatory, discriminatory, or politically sensitive use.
- Privacy policy gaps around AI processing, retention, and user rights.

### MVP Guardrails

- Accept adult applicants only.
- Do not accept ID documents in the public form.
- Do not collect bank or settlement data in the public form.
- Do not launch an accepted applicant publicly until contract/consent is complete.
- Keep AI artist identity as a Lumina Stage-created character unless contract says otherwise.
- Separate review consent, marketing consent, and training/fine-tuning consent.
- Keep `prohibitedUses` and applicant boundaries in review metadata.
- Provide a withdrawal/support contact path.

## 8. Privacy And Legal Notes

The public privacy policy should clearly describe:

- What personal data is collected.
- Why it is collected.
- Legal basis or consent basis.
- Retention period.
- Third-party processors or service providers.
- User rights and contact channel.
- Whether submitted data is used for AI generation, model training, or only review.
- Whether optional marketing/public promotion is separate from mandatory application review.

Korean privacy authority materials emphasize clear privacy policy items, legal basis,
retention periods, and user rights. Generative AI services should avoid vague privacy
descriptions and should provide acceptable-use boundaries and reporting routes.

References:

- 개인정보보호위원회, 개인정보 처리방침 작성/평가 guidance and notices.
- 개인정보보호위원회, 생성형 AI 분야 개인정보 처리방침 discussion and improvement guidance.
- 개인정보보호위원회/KISA AI 개인정보보호 self-checklist materials.

## 9. Backend Current State

Implemented:

```http
GET /api/v1/debut/policy
POST /api/v1/debut/applications
GET /api/v1/me/debut-applications
GET /api/v1/me/debut-applications/latest
POST /api/v1/me/debut-applications/:applicationId/withdraw
GET /admin/api/v1/debut/applications?status=submitted&take=50
GET /admin/api/v1/debut/applications/:applicationId
```

The admin debut endpoints above are read-only in the first operations contract.
For deployed host-root calls, use the current external route shape:

```http
GET /api/v1/admin/api/v1/debut/applications?status=submitted&take=50
GET /api/v1/admin/api/v1/debut/applications/:applicationId
```

If the client base/helper already includes `/api/v1`, use the relative
`/admin/api/v1/debut/...` path. Status mutation remains a future contract and is
not open here.

Current table:

- `debut_applications`
- Includes applicant/contact fields, participation type, requested/approved share,
  required consents, review note, metadata, timestamps, and user relation.
- `debut_application_attachments`
- Links confirmed private applicant-material assets to applications with
  `applicationId`, `assetId`, `category`, `sortOrder`, `status`, metadata, and
  timestamps.

Current limitations:

- No secure upload process for identity/contract files.
- No contract version table.
- No settlement table.
- No structured review checklist table.
- No public launch conversion from approved application to artist.

Policy endpoint:

- `GET /api/v1/debut/policy` returns non-personal static policy hints for the frontend form.
- It includes application channels, participation types, draft share ranges, status labels, consent keys, field limits, material submission policy, and data collection restrictions.
- `online_review` is backed by the private applicant-material upload flow. It
  must not use the public feed/profile image upload flow.
- `policyVersion` is a product/version hint, not a final legal contract version.

Private applicant material upload:

```http
POST /api/v1/debut/application-materials/upload-intents
POST /api/v1/debut/application-materials/:assetId/confirm-upload
```

- Both endpoints require an authenticated user.
- Upload intents create private `assets` scoped to `debut_application_material`.
  API responses do not expose public or signed read URLs.
- Supported categories are `face_photo`, `body_motion_reference`,
  `voice_sample`, `dance_video_reference`, and `portfolio_attachment`.
- Confirm upload verifies the owned private material object before it can be
  linked to a debut application.
- `POST /api/v1/debut/applications` accepts confirmed asset id arrays:
  `facePhotoAssetIds`, `bodyMotionReferenceAssetIds`, `voiceSampleAssetIds`,
  `danceVideoReferenceAssetIds`, and `portfolioAttachmentAssetIds`.
- The application body stores asset ids and the server relation only. Do not
  store signed URLs, upload target URLs, tokens, or credentials in application
  metadata, docs, logs, Notion, or PR text.
- `portfolioUrls[]` remains HTTPS metadata only and strips URL fragments before
  storage.
- `genderSwapRequested` must be absent or `false`; the backend rejects `true`.
- `shareTierRequested` remains the applicant-facing estimate/request.
  `shareTierApproved` remains the later admin final value; no automatic final
  share rate is produced by applicant submission.

Phone-consultation operations:

- Admin list can filter `applicationChannel=phone_consultation` and `consultationStatus=pending|scheduled|contacted|no_answer|completed`.
- Admin detail is available at `GET /admin/api/v1/debut/applications/:applicationId`.
- Admin list/detail responses expose masked contact fields and private applicant
  material metadata only. They must not expose signed read URLs, original file
  URLs, storage keys, object ETags, secrets, or tokens.
- Admin status/consultation mutation is not open in this contract.
- These fields stay in metadata during MVP so operations can learn the real workflow before schema hardening.

## 10. Backend Follow-Up

Recommended next implementation tasks:

1. Add dedicated `termsVersion`, `privacyVersion`, `revenuePolicyVersion`, and `appearanceConsentVersion` columns.
2. Add admin structured review fields or a separate `debut_application_reviews` table.
3. Add structured operator review states for uploaded applicant materials.
4. Keep revenue share non-final. The current `shareTierRequested` maps to the
   applicant/requested estimate, and `shareTierApproved` maps to the admin final
   review value. If frontend copy needs clearer names, expose read aliases such
   as `estimatedShareRate` and `finalShareRate` without auto-approving the final
   rate.
5. Add contract/settlement tables only after final legal and payment policy decisions.

Applicant withdrawal:

- Applicants can withdraw their own applications while status is `submitted`, `reviewing`, or `needs_more_info`.
- Withdrawal changes status to `withdrawn` and records `withdrawnBy` / `withdrawnAt` in metadata.
- Final statuses such as `approved` and `rejected` need operator/legal handling rather than self-service withdrawal.

## 11. Frontend Form Sections

Recommended first screen:

- Debut type selection.
- Applicant story and desired stage identity.
- Contact information.
- Preferred call time for phone consultation.
- Contribution/material type checklist.
- Requested share tier with explanation that final share is reviewed.
- Required consent checkboxes.
- Optional consent checkboxes.
- Submission complete screen with review status.

Do not ask for:

- ID card image.
- Bank account.
- Resident registration number.
- Raw contract upload.
- File upload in the MVP phone-consultation path.
- Secrets or API keys.

## 12. Open Decisions For Human

- Will Lumina Stage accept minors later with guardian consent, or adult-only permanently?
- Is the public AI artist legally a derivative persona of the applicant or a Lumina-owned character inspired by submitted material?
- Which revenue categories count for share: gifts, boosts, premium videos, chat, ads, sponsorships?
- What is the minimum payout and settlement cycle?
- Can applicants withdraw after launch? If so, what remains public?
- Will voice/song be cloned, transformed, or only used as reference?
- Will submitted materials be used for training/fine-tuning, or only for generation/reference?
