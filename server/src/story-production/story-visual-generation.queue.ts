import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_STORY_SLUGS = [
  'records-of-the-burning-sea-imjin-war',
  'norse-myth-loki-crossroads',
];

type QueueWork = {
  id: string;
  slug: string;
  activeReleaseId: string;
};

export type StoryVisualQueueCandidate = {
  workId: string;
  releaseId: string;
  releaseChecksum: string;
  sourceSceneKey: string;
  promptSha256: string;
  priority: 'reader_reached' | 'authored_key' | 'ai_branch' | 'authored_remaining';
};

type PromptRow = Omit<StoryVisualQueueCandidate, 'priority'> & {
  sourceKind: string;
  createdAt: Date;
};

export class StoryVisualGenerationQueue {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sync(workId?: string) {
    this.assertWorkId(workId);
    const works = await this.eligibleWorks(workId);
    const limits = this.limits();
    const existingRows = works.length ? await this.prisma.storyVisualGeneration.findMany({
      where: { workId: { in: works.map(work => work.id) } },
      select: { workId: true, releaseId: true, sourceSceneKey: true, status: true, attemptCount: true },
    }) : [];
    const globalReserved = await this.prisma.storyVisualGeneration.count({
      where: { OR: [{ attemptCount: { gte: 1 } }, { status: { in: ['pending', 'generating'] } }] },
    });
    let totalRemaining = Math.max(0, limits.total - globalReserved);
    const candidates: StoryVisualQueueCandidate[] = [];

    for (const work of works) {
      if (!totalRemaining) break;
      const currentRows = existingRows.filter(row => row.workId === work.id && row.releaseId === work.activeReleaseId);
      const existingKeys = new Set(currentRows.map(row => row.sourceSceneKey));
      const workReserved = currentRows.filter(row => row.attemptCount >= 1 ||
        ['pending', 'generating'].includes(row.status)).length;
      let workRemaining = Math.max(0, limits.perWork - workReserved);
      if (!workRemaining) continue;
      const ranked = await this.rankedPrompts(work);
      for (const candidate of ranked) {
        if (!workRemaining || !totalRemaining) break;
        if (existingKeys.has(candidate.sourceSceneKey)) continue;
        candidates.push(candidate);
        existingKeys.add(candidate.sourceSceneKey);
        workRemaining -= 1;
        totalRemaining -= 1;
      }
    }

    if (candidates.length) {
      await this.prisma.storyVisualGeneration.createMany({
        data: candidates.map(candidate => ({
          workId: candidate.workId,
          releaseId: candidate.releaseId,
          releaseChecksum: candidate.releaseChecksum,
          sourceSceneKey: candidate.sourceSceneKey,
          promptSha256: candidate.promptSha256,
        })),
        skipDuplicates: true,
      });
    }

    return {
      eligibleWorkCount: works.length,
      queuedCount: candidates.length,
      limits,
      priorities: this.priorityCounts(candidates),
      limitReached: totalRemaining === 0 || works.some(work => {
        const count = existingRows.filter(row => row.workId === work.id && row.releaseId === work.activeReleaseId &&
          (row.attemptCount >= 1 || ['pending', 'generating'].includes(row.status))).length;
        return count >= limits.perWork;
      }),
    };
  }

  async next(workId?: string): Promise<StoryVisualQueueCandidate | null> {
    this.assertWorkId(workId);
    const works = await this.eligibleWorks(workId);
    const ranked = (await Promise.all(works.map(work => this.rankedPrompts(work)))).flat();
    if (!ranked.length) return null;
    const ranking = new Map(ranked.map((candidate, index) => [
      `${candidate.workId}:${candidate.releaseId}:${candidate.sourceSceneKey}`,
      { candidate, index },
    ]));
    const staleBefore = new Date(Date.now() - this.integer('STORY_IMAGE_GENERATION_STALE_SECONDS', 180, 30, 3600) * 1000);
    const rows = await this.prisma.storyVisualGeneration.findMany({
      where: {
        workId: { in: works.map(work => work.id) },
        OR: [
          { status: 'pending' },
          { status: 'generating', updatedAt: { lt: staleBefore } },
          ...(this.databaseFallbackEnabled()
            ? [{ status: 'failed', lastErrorCode: { startsWith: 'OBJECT_STORAGE_' } }]
            : []),
        ],
      },
      select: {
        workId: true, releaseId: true, releaseChecksum: true, sourceSceneKey: true,
        promptSha256: true, status: true, attemptCount: true, updatedAt: true,
      },
    });
    const eligible = rows.flatMap(row => {
      const item = ranking.get(`${row.workId}:${row.releaseId}:${row.sourceSceneKey}`);
      return item && item.candidate.promptSha256 === row.promptSha256
        ? [{ ...item, requestedAt: row.updatedAt }]
        : [];
    });
    eligible.sort((left, right) => left.index - right.index ||
      left.requestedAt.getTime() - right.requestedAt.getTime());
    return eligible[0]?.candidate ?? null;
  }

  async status(workId?: string) {
    this.assertWorkId(workId);
    const works = await this.eligibleWorks(workId);
    const ids = works.map(work => work.id);
    const [promptCount, rows, failures, globalAttempted] = await Promise.all([
      ids.length ? this.prisma.storyVisualPrompt.count({ where: { workId: { in: ids } } }) : Promise.resolve(0),
      ids.length ? this.prisma.storyVisualGeneration.findMany({
        where: { workId: { in: ids } },
        select: { workId: true, releaseId: true, status: true, attemptCount: true },
      }) : Promise.resolve([]),
      ids.length ? this.prisma.storyVisualGeneration.findMany({
        where: { workId: { in: ids }, status: 'failed' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: { workId: true, releaseId: true, sourceSceneKey: true, lastErrorCode: true, updatedAt: true },
      }) : Promise.resolve([]),
      this.prisma.storyVisualGeneration.count({ where: { attemptCount: { gte: 1 } } }),
    ]);
    const summarize = (items: Array<{ status: string; attemptCount: number }>) => ({
      queued: items.filter(item => item.status === 'pending').length,
      generating: items.filter(item => item.status === 'generating').length,
      ready: items.filter(item => item.status === 'ready').length,
      failed: items.filter(item => item.status === 'failed').length,
      attempted: items.filter(item => item.attemptCount >= 1).length,
    });
    return {
      limits: this.limits(),
      totals: { prompts: promptCount, ...summarize(rows), globalAttempted },
      works: works.map(work => ({
        workId: work.id,
        slug: work.slug,
        releaseId: work.activeReleaseId,
        ...summarize(rows.filter(row => row.workId === work.id && row.releaseId === work.activeReleaseId)),
      })),
      failures,
    };
  }

  limits() {
    return {
      perWork: this.integer('STORY_IMAGE_GENERATION_MAX_PER_WORK', 80, 1, 10_000),
      total: this.integer('STORY_IMAGE_GENERATION_MAX_TOTAL', 160, 1, 20_000),
    };
  }

  private async eligibleWorks(workId?: string): Promise<QueueWork[]> {
    const rows = await this.prisma.storyWork.findMany({
      where: {
        ...(workId ? { id: workId } : {}),
        slug: { in: PUBLIC_STORY_SLUGS },
        status: 'published',
        fixtureSource: false,
        activeReleaseId: { not: null },
      },
      orderBy: { publishedAt: 'asc' },
      select: { id: true, slug: true, activeReleaseId: true },
    });
    return rows.flatMap(row => row.activeReleaseId ? [{ ...row, activeReleaseId: row.activeReleaseId }] : []);
  }

  private async rankedPrompts(work: QueueWork): Promise<StoryVisualQueueCandidate[]> {
    const release = await this.prisma.storyRelease.findFirst({
      where: { id: work.activeReleaseId, workId: work.id, status: 'active' },
      select: { id: true, checksum: true },
    });
    if (!release) return [];
    const prompts = await this.prisma.storyVisualPrompt.findMany({
      where: { workId: work.id, releaseId: release.id, releaseChecksum: release.checksum },
      orderBy: { createdAt: 'asc' },
      select: {
        workId: true, releaseId: true, releaseChecksum: true, sourceSceneKey: true,
        promptSha256: true, sourceKind: true, createdAt: true,
      },
    }) as PromptRow[];
    const [reached, authoredKeys] = await Promise.all([
      this.reachedKeys(work.id, release.id),
      this.authoredKeyScenes(work.id),
    ]);
    const priority = (prompt: PromptRow): StoryVisualQueueCandidate['priority'] => {
      if (reached.has(prompt.sourceSceneKey)) return 'reader_reached';
      if (authoredKeys.has(prompt.sourceSceneKey)) return 'authored_key';
      if (prompt.sourceKind === 'ai_branch') return 'ai_branch';
      return 'authored_remaining';
    };
    const rank = { reader_reached: 0, authored_key: 1, ai_branch: 2, authored_remaining: 3 };
    return prompts.map(prompt => ({
      workId: prompt.workId,
      releaseId: prompt.releaseId,
      releaseChecksum: prompt.releaseChecksum,
      sourceSceneKey: prompt.sourceSceneKey,
      promptSha256: prompt.promptSha256,
      priority: priority(prompt),
      createdAt: prompt.createdAt,
    })).sort((left, right) => rank[left.priority] - rank[right.priority] ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.sourceSceneKey.localeCompare(right.sourceSceneKey))
      .map(({ createdAt: _createdAt, ...candidate }) => candidate);
  }

  private async reachedKeys(workId: string, releaseId: string) {
    const progress = await this.prisma.storyReaderProgress.findMany({
      where: { workId, activeReleaseId: releaseId, status: 'active' },
      select: { currentSceneId: true, currentGeneratedSceneId: true },
    });
    const canonicalIds = [...new Set(progress.map(row => row.currentSceneId).filter((id): id is string => Boolean(id)))];
    const generatedIds = [...new Set(progress.map(row => row.currentGeneratedSceneId).filter((id): id is string => Boolean(id)))];
    const [scenes, beats, generated] = await Promise.all([
      canonicalIds.length ? this.prisma.storyScene.findMany({
        where: { id: { in: canonicalIds }, status: 'published', fixtureSource: false },
        select: { id: true, sceneKey: true },
      }) : Promise.resolve([]),
      canonicalIds.length ? this.prisma.storyBeat.findMany({
        where: { sceneId: { in: canonicalIds }, sourceSceneKey: { not: null } },
        select: { sourceSceneKey: true },
      }) : Promise.resolve([]),
      generatedIds.length ? this.prisma.storyAiGeneratedScene.findMany({
        where: { id: { in: generatedIds }, workId, releaseId, status: 'ready' },
        select: { sceneKey: true },
      }) : Promise.resolve([]),
    ]);
    return new Set([
      ...scenes.map(scene => scene.sceneKey),
      ...beats.map(beat => beat.sourceSceneKey).filter((key): key is string => Boolean(key)),
      ...generated.map(scene => scene.sceneKey),
    ]);
  }

  private async authoredKeyScenes(workId: string) {
    const parts = await this.prisma.storyPart.findMany({
      where: { workId, status: 'published', fixtureSource: false },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    if (!parts.length) return new Set<string>();
    const scenes = await this.prisma.storyScene.findMany({
      where: { partId: { in: parts.map(part => part.id) }, status: 'published', fixtureSource: false },
      select: { id: true, partId: true, sceneKey: true, position: true },
    });
    const beats = scenes.length ? await this.prisma.storyBeat.findMany({
      where: { sceneId: { in: scenes.map(scene => scene.id) }, sourceSceneKey: { not: null } },
      select: { sceneId: true, position: true, sourceSceneKey: true },
    }) : [];
    const partPosition = new Map(parts.map(part => [part.id, part.position]));
    const sceneById = new Map(scenes.map(scene => [scene.id, scene]));
    const ordered = beats.filter(beat => beat.sourceSceneKey).sort((left, right) => {
      const leftScene = sceneById.get(left.sceneId)!;
      const rightScene = sceneById.get(right.sceneId)!;
      return (partPosition.get(leftScene.partId)! - partPosition.get(rightScene.partId)!) ||
        (leftScene.position - rightScene.position) || (left.position - right.position);
    });
    const firstByPart = new Map<string, string>();
    for (const beat of ordered) {
      const partId = sceneById.get(beat.sceneId)!.partId;
      if (!firstByPart.has(partId)) firstByPart.set(partId, beat.sourceSceneKey!);
    }
    return new Set(firstByPart.values());
  }

  private priorityCounts(candidates: StoryVisualQueueCandidate[]) {
    return {
      readerReached: candidates.filter(candidate => candidate.priority === 'reader_reached').length,
      authoredKey: candidates.filter(candidate => candidate.priority === 'authored_key').length,
      aiBranch: candidates.filter(candidate => candidate.priority === 'ai_branch').length,
      authoredRemaining: candidates.filter(candidate => candidate.priority === 'authored_remaining').length,
    };
  }

  private assertWorkId(workId?: string) {
    if (workId && !UUID_PATTERN.test(workId)) throw new BadRequestException('workId must be a UUID');
  }

  private databaseFallbackEnabled() {
    return this.config.get<string>('STORY_IMAGE_DATABASE_FALLBACK_ENABLED') === 'true';
  }

  private integer(key: string, fallback: number, min: number, max: number) {
    const raw = this.config.get<string>(key);
    if (raw == null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(`${key} is invalid`);
    }
    return value;
  }
}
