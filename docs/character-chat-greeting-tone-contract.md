# Character Chat Greeting and Tone Contract

Task: #381, #402

Status: read-only contract ready.

## Scope

Character chat entry surfaces must not make every character look or sound the
same. The backend exposes character-specific greeting, opening prompt, tone
tags, and forbidden-tone guidance as read-only response fields.

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

`POST /api/v1/chat/sessions` also snapshots the display-safe tone candidate
used by the dynamic opening greeting as `openingGreeting.toneCandidate`. That
snapshot contains public tone guide/tags and persona tags only. It must not
store raw persona prompts, provider payloads, tokens, keys, or user private
data.

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
