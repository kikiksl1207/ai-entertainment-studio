import type { StoryLocale } from './story-production.policy';

export const AUTHORED_INITIAL_IMPORT_CONTRACT = 'story-authored-initial-import-v1';

export const AUTHORED_INITIAL_IMPORT_LIMITS = {
  sourceMapFileBytes: 16 * 1024 * 1024,
  parts: 1000,
  beatsPerPart: 40,
  beatTextUnits: 7500,
  suggestedChoices: 3,
} as const;

// Internal preparation types, not an HTTP acceptance or approval contract.
// Source-map verification must precede construction of a materialization plan.
export type AuthoredImportBinding = {
  workId: string;
  expectedWorkRevision: number;
  manuscriptVersionId: string;
  manuscriptContentHash: string;
  releaseId: string;
  releaseChecksum: string;
  declaredPackageSha256: string;
  submittedInventorySha256: string;
  analysisPayloadSha256: string;
};

export type AuthoredSceneText = {
  sourceSceneKey: string;
  text: string;
};

export type AuthoredPackedBeat = {
  position: number;
  sourceSceneKey: string;
  text: string;
  // Offsets address the verified public scene projection, not the raw manuscript.
  sceneTextStart: number;
  sceneTextEnd: number;
};

export type AuthoredScenePacking = {
  beats: AuthoredPackedBeat[];
  scenes: Array<{
    sourceSceneKey: string;
    textSha256: string;
    textBytes: number;
    firstBeatPosition: number;
    beatCount: number;
  }>;
};

export type AuthoredInitialChoice = {
  choiceKey: string;
  label: string;
  readerOrdinal: 1;
  routeKind: 'writer_original';
  destination:
    | { kind: 'part'; partKey: string }
    | { kind: 'ending'; endingKey: string; provenance: 'author_main' | 'author_sub' };
} | {
  choiceKey: string;
  label: string;
  readerOrdinal: 2 | 3;
  routeKind: 'generation_required';
  destination: null;
};

export type AuthoredInitialPart = {
  partKey: string;
  position: number;
  actNumber: number;
  title: string;
  sourceSha256: string;
  sourceBytes: number;
  packing: AuthoredScenePacking;
  choices: [AuthoredInitialChoice, AuthoredInitialChoice, AuthoredInitialChoice];
};

export type AuthoredInitialPlan = {
  contract: typeof AUTHORED_INITIAL_IMPORT_CONTRACT;
  binding: AuthoredImportBinding;
  locale: StoryLocale;
  parts: AuthoredInitialPart[];
  planChecksum: string;
};
