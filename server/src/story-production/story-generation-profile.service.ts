import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type StoryAnalysisJob } from '@prisma/client';
import { createHash } from 'crypto';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  assertCreatorGenerationProfileApprovable,
  creatorGenerationProfileFingerprint,
  creatorGenerationProfileProjection,
  normalizeCreatorGenerationProfile,
  stableJson,
  type CreatorGenerationProfileEvidence,
  type CreatorGenerationProfileSection,
  type CreatorGenerationProfileSettings,
} from '../generation-profile/creator-generation-profile.policy';
import {
  ApproveCreatorGenerationProfileDto,
  UpdateStoryGenerationProfileDto,
} from '../generation-profile/dto/creator-generation-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';

const EVIDENCE_TYPES = [
  'scene',
  'background',
  'entity',
  'event',
  'foreshadow',
  'payoff',
  'style',
] as const;

type EvidenceType = (typeof EVIDENCE_TYPES)[number];
type ProfileEvidenceRow = {
  id: string;
  evidenceType: string;
  sourcePartKey: string;
  sourceParagraphIndex: number;
  payload: unknown;
};

@Injectable()
export class StoryGenerationProfileService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StoryGenerationProfileService.name);
  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    void this.approvePendingCompanyProfiles().catch((error: unknown) => {
      this.logger.warn(`Company story profile recovery stopped: ${error instanceof Error ? error.name : 'unknown error'}`);
    });
  }

  private async approvePendingCompanyProfiles() {
    const pending = await this.prisma.storyWorkGenerationProfile.findMany({
      where: { status: 'needs_review' },
      select: { workId: true, ownerUserId: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const profile of pending) {
      try {
        await this.autoApproveCompany(profile.ownerUserId, profile.workId);
      } catch (error) {
        this.logger.warn(`Company story profile recovery skipped ${profile.workId}: ${error instanceof Error ? error.name : 'unknown error'}`);
      }
    }
  }

  async autoApproveCompany(userId: string, workId: string) {
    const source = await this.latestCompletedSource(userId, workId);
    return this.prisma.$transaction(async (tx) => {
      const work = await tx.storyWork.findFirst({
        where: { id: workId, ownerUserId: userId },
        select: { authorDisplayName: true, fixtureSource: true },
      });
      if (work?.authorDisplayName !== '루미나' || work.fixtureSource) return null;
      const companyImport = await tx.storyPublicationImportJob.findFirst({
        where: { workId, actorUserId: userId, status: 'published' }, select: { id: true },
      });
      const companyPublication = companyImport ? null : await tx.auditEvent.findFirst({
        where: { actorUserId: userId, actorType: 'admin',
          action: { in: ['story_approved_source.public_beta_published', 'story_upload.public_beta_published'] },
          afterData: { path: ['workId'], equals: workId } },
        select: { id: true },
      });
      if (!companyImport && !companyPublication) return null;
      const current = await tx.storyWorkGenerationProfile.findFirst({
        where: { workId }, orderBy: { profileVersion: 'desc' },
      });
      if (!current || current.analysisJobId !== source.analysis.id || current.status !== 'needs_review' ||
          current.sourceFingerprint !== this.sourceFingerprint(source) || current.reviewRevision !== 0) return null;
      const draft = normalizeCreatorGenerationProfile('story', current.draftSettings);
      if (draft.sections.some((section) => section.decision !== 'proposed')) return null;
      const settings = normalizeCreatorGenerationProfile('story', {
        ...draft,
        sections: draft.sections.map((section) => ({ ...section, decision: 'accepted' })),
      });
      assertCreatorGenerationProfileApprovable(settings);
      const fingerprint = creatorGenerationProfileFingerprint(current.sourceFingerprint, settings);
      const updated = await tx.storyWorkGenerationProfile.updateMany({
        where: { id: current.id, status: 'needs_review', sourceFingerprint: current.sourceFingerprint,
          draftFingerprint: current.draftFingerprint, reviewRevision: 0 },
        data: { status: 'approved', draftSettings: settings as unknown as Prisma.InputJsonValue,
          draftFingerprint: fingerprint, approvedSettings: settings as unknown as Prisma.InputJsonValue,
          approvedFingerprint: fingerprint, approvedByUserId: userId, approvedAt: new Date(),
          reviewRevision: { increment: 1 }, updatedAt: new Date() },
      });
      if (updated.count !== 1) return null;
      const approved = await tx.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: current.id } });
      const approvedMemoryCount = await this.persistApprovedMemories(tx, source, approved.id, settings);
      await tx.auditEvent.create({ data: { actorUserId: userId, actorType: 'system',
        action: 'story_generation_profile.company_auto_approved',
        targetType: 'story_work_generation_profile', targetId: approved.id,
        beforeData: { status: current.status, reviewRevision: current.reviewRevision },
        afterData: { status: approved.status, reviewRevision: approved.reviewRevision,
          approvedFingerprint: approved.approvedFingerprint },
        metadata: { workId, analysisJobId: source.analysis.id,
          ...(companyImport ? { companyImportJobId: companyImport.id } : { companyPublicationAuditId: companyPublication!.id }),
          approvedMemoryCount } } });
      return this.project(workId, source, approved);
    });
  }

  async getOrCreate(userId: string, workId: string) {
    const source = await this.latestCompletedSource(userId, workId);
    let profile = await this.prisma.storyWorkGenerationProfile.findFirst({
      where: { workId, analysisJobId: source.analysis.id },
      orderBy: { profileVersion: 'desc' },
    });
    if (!profile) {
      try {
        profile = await this.prisma.$transaction(tx => this.createDraft(tx, userId, source));
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        profile = await this.prisma.storyWorkGenerationProfile.findFirst({
          where: { workId, analysisJobId: source.analysis.id },
          orderBy: { profileVersion: 'desc' },
        });
        if (!profile) throw error;
      }
    }
    if (profile.status === 'needs_review') {
      try {
        const approved = await this.autoApproveCompany(userId, workId);
        if (approved) return approved;
      } catch (error) {
        this.logger.warn(`Company story profile remained in review for ${workId}: ${error instanceof Error ? error.name : 'unknown error'}`);
      }
    }
    return this.project(workId, source, profile);
  }

  async createDraftAtCompletion(tx: Prisma.TransactionClient, job: StoryAnalysisJob) {
    const userId = job.actorUserId;
    if (!userId || job.pipeline !== SEMANTIC_PIPELINE || job.status !== 'running' || job.phase !== 'finalizing')
      throw new Error('Invalid semantic profile source');
    const work = await tx.storyWork.findFirst({
      where: { id: job.workId, ownerUserId: userId }, select: { id: true },
    });
    const manuscript = await tx.storyManuscriptVersion.findFirst({
      where: { id: job.manuscriptVersionId, workId: job.workId, ownerUserId: userId },
      select: { id: true, version: true, locale: true, contentHash: true, structuredBody: true },
    });
    if (!work || !manuscript || manuscript.contentHash !== job.sourceContentHash)
      throw new Error('Invalid semantic profile source');
    return this.createDraft(tx, userId, { work, manuscript, analysis: {
      id: job.id, analysisVersion: job.analysisVersion, sourceContentHash: job.sourceContentHash,
      configHash: job.configHash, totalParts: job.totalParts, totalParagraphs: job.totalParagraphs,
    } });
  }

  private async createDraft(
    tx: Prisma.TransactionClient,
    userId: string,
    source: Awaited<ReturnType<StoryGenerationProfileService['latestCompletedSource']>>,
  ) {
    const workId = source.work.id;
    const owned = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM story_works WHERE id=${workId}::uuid AND owner_user_id=${userId}::uuid FOR UPDATE
    `;
    if (!owned.length) throw new NotFoundException('Story work not found');
    const replay = await tx.storyWorkGenerationProfile.findFirst({
      where: { workId, analysisJobId: source.analysis.id }, orderBy: { profileVersion: 'desc' },
    });
    if (replay) return replay;
    const current = await tx.storyWorkGenerationProfile.findFirst({
      where: { workId }, orderBy: { profileVersion: 'desc' },
    });
    const settings = await this.settingsFromAnalysis(tx, source.analysis.id, source.manuscript);
    const sourceFingerprint = this.sourceFingerprint(source);
    const draftFingerprint = creatorGenerationProfileFingerprint(sourceFingerprint, settings);
    const created = await tx.storyWorkGenerationProfile.create({ data: {
      workId, ownerUserId: userId,
      manuscriptVersionId: source.manuscript.id, analysisJobId: source.analysis.id,
      sourceFingerprint, profileVersion: (current?.profileVersion ?? 0) + 1,
      status: 'needs_review', draftSettings: settings as unknown as Prisma.InputJsonValue, draftFingerprint,
    } });
    await tx.auditEvent.create({ data: {
      actorUserId: created.ownerUserId, actorType: 'system',
      action: 'story_generation_profile.analysis_draft_created',
      targetType: 'story_work_generation_profile', targetId: created.id,
      afterData: { status: created.status, profileVersion: created.profileVersion, draftFingerprint },
      metadata: { workId, manuscriptVersionId: source.manuscript.id, analysisJobId: source.analysis.id },
    } });
    return created;
  }

  async update(userId: string, workId: string, input: UpdateStoryGenerationProfileDto) {
    const settings = normalizeCreatorGenerationProfile('story', input.settings);
    const source = await this.latestCompletedSource(userId, workId);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.storyWorkGenerationProfile.findFirst({
        where: { workId },
        orderBy: { profileVersion: 'desc' },
      });
      if (!current || current.analysisJobId !== source.analysis.id) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_SOURCE_CHANGED',
          message: 'Load the latest manuscript analysis before saving the profile',
        });
      }
      const draftFingerprint = creatorGenerationProfileFingerprint(current.sourceFingerprint, settings);
      const data = {
        status: 'needs_review',
        draftSettings: settings as unknown as Prisma.InputJsonValue,
        draftFingerprint,
        approvedSettings: Prisma.DbNull,
        approvedFingerprint: null,
        approvedByUserId: null,
        approvedAt: null,
        updatedAt: new Date(),
      };
      const profile = current.status === 'approved'
        ? await tx.storyWorkGenerationProfile.create({
            data: {
              workId,
              ownerUserId: userId,
              manuscriptVersionId: current.manuscriptVersionId,
              analysisJobId: current.analysisJobId,
              sourceFingerprint: current.sourceFingerprint,
              profileVersion: current.profileVersion + 1,
              ...data,
            },
          })
        : await tx.storyWorkGenerationProfile.update({ where: { id: current.id }, data });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          actorType: 'creator',
          action: 'story_generation_profile.draft_saved',
          targetType: 'story_work_generation_profile',
          targetId: profile.id,
          beforeData: {
            status: current.status,
            profileVersion: current.profileVersion,
            draftFingerprint: current.draftFingerprint,
          },
          afterData: {
            status: profile.status,
            profileVersion: profile.profileVersion,
            draftFingerprint: profile.draftFingerprint,
          },
          metadata: { workId, analysisJobId: source.analysis.id },
        },
      });
      return this.project(workId, source, profile);
    });
  }

  async approve(userId: string, workId: string, input: ApproveCreatorGenerationProfileDto) {
    const source = await this.latestCompletedSource(userId, workId);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.storyWorkGenerationProfile.findFirst({
        where: { workId },
        orderBy: { profileVersion: 'desc' },
      });
      if (!current || current.analysisJobId !== source.analysis.id) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_SOURCE_CHANGED',
          message: 'Load the latest manuscript analysis before approval',
        });
      }
      if (current.status !== 'needs_review' || current.draftFingerprint !== input.expectedDraftFingerprint) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_DRAFT_CHANGED',
          message: 'Review the latest generation profile before approval',
        });
      }
      const settings = normalizeCreatorGenerationProfile('story', current.draftSettings);
      assertCreatorGenerationProfileApprovable(settings);
      const updated = await tx.storyWorkGenerationProfile.updateMany({
        where: {
          id: current.id,
          status: 'needs_review',
          draftFingerprint: input.expectedDraftFingerprint,
          sourceFingerprint: this.sourceFingerprint(source),
        },
        data: {
          status: 'approved',
          approvedSettings: settings as unknown as Prisma.InputJsonValue,
          approvedFingerprint: current.draftFingerprint,
          approvedByUserId: userId,
          approvedAt: new Date(),
          reviewRevision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_DRAFT_CHANGED',
          message: 'Review the latest generation profile before approval',
        });
      }
      const profile = await tx.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: current.id } });
      const approvedMemoryCount = await this.persistApprovedMemories(tx, source, profile.id, settings);
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          actorType: 'creator',
          action: 'story_generation_profile.approved',
          targetType: 'story_work_generation_profile',
          targetId: profile.id,
          beforeData: { status: current.status, reviewRevision: current.reviewRevision },
          afterData: {
            status: profile.status,
            profileVersion: profile.profileVersion,
            reviewRevision: profile.reviewRevision,
            approvedFingerprint: profile.approvedFingerprint,
          },
          metadata: { workId, analysisJobId: source.analysis.id, approvedMemoryCount },
        },
      });
      return this.project(workId, source, profile);
    });
  }

  private async persistApprovedMemories(
    tx: Prisma.TransactionClient,
    source: Awaited<ReturnType<StoryGenerationProfileService['latestCompletedSource']>>,
    profileId: string,
    settings: CreatorGenerationProfileSettings,
  ) {
    const sectionTypes: Record<string, string[]> = {
      canon: ['entity', 'background'],
      timeline: ['event'],
      narrative_devices: ['foreshadow', 'payoff'],
    };
    const reviewed = settings.sections
      .filter((section) => ['accepted', 'edited'].includes(section.decision) && sectionTypes[section.key])
      .map((section) => ({ section, observations: Array.isArray(section.value.observations)
        ? section.value.observations : [] }));
    const ids = [...new Set(reviewed.flatMap(({ observations }) => observations.flatMap((value) => {
      const ref = this.record(value).sourceRef;
      return typeof ref === 'string' && /^analysis:[0-9a-f-]{36}$/i.test(ref) ? [ref.slice(9)] : [];
    })))];
    const evidence = ids.length ? await tx.storyAnalysisEvidence.findMany({
      where: { id: { in: ids }, analysisJobId: source.analysis.id, provenance: 'semantic_candidate' },
      select: { id: true, evidenceType: true, sourcePartKey: true },
    }) : [];
    const evidenceById = new Map(evidence.map((row) => [row.id, row]));
    const memories: Prisma.StoryMemoryRecordCreateManyInput[] = [];
    const used = new Set<string>();
    for (const { section, observations } of reviewed) {
      const valid = observations.flatMap((value) => {
        const observation = this.record(value);
        const ref = observation.sourceRef;
        const row = typeof ref === 'string' ? evidenceById.get(ref.slice(9)) : undefined;
        const detail = this.text(observation.detail, 320);
        if (!row || !detail || !sectionTypes[section.key].includes(row.evidenceType) || used.has(row.id)) return [];
        used.add(row.id);
        return [{ row, detail, title: this.text(observation.title, 80) }];
      });
      for (const { row, detail, title } of this.spread(valid, 6)) {
        const memoryType = section.key === 'canon' ? 'entity' : section.key === 'timeline' ? 'event' : 'foreshadow';
        memories.push({
          workId: source.work.id,
          analysisJobId: source.analysis.id,
          manuscriptVersionId: source.manuscript.id,
          memoryType,
          memoryKey: `profile:${profileId}:${row.id}`,
          partKey: row.sourcePartKey,
          content: { [source.manuscript.locale]: title ? `${title}: ${detail}` : detail },
          evidenceIds: [row.id],
          provenance: 'writer_approved_semantic',
          status: 'approved',
        });
      }
    }
    await tx.storyMemoryRecord.updateMany({
      where: { workId: source.work.id, analysisJobId: source.analysis.id,
        provenance: 'writer_approved_semantic', status: 'approved' },
      data: { status: 'superseded' },
    });
    if (memories.length) await tx.storyMemoryRecord.createMany({ data: memories });
    return memories.length;
  }

  private async latestCompletedSource(userId: string, workId: string) {
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, ownerUserId: userId },
      select: { id: true },
    });
    if (!work) throw new NotFoundException('Story work not found');
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({
      where: { workId, ownerUserId: userId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, locale: true, contentHash: true, structuredBody: true },
    });
    if (!manuscript) {
      throw new ConflictException({
        code: 'GENERATION_PROFILE_MANUSCRIPT_REQUIRED',
        message: 'Submit a manuscript before reviewing generation settings',
      });
    }
    const analysis = await this.prisma.storyAnalysisJob.findFirst({
      where: {
        workId,
        manuscriptVersionId: manuscript.id,
        status: 'completed',
        pipeline: SEMANTIC_PIPELINE,
      },
      orderBy: { analysisVersion: 'desc' },
      select: {
        id: true,
        analysisVersion: true,
        sourceContentHash: true,
        configHash: true,
        totalParts: true,
        totalParagraphs: true,
      },
    });
    if (!analysis || analysis.sourceContentHash !== manuscript.contentHash) {
      throw new ServiceUnavailableException({
        code: 'GENERATION_PROFILE_ANALYSIS_REQUIRED',
        message: 'Complete analysis of the latest manuscript before reviewing generation settings',
      });
    }
    return { work, manuscript, analysis };
  }

  private async settingsFromAnalysis(
    db: Pick<Prisma.TransactionClient, 'storyAnalysisEvidence'>,
    analysisJobId: string,
    manuscript: { id: string; version: number; locale: string; structuredBody: Prisma.JsonValue },
  ): Promise<CreatorGenerationProfileSettings> {
    const rows = await db.storyAnalysisEvidence.findMany({
      where: {
        analysisJobId,
        provenance: 'semantic_candidate',
        evidenceType: { in: [...EVIDENCE_TYPES] },
      },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        evidenceType: true,
        sourcePartKey: true,
        sourceParagraphIndex: true,
        payload: true,
      },
      take: 5000,
    });
    if (!rows.length) {
      throw new ServiceUnavailableException({
        code: 'GENERATION_PROFILE_ANALYSIS_EVIDENCE_MISSING',
        message: 'Completed analysis does not contain reviewable evidence',
      });
    }
    const byType = new Map<EvidenceType, ProfileEvidenceRow[]>();
    for (const type of EVIDENCE_TYPES) byType.set(type, []);
    for (const row of rows) {
      if (EVIDENCE_TYPES.includes(row.evidenceType as EvidenceType)) {
        byType.get(row.evidenceType as EvidenceType)!.push(row);
      }
    }
    const parts = this.manuscriptParts(manuscript.structuredBody);
    const section = (
      key: string,
      summary: string,
      observations: ProfileEvidenceRow[],
      extra: Record<string, unknown> = {},
    ): CreatorGenerationProfileSection => ({
      key,
      decision: 'proposed',
      value: {
        summary,
        observations: this.spread(observations, 20).map((row) => this.observation(row)),
        ...extra,
      },
      evidence: this.spread(observations, 20).map((row) => this.evidence(row)),
    });
    const styles = byType.get('style')!;
    const scenes = byType.get('scene')!;
    const backgrounds = byType.get('background')!;
    const entities = byType.get('entity')!;
    const events = byType.get('event')!;
    const foreshadow = byType.get('foreshadow')!;
    const payoff = byType.get('payoff')!;
    const settings: CreatorGenerationProfileSettings = {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
      kind: 'story',
      sections: [
        section('writing_style', this.summary(styles, '원고에서 확인된 문체와 서술 리듬을 유지합니다.'), styles, {
          categories: this.styleCategories(styles),
          imitationBoundary: 'approved_work_only',
        }),
        section('scene_scale', `${parts.length}개 파트의 장면 밀도와 문단 길이를 기준으로 새 장면 분량을 맞춥니다.`, scenes, {
          partCount: parts.length,
          paragraphCount: parts.reduce((sum, part) => sum + part.paragraphs, 0),
          manuscriptVersion: manuscript.version,
        }),
        section('canon', this.summary([...entities, ...backgrounds], '인물, 장소, 세계관 설정을 원고와 일치시킵니다.'), [...entities, ...backgrounds]),
        section('timeline', this.summary(events, '사건의 선후 관계와 시간 흐름을 유지합니다.'), events),
        section('narrative_devices', this.summary([...foreshadow, ...payoff], '복선과 회수 여부를 경로 상태에 따라 추적합니다.'), [...foreshadow, ...payoff], {
          unresolvedForeshadowMustRemainTracked: true,
          impossiblePayoffMayBeReplanned: true,
        }),
        section('branch_behavior', '선택은 다음 장면의 사건과 관계를 실제로 바꾸며, 자연스러운 경우에만 기존 경로와 다시 합류합니다.', scenes, {
          maximumSuggestedChoices: 3,
          selectedChoiceMustMateriallyDiverge: true,
          rejoinOnlyWhenNarrativelyJustified: true,
          preserveSourceSegmentScale: true,
          firstReleaseCustomInput: false,
          futureCustomInputExpansion: true,
        }),
        section('visual_direction', this.summary(backgrounds, '시대, 장소, 시간대와 작품의 시각 분위기를 장면마다 유지합니다.'), backgrounds, {
          sceneImageMustMatchGeneratedText: true,
          lockEraPaletteAndRenderingStyle: true,
        }),
        section('visual_cast', this.summary(entities, '등장인물의 고정 외형과 장면별 의상·표정을 분리해 관리합니다.'), entities, {
          keepCharacterIdentityAcrossScenes: true,
          allowStorySpecificCostumeAndRendering: true,
          reserveParticipantCharacterLayer: true,
        }),
      ],
    };
    return normalizeCreatorGenerationProfile('story', settings);
  }

  private project(
    workId: string,
    source: Awaited<ReturnType<StoryGenerationProfileService['latestCompletedSource']>>,
    profile: Parameters<typeof creatorGenerationProfileProjection>[0],
  ) {
    return {
      workId,
      manuscript: {
        id: source.manuscript.id,
        version: source.manuscript.version,
        locale: source.manuscript.locale,
        contentHash: source.manuscript.contentHash,
      },
      analysis: {
        id: source.analysis.id,
        version: source.analysis.analysisVersion,
        complete: true,
      },
      profile: creatorGenerationProfileProjection(profile),
    };
  }

  private sourceFingerprint(source: Awaited<ReturnType<StoryGenerationProfileService['latestCompletedSource']>>) {
    return createHash('sha256').update(stableJson({
      workId: source.work.id,
      manuscriptVersionId: source.manuscript.id,
      contentHash: source.manuscript.contentHash,
      analysisJobId: source.analysis.id,
      analysisVersion: source.analysis.analysisVersion,
      analysisConfigHash: source.analysis.configHash,
    })).digest('hex');
  }

  private manuscriptParts(value: Prisma.JsonValue) {
    const root = this.record(value);
    const rawParts = Array.isArray(root.parts) ? root.parts : [];
    return rawParts.map((raw) => {
      const part = this.record(raw);
      return { paragraphs: Array.isArray(part.paragraphs) ? part.paragraphs.length : 0 };
    });
  }

  private observation(row: ProfileEvidenceRow) {
    const payload = this.record(row.payload);
    return {
      title: this.text(payload.title, 120) || row.evidenceType,
      detail: this.text(payload.observation, 1200) || '',
      sourceRef: `analysis:${row.id}`,
    };
  }

  private evidence(row: ProfileEvidenceRow): CreatorGenerationProfileEvidence {
    const payload = this.record(row.payload);
    return {
      sourceType: 'manuscript',
      sourceRef: `analysis:${row.id}:${row.sourcePartKey}:${row.sourceParagraphIndex}`.slice(0, 300),
      summary: this.text(payload.observation, 1000) || this.text(payload.title, 120) || row.evidenceType,
    };
  }

  private summary(rows: ProfileEvidenceRow[], fallback: string) {
    const observations = this.spread(rows, 3)
      .map((row) => this.text(this.record(row.payload).observation, 320))
      .filter((value): value is string => Boolean(value));
    return observations.length ? observations.join(' ') : fallback;
  }

  private styleCategories(rows: ProfileEvidenceRow[]) {
    const categories = new Map<string, string[]>();
    for (const row of this.spread(rows, 40)) {
      const payload = this.record(row.payload);
      const category = this.text(payload.styleCategory, 40) || 'other';
      const observation = this.text(payload.observation, 500);
      if (!observation) continue;
      const values = categories.get(category) ?? [];
      if (values.length < 8) values.push(observation);
      categories.set(category, values);
    }
    return [...categories].map(([category, observations]) => ({ category, observations }));
  }

  private spread<T>(items: T[], limit: number) {
    if (items.length <= limit) return items;
    const selected: T[] = [];
    for (let index = 0; index < limit; index += 1) {
      selected.push(items[Math.round(index * (items.length - 1) / (limit - 1))]);
    }
    return selected;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private text(value: unknown, maximum: number) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text && text.length <= maximum ? text : text.slice(0, maximum).trim() || null;
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
