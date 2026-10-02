import { ConflictException } from '@nestjs/common';

export type PublicationPlanStoragePlan = {
  parts: readonly {
    partKey: string;
    title: string;
    actNumber: number;
    position: number;
    beats: readonly { text: string; sourceSceneKey: string }[];
    choices: readonly {
      choiceKey: string;
      label: string;
      position: number;
      routeKind: string;
      targetPartKey: string | null;
      targetEndingKey: string | null;
    }[];
  }[];
};

export type PublicationPlanStoredRows = {
  parts: readonly { id: string; position: number; actNumber: number; title: unknown }[];
  scenes: readonly { id: string; partId: string; sceneKey: string; position: number }[];
  beats: readonly {
    id?: string;
    sceneId: string;
    position: number;
    content: unknown;
    sourceSceneKey: string | null;
  }[];
  choices: readonly {
    id?: string;
    sceneId: string;
    choiceKey: string;
    position: number;
    label: unknown;
    routeKind: string;
    targetSceneId: string | null;
    targetEndingKey: string | null;
    declaredRejoinSceneId: string | null;
  }[];
};

function mismatch(): never {
  throw new ConflictException({
    code: 'STORY_PUBLICATION_STORED_PLAN_MISMATCH',
    message: 'Stored publication content does not match the approved plan',
  });
}

function korean(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).ko : undefined;
}

function positivePosition(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function nonempty(value: string): boolean {
  return typeof value === 'string' && Boolean(value.trim());
}

function rowsByScene<T extends { sceneId: string; position: number }>(
  rows: readonly T[],
  sceneIds: ReadonlySet<string>,
): Map<string, Map<number, T>> {
  const grouped = new Map<string, Map<number, T>>();
  for (const row of rows) {
    if (!sceneIds.has(row.sceneId) || !positivePosition(row.position)) mismatch();
    const positions = grouped.get(row.sceneId) ?? new Map<number, T>();
    if (positions.has(row.position)) mismatch();
    positions.set(row.position, row);
    grouped.set(row.sceneId, positions);
  }
  return grouped;
}

export function comparePublicationPlanStorage(
  plan: PublicationPlanStoragePlan,
  stored: PublicationPlanStoredRows,
  targetSceneByPartKey?: ReadonlyMap<string, string>,
): void {
  if (!plan.parts.length || stored.parts.length !== plan.parts.length ||
      stored.scenes.length !== plan.parts.length) mismatch();

  const partsByPosition = new Map<number, (typeof stored.parts)[number]>();
  const partIds = new Set<string>();
  for (const part of stored.parts) {
    if (!nonempty(part.id) || partIds.has(part.id) || !positivePosition(part.position) ||
        partsByPosition.has(part.position)) mismatch();
    partIds.add(part.id);
    partsByPosition.set(part.position, part);
  }
  const scenesByPartId = new Map<string, (typeof stored.scenes)[number]>();
  const sceneIds = new Set<string>();
  for (const scene of stored.scenes) {
    if (!partIds.has(scene.partId) || !nonempty(scene.id) || sceneIds.has(scene.id) ||
        scenesByPartId.has(scene.partId) || scene.position !== 1) mismatch();
    sceneIds.add(scene.id);
    scenesByPartId.set(scene.partId, scene);
  }

  const sceneByPlannedPartKey = new Map<string, string>();
  let previousPosition = 0;
  for (const part of plan.parts) {
    if (!nonempty(part.partKey) || sceneByPlannedPartKey.has(part.partKey) ||
        !positivePosition(part.position) || part.position <= previousPosition ||
        !nonempty(part.title) || !part.beats.length || !part.choices.length) mismatch();
    previousPosition = part.position;
    const persistedPart = partsByPosition.get(part.position);
    const scene = persistedPart && scenesByPartId.get(persistedPart.id);
    if (!persistedPart || !scene || persistedPart.actNumber !== part.actNumber ||
        korean(persistedPart.title) !== part.title || scene.sceneKey !== `${part.partKey}-main`) mismatch();
    if (targetSceneByPartKey && targetSceneByPartKey.get(part.partKey) !== scene.id) mismatch();
    sceneByPlannedPartKey.set(part.partKey, scene.id);
  }

  // Only this batch's content is supplied; destinations may belong to another batch.
  const routing = targetSceneByPartKey ?? sceneByPlannedPartKey;
  const beatsByScene = rowsByScene(stored.beats, sceneIds);
  const choicesByScene = rowsByScene(stored.choices, sceneIds);
  for (const part of plan.parts) {
    const sceneId = sceneByPlannedPartKey.get(part.partKey)!;
    const beats = beatsByScene.get(sceneId);
    const choices = choicesByScene.get(sceneId);
    if (beats?.size !== part.beats.length || choices?.size !== part.choices.length) mismatch();
    for (const [index, beat] of part.beats.entries()) {
      const persisted = beats.get(index + 1);
      if (!persisted || !nonempty(beat.text) || !nonempty(beat.sourceSceneKey) ||
          korean(persisted.content) !== beat.text || persisted.sourceSceneKey !== beat.sourceSceneKey) mismatch();
    }
    const choiceKeys = new Set<string>();
    for (const [index, choice] of part.choices.entries()) {
      if (choice.position !== index + 1 || !nonempty(choice.choiceKey) ||
          choiceKeys.has(choice.choiceKey) || !nonempty(choice.label)) mismatch();
      choiceKeys.add(choice.choiceKey);
      if (choice.routeKind === 'writer_original') {
        if (index !== 0 || (choice.targetPartKey === null) === (choice.targetEndingKey === null) ||
            (choice.targetPartKey !== null && !nonempty(choice.targetPartKey)) ||
            (choice.targetEndingKey !== null && !nonempty(choice.targetEndingKey))) mismatch();
      } else if (index === 0 || choice.targetPartKey !== null || choice.targetEndingKey !== null) {
        mismatch();
      }
      const targetSceneId = choice.targetPartKey === null ? null : routing.get(choice.targetPartKey);
      if (choice.targetPartKey !== null && (!targetSceneId || !nonempty(targetSceneId))) mismatch();
      const persisted = choices.get(choice.position);
      if (!persisted || persisted.choiceKey !== choice.choiceKey || korean(persisted.label) !== choice.label ||
          persisted.routeKind !== choice.routeKind || persisted.targetSceneId !== targetSceneId ||
          persisted.targetEndingKey !== choice.targetEndingKey || persisted.declaredRejoinSceneId !== null) mismatch();
    }
  }
}
