import { createHash } from 'crypto';
import { normalizeCreatorGenerationProfile, STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';
import { approvedStoryVisualSettings, assertStoryVisualSettings, publicationVisualReference, storyVisualCharacters,
  storyVisualDirection, studioSceneVisualPrompt } from './story-approved-visual.policy';
import { buildStoryVisualBible } from './story-visual-bible';
import { releaseChecksum } from './story-lifecycle.policy';

const direction = { era: 'A historical Korean port', artStyle: 'Painted ink illustration', palette: 'Muted green and red', prohibited: ['neon signage'] };
const characters = [{ name: 'Haewon', appearance: 'Adult woman, shoulder-length black hair, green coat' }];
function settings() {
  return normalizeCreatorGenerationProfile('story', { schemaVersion: 'creator-generation-profile-v1', kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted', evidence: [],
      value: { summary: `${key} notes`, ...(key === 'visual_direction' ? { visualBible: direction }
        : key === 'visual_cast' ? { characters } : {}) } })) });
}
function source() {
  const promptText = 'An original scene instruction, not approved for reuse yet.';
  const reference = { contract: 'publication-visual-source-v1', approvalState: 'reference_only', sourceBindingSha256: 'a'.repeat(64),
    visualBible: { ...direction, characters }, prompts: [{ sourceSceneKey: 'part-1-scene-1', promptText,
      promptSha256: createHash('sha256').update(promptText).digest('hex') }] };
  return { publicationVisualSource: { ...reference, checksum: releaseChecksum(reference) } };
}

describe('author-reviewed story visual settings', () => {
  it('validates exact retained reference checksums without upgrading them to approval', () => {
    expect(publicationVisualReference({})).toBeNull();
    const body = source();
    expect(publicationVisualReference(body)).toMatchObject({ bible: { ...direction, characters }, promptCount: 1 });
    body.publicationVisualSource.visualBible.era = 'changed';
    expect(() => publicationVisualReference(body)).toThrow();
    const changed = source(); changed.publicationVisualSource.prompts[0].promptText += 'tampered';
    const { checksum: _checksum, ...reference } = changed.publicationVisualSource;
    changed.publicationVisualSource.checksum = releaseChecksum(reference);
    expect(() => publicationVisualReference(changed)).toThrow();
  });
  it.each([null, {}, [{ name: '', appearance: 'x' }], [{ name: 'x', appearance: '' }],
    [{ name: 'x', appearance: 'a\0' }], [{ name: 'x', appearance: 'a' }, { name: 'x', appearance: 'b' }],
    Array.from({ length: 17 }, (_, i) => ({ name: String(i), appearance: 'x' })), [{ name: 'x', appearance: 'x'.repeat(601) }]])
  ('does not truncate or infer invalid character settings: %j', value => { expect(() => storyVisualCharacters(value)).toThrow(); });
  it.each([{ ...direction, era: 'x'.repeat(801) }, { ...direction, prohibited: ['x'.repeat(241)] },
    { ...direction, prohibited: new Array(25).fill('x') }, { ...direction, injected: 'not a reviewed field' }])
  ('rejects unsupported or oversized world settings: %j', value => { expect(() => storyVisualDirection(value)).toThrow(); });
  it('uses only confirmed visual fields and distinguishes exact approval identities', () => {
    const profile = settings();
    const accepted = approvedStoryVisualSettings(profile, { revision: 1 });
    expect(accepted).toMatchObject({ direction, characters, castNotes: 'visual_cast notes' });
    expect(approvedStoryVisualSettings(profile, { revision: 2 }).fingerprint).not.toBe(accepted.fingerprint);
    profile.sections.find(row => row.key === 'visual_cast')!.decision = 'removed';
    expect(approvedStoryVisualSettings(profile, { revision: 3 })).toMatchObject({ characters: [], castNotes: '' });
    profile.sections.find(row => row.key === 'visual_direction')!.decision = 'proposed';
    expect(() => approvedStoryVisualSettings(profile, {})).toThrow();
  });
  it('never resurrects imported or source prompt anchors in reviewed images', () => {
    const profile = settings(); profile.sections.find(row => row.key === 'visual_cast')!.decision = 'removed';
    const approved = approvedStoryVisualSettings(profile, { revision: 1 });
    const result = buildStoryVisualBible({ workTitle: 'Test', workSummary: 'A ledger story',
      sceneAssetManifest: { visualBible: { ...direction, era: 'OLD ERA', characters: [{ name: 'OLD FACE', appearance: 'old face' }] } },
      canonicalPrompts: ['OLD PROMPT FACE AND STYLE'], approvedVisualSettings: approved });
    expect(result.version).toBe('story-visual-bible-reviewed-v1');
    expect(result.approvalFingerprint).toBe(approved.fingerprint);
    expect(result.privatePrompt).toContain(direction.artStyle);
    expect(result.privatePrompt).not.toMatch(/OLD ERA|OLD FACE|OLD PROMPT|Haewon|visual_cast notes/);
  });
  it('preserves every accepted cast anchor and prohibition rather than silently cutting off later entries', () => {
    const profile = settings();
    profile.sections.find(row => row.key === 'visual_cast')!.value.characters = Array.from({ length: 16 }, (_, i) =>
      ({ name: `Actor${i}`, appearance: `actor appearance ${i} ` + 'x'.repeat(500) }));
    const approved = approvedStoryVisualSettings(profile, { revision: 1 });
    const bible = buildStoryVisualBible({ workTitle: 'Test', workSummary: 'Story', canonicalPrompts: [], approvedVisualSettings: approved });
    expect(bible.privatePrompt).toContain('Actor15: actor appearance 15');
    expect(bible.privatePrompt).toContain('neon signage');
    profile.sections.find(row => row.key === 'visual_direction')!.value.summary = '가'.repeat(8000);
    expect(() => assertStoryVisualSettings(profile)).toThrow();
  });
  it('keeps the cover medium and colors when the author has not specified replacements', () => {
    const profile = settings();
    profile.sections.find(row => row.key === 'visual_direction')!.value.visualBible = {
      era: '', artStyle: '', palette: '', prohibited: [],
    };
    const approved = approvedStoryVisualSettings(profile, { revision: 1 });
    const bible = buildStoryVisualBible({ workTitle: 'Test', workSummary: 'Story', canonicalPrompts: [], approvedVisualSettings: approved });
    expect(bible.privatePrompt).toContain('Preserve the approved cover rendering medium');
    expect(bible.privatePrompt).toContain('Preserve the supplied approved cover palette');
    expect(bible.privatePrompt).not.toContain('Use one consistent premium cinematic illustrated-novel style');
  });
  it('bounds the local part image direction and retains its closing consequence without changing prose', () => {
    const prose = 'Beginning. ' + '가'.repeat(9000) + ' The door closed.';
    const result = studioSceneVisualPrompt('The door', prose);
    expect(result).toContain('Beginning.'); expect(result).toContain('The door closed.');
    expect(result).toContain('[Middle omitted]'); expect(result.length).toBeLessThan(6500);
    expect(prose.length).toBeGreaterThan(9000);
  });
});
