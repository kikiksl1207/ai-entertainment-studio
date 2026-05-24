# Character Chat Greeting and Tone Contract

Task: #381, #402, #454

Status: read-only contract ready.

## Scope

Character chat entry surfaces must not make every character look or sound the
same. The backend exposes character-specific greeting, opening prompt, tone
tags, recommended reply candidates, and forbidden-tone guidance as read-only
response fields.

Canonical endpoints:

```http
GET /api/v1/chat/character-catalog?artistSlug=<artistSlug>
GET /api/v1/chat/starter-prompts?artistSlug=<artistSlug>
```

## Response Contract

Both endpoints expose:

- `greeting`: first welcome copy for the requested character
- `openingPrompt`: first-screen guide text, suggested prompt options, and direct
  input label
- `openingPrompt.options[]`: the canonical recommended reply candidates for the
  first DM screen
- `tone`: public tone summary with Korean guide copy and tone tags
- `personaTags`: display-safe character persona tags
- `forbiddenTone`: display-safe blocked tone/expression list
- `greetingToneContract`: contract version and safety flags
- `copyContract`: CMS/fallback source contract

`greetingToneContract.version` is
`2026-05-21.character-chat-greeting-tone.v1`.

## Source Order

The fallback order stays:

1. published site-content copy
2. artist metadata
3. character fallback
4. default Korean copy

Frontend/QA should use `copyContract.characterSlug`,
`copyContract.contentKey`, and `greetingToneContract.characterSlug` to verify
that one character's copy is not reused for another character.

## Required UI Fields

The read-only response guarantees these character-specific fields:

- `greeting.text`
- `openingPrompt.guideText`
- `openingPrompt.options[].label`
- `openingPrompt.options[].message`
- `tone.guideKo`
- `tone.toneTags`
- `personaTags`
- `forbiddenTone.items`

At least two characters must be able to return different values for greeting,
opening prompt guide/options, tone guide/tags, and forbidden tone.

## Recommended Reply Candidate Contract (#454)

No new mutation is opened for recommended replies. The existing read-only fields
are the contract:

- `GET /api/v1/chat/character-catalog` exposes candidates as
  `openingPrompt.options[]` and `starterOptions[]`.
- `GET /api/v1/chat/starter-prompts` exposes the same candidates as
  `sets[].options[]`.
- The response must expose 1 to 3 visible candidates when character copy exists.
  The current default may expose two candidates plus the direct-input path.
- Each candidate must include display-safe Korean `label` and `message` values.
  The UI must not show raw keys, source enums, trait ids, prompt ids, provider
  states, or English fallback labels as copy.
- Selecting a candidate is a client-side input convenience only. It does not
  create a chat message, create an order, debit Lumina, call the provider, or
  touch settlement by itself.
- Candidate source order follows the same copy order as greetings:
  published site-content copy, artist metadata, character fallback, default
  safe Korean copy.
- The same fallback candidate set must not be shared across all characters.
  If CMS/metadata is missing, the character fallback must still provide
  character-specific labels and messages.

`POST /api/v1/chat/sessions` also snapshots the display-safe tone candidate
used by the dynamic opening greeting as `openingGreeting.toneCandidate`. That
snapshot contains public tone guide/tags and persona tags only. It must not
store raw persona prompts, provider payloads, tokens, keys, or user private
data.

## Clean Mode And Tone Guardrails (#454)

Character-specific copy can be warm or playful, but it must stay display-safe:

- No adult, sexual, coercive, dangerous, self-harm, or real-person
  impersonation wording.
- No external contact, payment, private meeting, or off-platform migration
  prompts.
- No excessive intimacy such as possession, dependency, romantic pressure, or
  language that implies a real private relationship.
- Minor/clean-mode surfaces should prefer neutral support, daily check-in, and
  hobby/performance topics.
- `forbiddenTone.items` is the public operator/UI hint for blocked tone. It is
  not a raw prompt and must not be rendered as hidden system instruction text.

## Safety

This contract does not:

- call an LLM provider
- create chat messages
- create feature orders
- debit wallet/Lumina
- touch settlement or payout
- expose raw persona prompt secrets
- expose provider payloads, model names, tokens, keys, or raw prompt internals

`forbiddenTone.items` are display-safe policy hints for UI/operator preview.
They are not raw provider instructions and must not be treated as editable
system prompts.
