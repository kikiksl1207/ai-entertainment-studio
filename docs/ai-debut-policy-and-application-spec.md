# Lumina Stage AI Debut Application Policy And Data Spec

Status: Draft for product, backend, and operations planning.
Owner: Chamo / Codex A.
Last updated: 2026-05-02.

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
- `displayName`: optional public stage/name idea.
- `contactEmail`: contact email.
- `contactPhone`: optional phone number.
- `isAdult`: must be true for MVP. Minor applications are not accepted until a guardian flow exists.
- `participationType`: one of `appearance_only`, `voice_or_song`, `performance`, `co_creator`.
- `shareTierRequested`: applicant requested share percentage, integer 0-70.
- `intro`: motivation, story, concept, and expected contribution.
- `portfolioUrl`: optional portfolio or social link.
- `consentAppearance`: required true.
- `consentVoice`: true only when voice/song/performance material is submitted.
- `consentRevenuePolicy`: required true.
- `consentPrivacy`: required true.
- `metadata`: structured extension object for non-sensitive detail.

### Recommended Metadata Fields

Keep these inside `metadata` until the DB is expanded:

```json
{
  "stageConcept": "Desired artist mood and positioning",
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

Do not collect resident registration numbers, raw ID images, bank account details,
or final contract files in Notion, chat, or Git. Those require a later secure upload
and contract process.

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
POST /api/v1/debut/applications
GET /api/v1/me/debut-applications
GET /api/v1/me/debut-applications/latest
POST /api/v1/me/debut-applications/:applicationId/withdraw
GET /admin/api/v1/debut/applications?status=submitted&take=50
PATCH /admin/api/v1/debut/applications/:applicationId
```

Current table:

- `debut_applications`
- Includes applicant/contact fields, participation type, requested/approved share,
  required consents, review note, metadata, timestamps, and user relation.

Current limitations:

- No secure upload process for identity/contract files.
- No contract version table.
- No settlement table.
- No structured review checklist table.
- No public launch conversion from approved application to artist.

## 10. Backend Follow-Up

Recommended next implementation tasks:

1. Add a public policy version endpoint for frontend checkbox versioning.
2. Add `termsVersion`, `privacyVersion`, `revenuePolicyVersion`, and `appearanceConsentVersion`.
3. Add admin structured review fields or a separate `debut_application_reviews` table.
4. Add secure upload intent flow for applicant materials, reusing the asset/upload architecture.
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
- Secrets or API keys.

## 12. Open Decisions For Human

- Will Lumina Stage accept minors later with guardian consent, or adult-only permanently?
- Is the public AI artist legally a derivative persona of the applicant or a Lumina-owned character inspired by submitted material?
- Which revenue categories count for share: gifts, boosts, premium videos, chat, ads, sponsorships?
- What is the minimum payout and settlement cycle?
- Can applicants withdraw after launch? If so, what remains public?
- Will voice/song be cloned, transformed, or only used as reference?
- Will submitted materials be used for training/fine-tuning, or only for generation/reference?
