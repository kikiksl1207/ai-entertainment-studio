import { readFileSync } from 'fs';
import { authoredHash } from './story-authored-source-map.policy';
import { prepareManuscript } from './story-manuscript-file.policy';
import type { authoredImportFixture } from './story-authored-import.test-fixture';

export function readActualAuthoredImportFixture(): ReturnType<typeof authoredImportFixture> {
  const mapPath = process.env.AUTHORED_SOURCE_MAP_PATH;
  const analysisPath = process.env.AUTHORED_ANALYSIS_INPUT_PATH;
  if (!mapPath || !analysisPath || !/^E:[\\/]/i.test(mapPath) || !/^E:[\\/]/i.test(analysisPath)) {
    throw new Error('Explicit read-only E-drive authored source fixtures required');
  }
  const buffer = readFileSync(mapPath);
  const analysis = readFileSync(analysisPath);
  if (authoredHash(analysis) !== '74462e693982cbb72733b3db465e435c008309dbcb76c603b908ed1369cb37f8') {
    throw new Error('Actual analysis artifact differs from the independently pinned source');
  }
  const root = JSON.parse(buffer.toString('utf8'));
  const finalA = root.parts.at(-1).choices[0];
  const evidence = root.endingEvidence.find((item: any) => item.part === root.parts.length &&
    finalA.evidenceSegments.includes(item.source.segment) && item.provenanceClaims.includes('author_default'));
  if (!evidence) throw new Error('Final authored A source claim required, not an approval');
  return { root, buffer, manuscript: prepareManuscript(analysis),
    ending: { endingKey: 'author_main', evidenceSegment: evidence.source.segment } };
}
