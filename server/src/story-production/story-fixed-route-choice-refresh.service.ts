import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  StoryChoicePreparationError,
  StoryChoicePreparationProvider,
  type StoryChoicePreparationInput,
} from './story-choice-preparation.provider';
import { type FixedRouteStoryKey } from './story-fixed-route-markdown.policy';

const BATCH_SIZE = 8;
const CHOICE_POLICY = 'published_fixed_route_ai_choices_v1';
type Client = PrismaService | Prisma.TransactionClient;
type Choice = {
  id: string; sceneId: string; choiceKey: string; position: number; label: Prisma.JsonValue;
  routeKind: string; targetSceneId: string | null; targetEndingKey: string | null;
  declaredRejoinSceneId: string | null;
};
type Pending = {
  partId: string; partKey: string; title: string; titleValue: Prisma.JsonValue; sceneId: string;
  original: Choice; legacy: Choice[];
};

function korean(value: Prisma.JsonValue): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const text = (value as Record<string, unknown>).ko;
  return typeof text === 'string' ? text.trim() : '';
}

function conflict(message: string): never {
  throw new ConflictException({ code: 'STORY_LEGACY_CHOICES_SOURCE_CHANGED', message });
}

export class StoryFixedRouteChoiceRefreshService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: () => Pick<StoryChoicePreparationProvider, 'generate'> = () => {
      const apiKey = process.env.STORY_CONTINUATION_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new ServiceUnavailableException({ code: 'STORY_CHOICE_PREPARATION_NOT_CONFIGURED' });
      return new StoryChoicePreparationProvider({
        apiKey,
        model: process.env.STORY_CONTINUATION_OPENAI_MODEL || 'gpt-5.4-mini-2026-03-17',
      });
    },
  ) {}

  async status(storyKey: FixedRouteStoryKey, workId: string, client: Client = this.prisma) {
    const { totalParts, pending, phase, publicChoiceSet } = await this.inspect(client, storyKey, workId);
    return { totalParts, preparedParts: totalParts - pending.length, remainingParts: pending.length,
      ready: phase === 'ready', phase, publicChoiceSet };
  }

  async refreshBatch(actorUserId: string, storyKey: FixedRouteStoryKey, workId: string, releaseId: string) {
    const before = await this.inspect(this.prisma, storyKey, workId);
    if (before.phase === 'ready') return this.receipt(before.totalParts, 0, 'ready');
    if (await this.prisma.storyAuthorFinalReviewProof.findFirst({ where: { workId }, select: { id: true } })) {
      conflict('Approved authored content cannot be changed in place');
    }
    if (before.staged.length) {
      const reconciled = await this.reconcileStaged(actorUserId, storyKey, workId, releaseId, before.totalParts);
      if (reconciled) return reconciled;
    }
    const batch = before.pending.slice(0, BATCH_SIZE);
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, activeReleaseId: releaseId, status: 'published', fixtureSource: false },
      select: { title: true },
    });
    const workTitle = work ? korean(work.title) : '';
    if (!workTitle) conflict('Published work title is unavailable');
    const input = await this.choiceInput(this.prisma, workTitle, batch);
    const sourceFingerprints = await this.sourceFingerprints(this.prisma, batch, work!.title);
    let generated: Awaited<ReturnType<StoryChoicePreparationProvider['generate']>>;
    try {
      generated = await this.providerFactory().generate(input);
    } catch (error) {
      if (error instanceof StoryChoicePreparationError) {
        throw new ServiceUnavailableException({ code: 'STORY_CHOICE_PREPARATION_RETRYABLE', reason: error.code });
      }
      throw error;
    }
    const alternatives = new Map(generated.map((item) => [item.partKey, item.alternatives]));
    if (generated.length !== batch.length || alternatives.size !== batch.length ||
        batch.some((part) => !alternatives.has(part.partKey))) {
      throw new ServiceUnavailableException({ code: 'STORY_CHOICE_PREPARATION_INCOMPLETE' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
      const currentWork = await tx.storyWork.findFirst({
        where: { id: workId, activeReleaseId: releaseId, status: 'published', fixtureSource: false },
        select: { title: true },
      });
      const release = await tx.storyRelease.findFirst({
        where: { id: releaseId, workId, status: 'active' }, select: { id: true },
      });
      if (!currentWork || !release || korean(currentWork.title) !== workTitle ||
          await tx.storyAuthorFinalReviewProof.findFirst({ where: { workId }, select: { id: true } })) {
        conflict('Published release or approved source changed during preparation');
      }
      for (const part of batch) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_scenes WHERE id = ${part.sceneId}::uuid FOR UPDATE`);
      }
      const current = await this.inspect(tx, storyKey, workId);
      const byScene = new Map(current.pending.map((part) => [part.sceneId, part]));
      if (batch.some((part) => this.fingerprint(part) !== this.fingerprint(byScene.get(part.sceneId)))) {
        conflict('A published choice changed during preparation');
      }
      const currentInput = await this.choiceInput(tx, workTitle, batch);
      const currentFingerprints = await this.sourceFingerprints(tx, batch, currentWork.title);
      if (this.fingerprint(currentInput) !== this.fingerprint(input) ||
          this.fingerprint(currentFingerprints) !== this.fingerprint(sourceFingerprints)) {
        conflict('The authored ending changed during preparation');
      }
      const stagedChoiceIds: Record<string, string[]> = {};
      for (const part of batch) {
        const labels = alternatives.get(part.partKey)!;
        const data = labels.map((label, index) => ({
          id: randomUUID(), sceneId: part.sceneId,
          choiceKey: index === 0 ? 'ai-branch-b-v1' : 'ai-branch-c-v1',
          position: -(index + 2), label: { ko: label }, routeKind: 'generation_required',
          targetSceneId: null, targetEndingKey: null, declaredRejoinSceneId: null,
        }));
        await tx.storyChoice.createMany({ data });
        stagedChoiceIds[part.sceneId] = data.map((choice) => choice.id);
      }
      await tx.auditEvent.create({ data: {
        actorUserId, actorType: 'admin', action: 'story_public_beta.ai_choices.staged',
        targetType: 'story_work', targetId: workId,
        metadata: { storyKey, releaseId, policyVersion: CHOICE_POLICY,
          sceneIds: batch.map((part) => part.sceneId),
          sourceHash: this.fingerprint(input), sourceFingerprints, stagedChoiceIds },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 10000 });
    return this.receipt(before.totalParts, before.pending.length - batch.length,
      before.pending.length === batch.length ? 'awaiting_promotion' : 'preparing');
  }

  private async reconcileStaged(actorUserId: string, storyKey: FixedRouteStoryKey,
    workId: string, releaseId: string, totalParts: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
      const work = await tx.storyWork.findFirst({
        where: { id: workId, activeReleaseId: releaseId, status: 'published', fixtureSource: false },
        select: { id: true, title: true },
      });
      const release = await tx.storyRelease.findFirst({
        where: { id: releaseId, workId, status: 'active' }, select: { id: true },
      });
      if (!work || !release || await tx.storyAuthorFinalReviewProof.findFirst({
        where: { workId }, select: { id: true },
      })) conflict('Published release or approved source changed before promotion');
      const parts = await tx.storyPart.findMany({
        where: { workId, status: 'published', fixtureSource: false }, select: { id: true },
      });
      const scenes = await tx.storyScene.findMany({
        where: { partId: { in: parts.map((part) => part.id) }, status: 'published', fixtureSource: false }, select: { id: true },
        orderBy: { id: 'asc' },
      });
      for (const scene of scenes) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_scenes WHERE id = ${scene.id}::uuid FOR UPDATE`);
      }
      const current = await this.inspect(tx, storyKey, workId);
      if (current.totalParts !== totalParts || current.phase === 'ready') {
        conflict('Prepared choices changed before promotion');
      }
      const stagedAudits = await tx.auditEvent.findMany({
        where: { targetType: 'story_work', targetId: workId, action: 'story_public_beta.ai_choices.staged' },
        select: { metadata: true },
      });
      const recorded = new Map<string, string>();
      for (const audit of stagedAudits) {
        const metadata = audit.metadata;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
            metadata.releaseId !== releaseId || metadata.storyKey !== storyKey ||
            metadata.policyVersion !== CHOICE_POLICY) continue;
        const fingerprints = metadata.sourceFingerprints;
        const choiceIds = metadata.stagedChoiceIds;
        if (!fingerprints || typeof fingerprints !== 'object' || Array.isArray(fingerprints) ||
            !choiceIds || typeof choiceIds !== 'object' || Array.isArray(choiceIds)) continue;
        for (const part of current.staged) {
          const ids = choiceIds[part.sceneId];
          if (!Array.isArray(ids) || ids.length !== 2 ||
              ids.slice().sort().join(':') !== part.prepared.map((choice) => choice.id).sort().join(':')) continue;
          const hash = fingerprints[part.sceneId];
          if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || recorded.has(part.sceneId)) {
            conflict('Staged source fingerprints are ambiguous');
          }
          recorded.set(part.sceneId, hash);
        }
      }
      if (current.staged.some((part) => !recorded.has(part.sceneId))) {
        conflict('Staged source fingerprints are missing');
      }
      const currentFingerprints = await this.sourceFingerprints(tx, current.staged, work.title);
      const stale = current.staged.filter((part) =>
        recorded.get(part.sceneId) !== currentFingerprints[part.sceneId]);
      if (stale.length) {
        for (const part of stale) {
          const result = await tx.storyChoice.deleteMany({ where: {
            id: { in: part.prepared.map((choice) => choice.id) }, sceneId: part.sceneId,
            position: { lt: 0 }, choiceKey: { in: ['ai-branch-b-v1', 'ai-branch-c-v1'] },
          } });
          if (result.count !== 2) conflict('Staged alternatives changed during invalidation');
        }
        await tx.auditEvent.create({ data: {
          actorUserId, actorType: 'admin', action: 'story_public_beta.ai_choices.invalidated',
          targetType: 'story_work', targetId: workId,
          metadata: { storyKey, releaseId, policyVersion: CHOICE_POLICY,
            sceneIds: stale.map((part) => part.sceneId), reason: 'authored_source_changed' },
        } });
        return this.receipt(totalParts, current.pending.length + stale.length, 'preparing');
      }
      if (current.phase !== 'awaiting_promotion' || current.staged.length !== totalParts) return null;
      for (const part of current.staged) {
        for (const legacy of part.legacy) {
          await tx.storyChoice.update({ where: { id: legacy.id }, data: { position: -(legacy.position + 10) } });
        }
        for (const prepared of part.prepared) {
          await tx.storyChoice.update({ where: { id: prepared.id }, data: { position: -prepared.position } });
        }
      }
      await tx.auditEvent.create({ data: {
        actorUserId, actorType: 'admin', action: 'story_public_beta.ai_choices.promoted',
        targetType: 'story_work', targetId: workId,
        metadata: { storyKey, releaseId, policyVersion: CHOICE_POLICY,
          sceneIds: current.staged.map((part) => part.sceneId),
          retainedChoiceIds: current.staged.flatMap((part) => part.legacy.map((choice) => choice.id)) },
      } });
      return this.receipt(totalParts, 0, 'ready');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 30000 });
  }

  private receipt(totalParts: number, remainingParts: number,
    phase: 'preparing' | 'awaiting_promotion' | 'ready') {
    return { totalParts, preparedParts: totalParts - remainingParts, remainingParts,
      ready: phase === 'ready', phase, publicChoiceSet: phase === 'ready' ? 'prepared' : 'legacy' };
  }

  private fingerprint(value: unknown) {
    const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
      : item && typeof item === 'object'
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([key, entry]) => [key, canonical(entry)])) : item;
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  }

  private async sourceFingerprints(client: Client, parts: Pending[],
    workTitle: Prisma.JsonValue): Promise<Record<string, string>> {
    const beats = await client.storyBeat.findMany({
      where: { sceneId: { in: parts.map((part) => part.sceneId) } },
      orderBy: [{ sceneId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
      select: { id: true, sceneId: true, position: true, content: true },
    });
    const byScene = new Map<string, Array<{ id: string; position: number; content: Prisma.JsonValue }>>();
    for (const beat of beats) {
      byScene.set(beat.sceneId, [...(byScene.get(beat.sceneId) ?? []), beat]);
    }
    return Object.fromEntries(parts.map((part) => {
      const sceneBeats = byScene.get(part.sceneId) ?? [];
      return [part.sceneId, this.fingerprint({
        workTitle, title: part.titleValue, originalLabel: part.original.label, beats: sceneBeats,
      })];
    }));
  }

  private async choiceInput(client: Client, workTitle: string, batch: Pending[]): Promise<StoryChoicePreparationInput> {
    const beats = await client.storyBeat.findMany({
      where: { sceneId: { in: batch.map((part) => part.sceneId) } },
      orderBy: [{ sceneId: 'asc' }, { position: 'asc' }],
      select: { sceneId: true, content: true },
    });
    const textByScene = new Map<string, string[]>();
    for (const beat of beats) {
      const text = korean(beat.content);
      if (!text) conflict('Published ending text is unavailable');
      textByScene.set(beat.sceneId, [...(textByScene.get(beat.sceneId) ?? []), text]);
    }
    return { workTitle, parts: batch.map((part) => {
      const paragraphs = textByScene.get(part.sceneId) ?? [];
      if (!paragraphs.length || paragraphs.length > 40) conflict('Published ending text is incomplete');
      const text = paragraphs.join('\n');
      return { partKey: part.partKey, title: part.title, endingExcerpt: text.slice(-1200),
        context: text.slice(0, 350), originalChoiceLabel: korean(part.original.label) };
    }) };
  }

  private async inspect(client: Client, storyKey: FixedRouteStoryKey, workId: string) {
    const parts = await client.storyPart.findMany({
      where: { workId, status: 'published', fixtureSource: false },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, position: true, title: true },
    });
    if (!parts.length || new Set(parts.map((part) => part.position)).size !== parts.length) {
      conflict('Published parts are incomplete');
    }
    const scenes = await client.storyScene.findMany({
      where: { partId: { in: parts.map((part) => part.id) }, status: 'published', fixtureSource: false },
      select: { id: true, partId: true },
    });
    if (scenes.length !== parts.length || new Set(scenes.map((scene) => scene.partId)).size !== parts.length) {
      conflict('Published scene binding is incomplete');
    }
    const sceneByPart = new Map(scenes.map((scene) => [scene.partId, scene.id]));
    const choices = await client.storyChoice.findMany({
      where: { sceneId: { in: scenes.map((scene) => scene.id) } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const byScene = new Map<string, Choice[]>();
    for (const choice of choices) {
      byScene.set(choice.sceneId, [...(byScene.get(choice.sceneId) ?? []), choice]);
    }
    const pending: Pending[] = [];
    const staged: Array<Pending & { prepared: Choice[] }> = [];
    let legacyActive = 0;
    let preparedActive = 0;
    for (const part of parts) {
      const sceneId = sceneByPart.get(part.id)!;
      const title = korean(part.title);
      const all = byScene.get(sceneId) ?? [];
      const active = all.filter((choice) => choice.position > 0)
        .sort((left, right) => left.position - right.position);
      const hidden = all.filter((choice) => choice.position < 0);
      const original = active[0];
      if (!title || !original || original.position !== 1 || original.routeKind !== 'writer_original' ||
          Boolean(original.targetSceneId) === Boolean(original.targetEndingKey) || !korean(original.label)) {
        conflict('Published writer-original route is incomplete');
      }
      const base = { partId: part.id, partKey: `part-${part.position}`,
        title, titleValue: part.title, sceneId, original };
      if (all.some((choice) => choice.position === 0) || (active.length !== 1 && active.length !== 3) ||
          (active.length === 3 && (active[1].position !== 2 || active[2].position !== 3)) ||
          active.slice(1).some((choice) => choice.routeKind !== 'generation_required' ||
            choice.targetSceneId || choice.targetEndingKey || choice.declaredRejoinSceneId || !korean(choice.label))) {
        conflict('Published alternatives are incomplete');
      }
      const keys = active.slice(1).map((choice) => choice.choiceKey);
      const isLegacy = active.length === 1 || (keys[0] === 'branch-b' && keys[1] === 'branch-c');
      const isPrepared = keys[0] === 'ai-branch-b-v1' && keys[1] === 'ai-branch-c-v1';
      if (!isLegacy && !isPrepared) {
        conflict('Published alternatives have unknown preparation provenance');
      }
      if (isLegacy) {
        legacyActive += 1;
        const validStaged = hidden.length === 2 && hidden.some((choice) =>
          choice.choiceKey === 'ai-branch-b-v1' && choice.position === -2) && hidden.some((choice) =>
          choice.choiceKey === 'ai-branch-c-v1' && choice.position === -3) &&
          hidden.every((choice) => choice.routeKind === 'generation_required' &&
            !choice.targetSceneId && !choice.targetEndingKey && !choice.declaredRejoinSceneId && korean(choice.label));
        if (hidden.length && !validStaged) conflict('Staged alternatives are incomplete');
        if (validStaged) staged.push({ ...base, legacy: active.slice(1), prepared: hidden });
        else pending.push({ ...base, legacy: active.slice(1) });
      } else {
        preparedActive += 1;
        const validRetired = (hidden.length === 0 || (hidden.length === 2 &&
          hidden.some((choice) => choice.choiceKey === 'branch-b' && choice.position === -12) &&
          hidden.some((choice) => choice.choiceKey === 'branch-c' && choice.position === -13)));
        if (!validRetired) conflict('Retired alternatives are incomplete');
      }
    }
    if (legacyActive && preparedActive) conflict('Published choice sets are mixed');
    const phase = preparedActive ? 'ready' : pending.length ? 'preparing' : 'awaiting_promotion';
    return { totalParts: parts.length, pending, staged, phase,
      publicChoiceSet: preparedActive ? 'prepared' : 'legacy' } as const;
  }
}
