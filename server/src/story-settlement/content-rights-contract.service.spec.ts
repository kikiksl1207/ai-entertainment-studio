import { HttpException } from '@nestjs/common';
import {
  ApprovalState,
  ContentContractConfiguration,
  ContentContractRecord,
  CreateContentContractInput,
  INTERNAL_GENERATION_COST_TREATMENT,
} from './content-rights-contract.contract';
import { ContentRightsContractRepository } from './content-rights-contract.repository';
import { ContentRightsContractService } from './content-rights-contract.service';

const adminId = '00000000-0000-4000-8000-000000001890';
const ownerId = '00000000-0000-4000-8000-000000001894';
const agencyId = '00000000-0000-4000-8000-000000001895';
const outsiderId = '00000000-0000-4000-8000-000000001896';
const workId = '00000000-0000-4000-8000-000000001892';
const contentVersionId = '00000000-0000-4000-8000-000000001893';

function body(creatorRole: 'author' | 'rights_holder' = 'rights_holder') {
  return {
    workType: 'ott', workId, contentVersionId, exclusivity: 'exclusive',
    media: ['ott_streaming'], regions: ['WORLDWIDE'],
    startsAt: '2026-10-01T00:00:00Z', endsAt: null,
    saleAllowed: true, aiTransformationAllowed: true, generatedResultReuseAllowed: false,
    effectiveFrom: '2026-10-01T00:00:00Z', authorRightsHolderShareBps: 3000,
    salesAgencyShareBps: 1000, pointUsagePolicy: 'unresolved',
    refundReversalPolicy: 'unresolved', paidPointPolicy: 'unresolved',
    bonusPointPolicy: 'unresolved', vatPolicy: 'unresolved',
    internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT,
    parties: [
      { role: creatorRole, userId: ownerId },
      { role: 'sales_agency', userId: agencyId, agencyIdentifier: 'agency:global-01' },
    ],
  };
}

class MemoryRepository extends ContentRightsContractRepository {
  record: ContentContractRecord | null = null;
  sequence = 0;

  async create(actorUserId: string, input: CreateContentContractInput) {
    const createdAt = new Date('2026-09-21T00:00:00Z');
    this.record = {
      id: '00000000-0000-4000-8000-000000001899',
      workType: input.workType,
      workId: input.workId,
      createdByUserId: actorUserId,
      createdAt,
      versions: [this.version(actorUserId, null, 1, 'draft', input)],
      audits: [],
    };
    this.audit(actorUserId, 'created');
    return this.record;
  }

  async revise(actorUserId: string, contractId: string, sourceVersionId: string, configuration: ContentContractConfiguration) {
    const record = this.required(contractId);
    const latest = record.versions[record.versions.length - 1];
    if (latest.id !== sourceVersionId) throw new HttpException({ code: 'CONTENT_RIGHTS_CONFLICT' }, 409);
    record.versions.push(this.version(actorUserId, sourceVersionId, latest.revision + 1, 'draft', configuration));
    this.audit(actorUserId, 'revised');
    return record;
  }

  async approve(actorUserId: string, contractId: string, sourceVersionId: string) {
    const record = this.required(contractId);
    const latest = record.versions[record.versions.length - 1];
    if (latest.id !== sourceVersionId || latest.approvalState !== 'draft') {
      throw new HttpException({ code: 'CONTENT_RIGHTS_CONFLICT' }, 409);
    }
    record.versions.push(this.version(actorUserId, sourceVersionId, latest.revision + 1, 'approved_configuration', latest));
    this.audit(actorUserId, 'approved_configuration');
    return record;
  }

  async findById(contractId: string) { return this.record?.id === contractId ? this.record : null; }
  async listAll() { return this.record ? [this.record] : []; }
  async listForParty(userId: string) {
    return this.record?.versions.some((version) => version.parties.some((party) => party.userId === userId))
      ? [this.record] : [];
  }

  private required(contractId: string) {
    if (!this.record || this.record.id !== contractId) throw new HttpException({}, 404);
    return this.record;
  }

  private version(
    actorUserId: string,
    sourceVersionId: string | null,
    revision: number,
    approvalState: ApprovalState,
    configuration: ContentContractConfiguration,
  ) {
    return {
      ...configuration,
      id: `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, '0')}`,
      contractId: '00000000-0000-4000-8000-000000001899',
      revision,
      sourceVersionId,
      approvalState,
      createdByUserId: actorUserId,
      approvedByUserId: approvalState === 'approved_configuration' ? actorUserId : null,
      createdAt: new Date(`2026-09-21T00:00:0${revision}Z`),
    };
  }

  private audit(actorUserId: string, action: ContentContractRecord['audits'][number]['action']) {
    const version = this.record!.versions[this.record!.versions.length - 1];
    this.record!.audits.push({
      id: `00000000-0000-4000-8001-${String(this.sequence).padStart(12, '0')}`,
      contractVersionId: version.id,
      action,
      actorUserId,
      snapshotHash: 'a'.repeat(64),
      createdAt: version.createdAt,
    });
  }
}

describe('ContentRightsContractService', () => {
  let repository: MemoryRepository;
  let service: ContentRightsContractService;

  beforeEach(() => {
    repository = new MemoryRepository();
    service = new ContentRightsContractService(repository);
  });

  it('appends revision and approval snapshots without rewriting history', async () => {
    const created = await service.create(adminId, body());
    const first = created.versions[0];
    const revisionBody = { ...body(), sourceVersionId: first.id, saleAllowed: false };
    delete (revisionBody as Partial<typeof revisionBody>).workType;
    delete (revisionBody as Partial<typeof revisionBody>).workId;
    const revised = await service.revise(adminId, created.id, revisionBody);
    const second = revised.versions[1];
    const approved = await service.approve(adminId, created.id, { sourceVersionId: second.id });

    expect(approved.versions.map((version) => [version.revision, version.approvalState, version.saleAllowed])).toEqual([
      [1, 'draft', true],
      [2, 'draft', false],
      [3, 'approved_configuration', false],
    ]);
    expect(approved.audits.map((audit) => audit.action)).toEqual([
      'created', 'revised', 'approved_configuration',
    ]);
    expect(first.saleAllowed).toBe(true);
  });

  it.each([
    ['author', ownerId, 3000, agencyId],
    ['rights_holder', ownerId, 3000, agencyId],
    ['sales_agency', agencyId, 1000, ownerId],
  ] as const)('returns only the %s party and its own percentage', async (role, userId, shareBps, otherPartyId) => {
    const created = await service.create(adminId, body(role === 'author' ? 'author' : 'rights_holder'));
    const result = await service.getForParty(userId, created.id);
    const listed = await service.listForParty(userId);
    expect(result.versions).toHaveLength(1);
    expect(Object.keys(result).sort()).toEqual(['id', 'versions', 'workId', 'workType']);
    expect(Object.keys(result.versions[0]).sort()).toEqual([
      'aiTransformationAllowed',
      'approvalState',
      'contentVersionId',
      'effectiveFrom',
      'endsAt',
      'exclusivity',
      'generatedResultReuseAllowed',
      'id',
      'media',
      'parties',
      'regions',
      'revision',
      'saleAllowed',
      'startsAt',
    ]);
    expect(result.versions[0].parties).toEqual([{
      role,
      userId,
      agencyIdentifier: role === 'sales_agency' ? 'agency:global-01' : null,
      shareBps,
    }]);
    for (const response of [result, listed.items[0]]) {
      const rawJson = JSON.stringify(response);
      expect(rawJson).not.toContain(otherPartyId);
      expect(rawJson).not.toMatch(
        /"shares"|"companyBps"|"policy"|"internalGenerationCostTreatment"|"audits"|"boundary"|"createdAt"|"createdByUserId"|"approvedByUserId"|"actorUserId"|"snapshotHash"|"sourceVersionId"/,
      );
    }
  });

  it('keeps the full allocation, parties, costs, and audit fields in admin responses', async () => {
    const result = await service.create(adminId, body());
    expect(result.versions[0]).toMatchObject({
      shares: { authorRightsHolderBps: 3000, salesAgencyBps: 1000, companyBps: 6000 },
      policy: { internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT },
      parties: [
        { role: 'rights_holder', userId: ownerId },
        { role: 'sales_agency', userId: agencyId },
      ],
      createdByUserId: adminId,
    });
    expect(result.audits[0]).toMatchObject({ actorUserId: adminId, snapshotHash: 'a'.repeat(64) });
    expect(result.boundary).toBeDefined();
  });

  it('denies unrelated authenticated users', async () => {
    const created = await service.create(adminId, body());
    await expect(service.getForParty(outsiderId, created.id)).rejects.toMatchObject({
      response: { code: 'CONTENT_RIGHTS_FORBIDDEN' },
    });
  });

  it('does not expose later revisions to a removed sales agency', async () => {
    const created = await service.create(adminId, body());
    const revisionBody = {
      ...body(),
      sourceVersionId: created.versions[0].id,
      salesAgencyShareBps: 0,
      parties: [{ role: 'rights_holder', userId: ownerId }],
    };
    delete (revisionBody as Partial<typeof revisionBody>).workType;
    delete (revisionBody as Partial<typeof revisionBody>).workId;
    await service.revise(adminId, created.id, revisionBody);

    expect((await service.getForParty(ownerId, created.id)).versions).toHaveLength(2);
    expect((await service.getForParty(agencyId, created.id)).versions).toHaveLength(1);
    expect(await service.getForParty(agencyId, created.id)).not.toHaveProperty('audits');
  });

  it('returns configuration only and never payout or raw contract fields', async () => {
    const result = await service.create(adminId, body());
    expect(result.boundary).toMatchObject({ payoutMutation: false, settlementAccrualMutation: false });
    expect(JSON.stringify(result)).not.toMatch(/rawContract|bankAccount|taxId|payoutId/);
  });
});
