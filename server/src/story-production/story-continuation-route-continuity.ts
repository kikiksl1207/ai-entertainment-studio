import { Prisma } from '@prisma/client';
import { localizedContinuationText } from './story-continuation-context.policy';

export const STORY_CONTINUATION_ROUTE_VIEW_VERSION = 'story-route-continuity-v1';
const MAX_ROUTE_STEPS = 512;
const MAX_ACTION_BYTES = 3_600;
const MAX_EVIDENCE_BYTES = 1_800;
const MAX_EVIDENCE_SCENES = 16;

export type StoryContinuationRouteContinuity = {
  version: typeof STORY_CONTINUATION_ROUTE_VIEW_VERSION;
  actions: Array<{ step: number; choiceLabel: string }>;
  readEvidence: Array<{ step: number; text: string }>;
};

type RouteRow = { narrative_step: Prisma.JsonValue; depth: number };
type RouteStep = { sourceSceneId?: string; sceneId?: string; sourceGeneratedSceneId?: string;
  choiceId?: string; customChoiceId?: string; generatedSceneId?: string; readBeatPosition?: number };

export async function assembleContinuationRouteContinuity(prisma: any, input: {
  routeNodeId: string | null | undefined;
  progressId: string;
  workId: string;
  releaseId: string;
  userId: string;
  locale: string;
  pathSummary: Prisma.JsonValue;
}): Promise<StoryContinuationRouteContinuity> {
  const empty: StoryContinuationRouteContinuity = {
    version: STORY_CONTINUATION_ROUTE_VIEW_VERSION, actions: [], readEvidence: [],
  };
  if (!input.routeNodeId) return empty;
  const rows = await prisma.$queryRaw`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id, depth, narrative_step, 1 AS distance
      FROM story_progress_route_nodes
      WHERE id=${input.routeNodeId}::uuid AND progress_id=${input.progressId}::uuid
        AND work_id=${input.workId}::uuid AND release_id=${input.releaseId}::uuid
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.depth, parent.narrative_step, child.distance + 1
      FROM story_progress_route_nodes parent JOIN ancestry child ON parent.id=child.parent_id
      WHERE child.distance < ${MAX_ROUTE_STEPS} AND parent.progress_id=${input.progressId}::uuid
        AND parent.work_id=${input.workId}::uuid AND parent.release_id=${input.releaseId}::uuid
    )
    SELECT depth, narrative_step FROM ancestry WHERE narrative_step IS NOT NULL ORDER BY depth ASC` as RouteRow[];
  const steps = rows.map((row) => ({ depth: row.depth, ...routeStep(row.narrative_step) }));
  const canonicalIds = steps.flatMap((step) => !step.sourceGeneratedSceneId && step.choiceId ? [step.choiceId] : []);
  const customIds = steps.flatMap((step) => step.customChoiceId ? [step.customChoiceId] : []);
  const generatedIds = steps.flatMap((step) => step.sourceGeneratedSceneId && step.choiceId ? [step.choiceId] : []);
  const generatedSceneIds = steps.flatMap((step) => step.sourceGeneratedSceneId ? [step.sourceGeneratedSceneId] : []);
  const canonicalSceneIds = steps.flatMap((step) => !step.sourceGeneratedSceneId
    ? [step.sourceSceneId ?? step.sceneId].filter((id): id is string => Boolean(id)) : []);
  const [canonicalChoices, customChoices, generatedChoices, canonicalScenes, generatedScenes] = await Promise.all([
    canonicalIds.length ? prisma.storyChoice.findMany({ where: { id: { in: canonicalIds } },
      select: { id: true, sceneId: true, label: true } }) : [],
    customIds.length ? prisma.storyCustomChoice.findMany({ where: {
      id: { in: customIds }, progressId: input.progressId, userId: input.userId,
      workId: input.workId, status: 'completed', moderationDecision: 'allow',
    }, select: { id: true, sceneId: true, privateInput: true } }) : [],
    generatedIds.length ? prisma.storyAiGeneratedChoice.findMany({ where: { id: { in: generatedIds } },
      select: { id: true, sceneId: true, label: true } }) : [],
    canonicalSceneIds.length ? prisma.storyScene.findMany({ where: {
      id: { in: canonicalSceneIds }, status: 'published', fixtureSource: false,
    }, select: { id: true, title: true } }) : [],
    generatedSceneIds.length ? prisma.storyAiGeneratedScene.findMany({ where: {
      id: { in: generatedSceneIds }, userId: input.userId, workId: input.workId,
      releaseId: input.releaseId, progressId: input.progressId, status: 'ready',
    }, select: { id: true, title: true } }) : [],
  ]);
  const canonicalChoiceById = new Map<string, { sceneId: string; label: Prisma.JsonValue }>(
    canonicalChoices.map((row: any) => [row.id, row]));
  const customChoiceById = new Map<string, { sceneId: string; privateInput: string }>(
    customChoices.map((row: any) => [row.id, row]));
  const generatedChoiceById = new Map<string, { sceneId: string; label: Prisma.JsonValue }>(
    generatedChoices.map((row: any) => [row.id, row]));
  const canonicalSceneById = new Map<string, { title: Prisma.JsonValue }>(
    canonicalScenes.map((row: any) => [row.id, row]));
  const generatedSceneById = new Map<string, { title: Prisma.JsonValue }>(
    generatedScenes.map((row: any) => [row.id, row]));
  const actions: StoryContinuationRouteContinuity['actions'] = [];
  for (const step of steps) {
    const sourceId = step.sourceGeneratedSceneId ?? step.sourceSceneId ?? step.sceneId;
    // Older private-input routes stored neither choice ID nor its text. They can
    // continue, but there is no evidence from which to reconstruct that action.
    if (!step.choiceId && !step.customChoiceId && step.generatedSceneId) continue;
    const choice = step.sourceGeneratedSceneId
      ? generatedChoiceById.get(step.choiceId ?? '') : canonicalChoiceById.get(step.choiceId ?? '');
    const customChoice = step.customChoiceId ? customChoiceById.get(step.customChoiceId) : null;
    const scene = step.sourceGeneratedSceneId
      ? generatedSceneById.get(sourceId ?? '') : canonicalSceneById.get(sourceId ?? '');
    if (!sourceId || !scene || (!choice && !customChoice) ||
      (choice && choice.sceneId !== sourceId) || (customChoice && customChoice.sceneId !== sourceId)) {
      throw new Error('route_continuity_invalid');
    }
    const action = {
      step: step.depth,
      choiceLabel: truncateUtf8(customChoice?.privateInput ??
        localizedContinuationText(choice!.label, input.locale), 112),
    };
    if (!action.choiceLabel) throw new Error('route_continuity_invalid');
    actions.push(action);
  }
  while (Buffer.byteLength(JSON.stringify(actions), 'utf8') > MAX_ACTION_BYTES && actions.length > 2) {
    actions.splice(Math.floor(actions.length / 2), 1);
  }
  const recentPath = Array.isArray(input.pathSummary) ? input.pathSummary : [];
  const readSteps = steps.flatMap((step) => {
    if (!step.sourceGeneratedSceneId) return [];
    const matched = recentPath.find((item) => item && typeof item === 'object' && !Array.isArray(item) &&
      item.sourceGeneratedSceneId === step.sourceGeneratedSceneId && item.choiceId === step.choiceId &&
      item.generatedSceneId === step.generatedSceneId) as Record<string, unknown> | undefined;
    const readPosition = step.readBeatPosition ?? matched?.readBeatPosition;
    return Number.isInteger(readPosition) && Number(readPosition) > 0 && Number(readPosition) <= 40
      ? [{ step: step.depth, sceneId: step.sourceGeneratedSceneId, readPosition: Number(readPosition) }] : [];
  });
  const selected = readSteps.length <= MAX_EVIDENCE_SCENES ? readSteps : [
    ...readSteps.slice(0, 4),
    ...[1, 2, 3, 4].map((part) => readSteps[4 + Math.floor(part * (readSteps.length - 12) / 5)]),
    ...readSteps.slice(-8),
  ];
  const beats = selected.length ? await prisma.storyAiGeneratedBeat.findMany({
    where: { sceneId: { in: selected.map((step) => step.sceneId) } },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { sceneId: true, position: true, content: true },
    take: MAX_EVIDENCE_SCENES * 40,
  }) : [];
  const readEvidence: StoryContinuationRouteContinuity['readEvidence'] = [];
  let evidenceBytes = 0;
  const evidencePriority = selected.length <= 1 ? selected : [
    selected.at(-1)!, selected[0], ...selected.slice(1, -1).reverse(),
  ];
  for (const step of evidencePriority) {
    const readBeats = beats.filter((row: any) => row.sceneId === step.sceneId && row.position <= step.readPosition);
    if (!readBeats.length) continue;
    const first = truncateUtf8(localizedContinuationText(readBeats[0].content, input.locale), 105);
    const last = readBeats.at(-1) === readBeats[0] ? ''
      : truncateUtf8(localizedContinuationText(readBeats.at(-1)!.content, input.locale), 105);
    const evidence = { step: step.step, text: last ? `${first} / ${last}` : first };
    if (!evidence.text) continue;
    const bytes = Buffer.byteLength(JSON.stringify(evidence), 'utf8');
    if (evidenceBytes + bytes > MAX_EVIDENCE_BYTES) continue;
    readEvidence.push(evidence);
    evidenceBytes += bytes;
  }
  readEvidence.sort((left, right) => left.step - right.step);
  return { version: STORY_CONTINUATION_ROUTE_VIEW_VERSION, actions, readEvidence };
}

function routeStep(value: Prisma.JsonValue): RouteStep {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('route_continuity_invalid');
  return value as RouteStep;
}

function truncateUtf8(value: string, bytes: number) {
  let result = '';
  for (const character of value.trim()) {
    if (Buffer.byteLength(result + character, 'utf8') > bytes) break;
    result += character;
  }
  return result.trim();
}
