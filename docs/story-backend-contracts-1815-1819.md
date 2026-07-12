# Story Backend Contracts (#1815-#1819)

This source-only bundle adds deterministic, read-only contracts for the next
story authoring and playback QA cycle.

## Contract Map

- #1815: server-owned scene visual manifest projection and route validation.
- #1816: synthetic manuscript graph import validation with warning and publish
  blocker separation.
- #1817: timeline and progress pacing projection with explicit early-ending
  conditions.
- #1818: author and AI ending provenance, public label keys, and completion
  signatures.
- #1819: five-locale payload normalization and safe fallback projection.

## Safety Boundary

- No provider, upload, import, publish, story progress, or payment mutation is
  enabled.
- Tests use synthetic keys, counts, and status values. They do not contain a
  real manuscript, account data, or credential material.
- Public projections use public asset paths and locale keys only. Private
  storage locations and internal identifiers are excluded.
