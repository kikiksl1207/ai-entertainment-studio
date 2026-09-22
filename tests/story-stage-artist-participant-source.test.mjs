import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/story-stage.css', import.meta.url), 'utf8');
const controller = await readFile(new URL('../server/src/story-production/story-production.controller.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../server/src/story-production/story-artist-participant.service.ts', import.meta.url), 'utf8');
const schema = await readFile(new URL('../server/prisma/schema.prisma', import.meta.url), 'utf8');

test('story participant picker supports engagement defaults, global search and exact start binding', () => {
  assert.match(page, /artist-candidates\?take=20/);
  assert.match(page, /artist-candidates\?q=\$\{encodeURIComponent\(query\)\}/);
  assert.match(page, /participantArtistId: state\.selectedParticipantArtistId/);
  assert.match(page, /data-story-artist-id/);
  assert.match(page, /data-story-artist-search-form/);
  assert.match(controller, /me\/stories\/:workId\/artist-candidates/);
  assert.match(service, /artistBoostEvent\.findMany/);
  assert.match(service, /conceptVoteBallot\.findMany/);
  assert.match(service, /status: 'active'/);
  assert.match(service, /STORY_PARTICIPANT_LOCKED/);
});

test('story participant identity is pinned for prose and visual continuity', () => {
  assert.match(schema, /model StoryProgressArtistParticipant/);
  assert.match(schema, /identityApprovedFingerprint/);
  assert.match(schema, /referenceChecksums/);
  assert.match(service, /participantFingerprint/);
  assert.match(service, /creatorGenerationProfileFingerprint/);
  assert.match(service, /STORY_PARTICIPANT_IDENTITY_CHANGED/);
});

test('participant UI has five-locale copy and a mobile single-column layout', () => {
  assert.equal((page.match(/participantTitle:/g) || []).length, 5);
  assert.equal((page.match(/participantSearchPlaceholder:/g) || []).length, 5);
  assert.match(css, /\.story-participant-list\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.story-participant-list\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});
