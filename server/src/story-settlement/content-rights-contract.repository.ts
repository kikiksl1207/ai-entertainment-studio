import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApprovalState,
  ContentContractConfiguration,
  ContentContractRecord,
  ContentContractVersion,
  ContentWorkType,
  CreateContentContractInput,
  assertCreatorPartyMatchesOwner,
  contentRightsError,
} from './content-rights-contract.contract';

export abstract class ContentRightsContractRepository {
  abstract create(actorUserId: string, input: CreateContentContractInput): Promise<ContentContractRecord>;
  abstract revise(
    actorUserId: string,
    contractId: string,
    sourceVersionId: string,
    configuration: ContentContractConfiguration,
  ): Promise<ContentContractRecord>;
  abstract approve(actorUserId: string, contractId: string, sourceVersionId: string): Promise<ContentContractRecord>;
  abstract findById(contractId: string): Promise<ContentContractRecord | null>;
  abstract listAll(): Promise<ContentContractRecord[]>;
  abstract listForParty(userId: string): Promise<ContentContractRecord[]>;
}

type StoredParty = {
  role: string;
  userId: string;
  agencyIdentifier: string | null;
};

type StoredVersion = {
  id: string;
  contractId: string;
  revision: number;
  sourceVersionId: string | null;
  contentVersionId: string;
  exclusivity: string;
  media: unknown;
  regions: unknown;
  startsAt: Date;
  endsAt: Date | null;
  saleAllowed: boolean;
  aiTransformationAllowed: boolean;
  generatedResultReuseAllowed: boolean;
  approvalState: string;
  effectiveFrom: Date;
  authorRightsHolderShareBps: number;
  salesAgencyShareBps: number;
  companyShareBps: number;
  pointUsagePolicy: string;
  refundReversalPolicy: string;
  paidPointPolicy: string;
  bonusPointPolicy: string;
  vatPolicy: string;
  internalGenerationCostTreatment: string;
  createdByUserId: string;
  approvedByUserId: string | null;
  createdAt: Date;
  parties: StoredParty[];
};

type StoredContract = {
  id: string;
  workType: string;
  workId: string;
  createdByUserId: string;
  createdAt: Date;
  versions: StoredVersion[];
  audits: Array<{
    id: string;
    contractVersionId: string;
    action: string;
    actorUserId: string;
    snapshotHash: string;
    createdAt: Date;
  }>;
};

const contractInclude = {
  versions: {
    include: { parties: { orderBy: [{ role: 'asc' as const }, { userId: 'asc' as const }] } },
    orderBy: { revision: 'asc' as const },
  },
  audits: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
};

@Injectable()
export class PrismaContentRightsContractRepository extends ContentRightsContractRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(actorUserId: string, input: CreateContentContractInput) {
    try {
      const contractId = await this.prisma.$transaction(async (tx) => {
        const ownerUserId = await this.assertTarget(tx, input.workType, input.workId, input.contentVersionId);
        await this.assertParties(tx, ownerUserId, input);
        const contract = await tx.contentRightsContract.create({
          data: {
            workType: input.workType,
            workId: input.workId,
            createdByUserId: actorUserId,
          },
        });
        await this.append(tx, contract.id, actorUserId, null, 1, 'draft', input, 'created');
        return contract.id;
      });
      return this.requireContract(contractId);
    } catch (error) {
      return this.persistenceError(error);
    }
  }

  async revise(
    actorUserId: string,
    contractId: string,
    sourceVersionId: string,
    configuration: ContentContractConfiguration,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM content_rights_contracts WHERE id=${contractId}::uuid FOR UPDATE`);
        const contract = await tx.contentRightsContract.findUnique({ where: { id: contractId } });
        if (!contract) contentRightsError('NOT_FOUND');
        const latest = await tx.contentRightsContractVersion.findFirst({
          where: { contractId },
          orderBy: { revision: 'desc' },
        });
        if (!latest || latest.id !== sourceVersionId) contentRightsError('CONFLICT');
        const ownerUserId = await this.assertTarget(
          tx,
          contract.workType as ContentWorkType,
          contract.workId,
          configuration.contentVersionId,
        );
        await this.assertParties(tx, ownerUserId, configuration);
        await this.append(
          tx,
          contractId,
          actorUserId,
          sourceVersionId,
          latest.revision + 1,
          'draft',
          configuration,
          'revised',
        );
      });
      return this.requireContract(contractId);
    } catch (error) {
      return this.persistenceError(error);
    }
  }

  async approve(actorUserId: string, contractId: string, sourceVersionId: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM content_rights_contracts WHERE id=${contractId}::uuid FOR UPDATE`);
        const latest = await tx.contentRightsContractVersion.findFirst({
          where: { contractId },
          include: { parties: { orderBy: [{ role: 'asc' }, { userId: 'asc' }] } },
          orderBy: { revision: 'desc' },
        });
        if (!latest) contentRightsError('NOT_FOUND');
        if (latest.id !== sourceVersionId || latest.approvalState !== 'draft') contentRightsError('CONFLICT');
        await this.append(
          tx,
          contractId,
          actorUserId,
          sourceVersionId,
          latest.revision + 1,
          'approved_configuration',
          this.configuration(latest as StoredVersion),
          'approved_configuration',
        );
      });
      return this.requireContract(contractId);
    } catch (error) {
      return this.persistenceError(error);
    }
  }

  async findById(contractId: string) {
    const row = await this.prisma.contentRightsContract.findUnique({
      where: { id: contractId },
      include: contractInclude,
    });
    return row ? this.map(row as unknown as StoredContract) : null;
  }

  async listAll() {
    const rows = await this.prisma.contentRightsContract.findMany({
      include: contractInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map((row) => this.map(row as unknown as StoredContract));
  }

  async listForParty(userId: string) {
    const rows = await this.prisma.contentRightsContract.findMany({
      where: { versions: { some: { parties: { some: { userId } } } } },
      include: contractInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map((row) => this.map(row as unknown as StoredContract));
  }

  private async requireContract(contractId: string) {
    const contract = await this.findById(contractId);
    if (!contract) contentRightsError('PERSISTENCE_UNAVAILABLE');
    return contract;
  }

  private async assertTarget(
    tx: Prisma.TransactionClient,
    workType: ContentWorkType,
    workId: string,
    contentVersionId: string,
  ) {
    if (workType === 'story') {
      const work = await tx.storyWork.findUnique({ where: { id: workId }, select: { ownerUserId: true } });
      const version = await tx.storyManuscriptVersion.findFirst({
        where: { id: contentVersionId, workId, ownerUserId: work?.ownerUserId },
        select: { id: true },
      });
      if (!work || !version) contentRightsError('NOT_FOUND');
      return work.ownerUserId;
    }
    const version = await tx.ottMediaVersion.findFirst({
      where: { id: contentVersionId, workId, work: { id: workId } },
      select: { work: { select: { ownerId: true } } },
    });
    if (!version) contentRightsError('NOT_FOUND');
    return version.work.ownerId;
  }

  private async assertParties(
    tx: Prisma.TransactionClient,
    ownerUserId: string,
    configuration: ContentContractConfiguration,
  ) {
    assertCreatorPartyMatchesOwner(ownerUserId, configuration);
    const userIds = [...new Set(configuration.parties.map((party) => party.userId))];
    const count = await tx.user.count({ where: { id: { in: userIds }, status: 'active' } });
    if (count !== userIds.length) contentRightsError('NOT_FOUND');
  }

  private async append(
    tx: Prisma.TransactionClient,
    contractId: string,
    actorUserId: string,
    sourceVersionId: string | null,
    revision: number,
    approvalState: ApprovalState,
    configuration: ContentContractConfiguration,
    action: 'created' | 'revised' | 'approved_configuration',
  ) {
    const version = await tx.contentRightsContractVersion.create({
      data: {
        contractId,
        revision,
        sourceVersionId,
        contentVersionId: configuration.contentVersionId,
        exclusivity: configuration.exclusivity,
        media: configuration.media,
        regions: configuration.regions,
        startsAt: configuration.startsAt,
        endsAt: configuration.endsAt,
        saleAllowed: configuration.saleAllowed,
        aiTransformationAllowed: configuration.aiTransformationAllowed,
        generatedResultReuseAllowed: configuration.generatedResultReuseAllowed,
        approvalState,
        effectiveFrom: configuration.effectiveFrom,
        authorRightsHolderShareBps: configuration.authorRightsHolderShareBps,
        salesAgencyShareBps: configuration.salesAgencyShareBps,
        companyShareBps: configuration.companyShareBps,
        pointUsagePolicy: configuration.pointUsagePolicy,
        refundReversalPolicy: configuration.refundReversalPolicy,
        paidPointPolicy: configuration.paidPointPolicy,
        bonusPointPolicy: configuration.bonusPointPolicy,
        vatPolicy: configuration.vatPolicy,
        internalGenerationCostTreatment: configuration.internalGenerationCostTreatment,
        createdByUserId: actorUserId,
        approvedByUserId: approvalState === 'approved_configuration' ? actorUserId : null,
        parties: {
          create: configuration.parties.map((party) => ({
            role: party.role,
            userId: party.userId,
            agencyIdentifier: party.agencyIdentifier,
          })),
        },
      },
    });
    await tx.contentRightsContractAudit.create({
      data: {
        contractId,
        contractVersionId: version.id,
        actorUserId,
        action,
        snapshotHash: snapshotHash(configuration, approvalState),
      },
    });
  }

  private configuration(row: StoredVersion): ContentContractConfiguration {
    return {
      contentVersionId: row.contentVersionId,
      exclusivity: row.exclusivity as ContentContractConfiguration['exclusivity'],
      media: row.media as ContentContractConfiguration['media'],
      regions: row.regions as string[],
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      saleAllowed: row.saleAllowed,
      aiTransformationAllowed: row.aiTransformationAllowed,
      generatedResultReuseAllowed: row.generatedResultReuseAllowed,
      effectiveFrom: row.effectiveFrom,
      authorRightsHolderShareBps: row.authorRightsHolderShareBps,
      salesAgencyShareBps: row.salesAgencyShareBps,
      companyShareBps: row.companyShareBps,
      pointUsagePolicy: row.pointUsagePolicy as ContentContractConfiguration['pointUsagePolicy'],
      refundReversalPolicy: row.refundReversalPolicy as ContentContractConfiguration['refundReversalPolicy'],
      paidPointPolicy: row.paidPointPolicy as ContentContractConfiguration['paidPointPolicy'],
      bonusPointPolicy: row.bonusPointPolicy as ContentContractConfiguration['bonusPointPolicy'],
      vatPolicy: row.vatPolicy as ContentContractConfiguration['vatPolicy'],
      internalGenerationCostTreatment: row.internalGenerationCostTreatment as ContentContractConfiguration['internalGenerationCostTreatment'],
      parties: row.parties as ContentContractConfiguration['parties'],
    };
  }

  private map(row: StoredContract): ContentContractRecord {
    return {
      id: row.id,
      workType: row.workType as ContentWorkType,
      workId: row.workId,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
      versions: row.versions.map((version) => ({
        ...this.configuration(version),
        id: version.id,
        contractId: version.contractId,
        revision: version.revision,
        sourceVersionId: version.sourceVersionId,
        approvalState: version.approvalState as ApprovalState,
        createdByUserId: version.createdByUserId,
        approvedByUserId: version.approvedByUserId,
        createdAt: version.createdAt,
      } satisfies ContentContractVersion)),
      audits: row.audits.map((audit) => ({
        ...audit,
        action: audit.action as ContentContractRecord['audits'][number]['action'],
      })),
    };
  }

  private persistenceError(error: unknown): never {
    if (error && typeof error === 'object' && 'getStatus' in error) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      contentRightsError('CONFLICT');
    }
    contentRightsError('PERSISTENCE_UNAVAILABLE');
  }
}

function snapshotHash(configuration: ContentContractConfiguration, approvalState: ApprovalState) {
  const value = {
    ...configuration,
    startsAt: configuration.startsAt.toISOString(),
    endsAt: configuration.endsAt?.toISOString() ?? null,
    effectiveFrom: configuration.effectiveFrom.toISOString(),
    approvalState,
  };
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
