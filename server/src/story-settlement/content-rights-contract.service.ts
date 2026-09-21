import { Injectable } from '@nestjs/common';
import {
  CONTENT_RIGHTS_CONFIGURATION_BOUNDARY,
  ContentContractRecord,
  contentRightsError,
  parseContentContractApproval,
  parseContentContractId,
  parseContentContractRevision,
  parseCreateContentContract,
} from './content-rights-contract.contract';
import { ContentRightsContractRepository } from './content-rights-contract.repository';

@Injectable()
export class ContentRightsContractService {
  constructor(private readonly repository: ContentRightsContractRepository) {}

  async create(actorUserId: string, body: unknown) {
    const contract = await this.repository.create(actorUserId, parseCreateContentContract(body));
    return this.present(contract, true);
  }

  async revise(actorUserId: string, contractIdValue: string, body: unknown) {
    const contractId = parseContentContractId(contractIdValue);
    const input = parseContentContractRevision(body);
    const contract = await this.repository.revise(
      actorUserId,
      contractId,
      input.sourceVersionId,
      input.configuration,
    );
    return this.present(contract, true);
  }

  async approve(actorUserId: string, contractIdValue: string, body: unknown) {
    const contractId = parseContentContractId(contractIdValue);
    const input = parseContentContractApproval(body);
    const contract = await this.repository.approve(actorUserId, contractId, input.sourceVersionId);
    return this.present(contract, true);
  }

  async getAdmin(contractIdValue: string) {
    const contract = await this.repository.findById(parseContentContractId(contractIdValue));
    if (!contract) contentRightsError('NOT_FOUND');
    return this.present(contract, true);
  }

  async listAdmin() {
    const contracts = await this.repository.listAll();
    return { items: contracts.map((contract) => this.present(contract, true)) };
  }

  async getForParty(userId: string, contractIdValue: string) {
    const contract = await this.repository.findById(parseContentContractId(contractIdValue));
    if (!contract) contentRightsError('NOT_FOUND');
    if (!contract.versions.some((version) => version.parties.some((party) => party.userId === userId))) {
      contentRightsError('FORBIDDEN');
    }
    return this.present(contract, false, userId);
  }

  async listForParty(userId: string) {
    const contracts = await this.repository.listForParty(userId);
    return { items: contracts.map((contract) => this.present(contract, false, userId)) };
  }

  private present(contract: ContentContractRecord, admin: boolean, partyUserId?: string) {
    const ownerParty = partyUserId
      ? contract.versions.some((version) => version.parties.some((party) =>
        party.userId === partyUserId && (party.role === 'author' || party.role === 'rights_holder'),
      ))
      : false;
    const visibleVersions = admin || ownerParty
      ? contract.versions
      : contract.versions.filter((version) =>
        version.parties.some((party) => party.userId === partyUserId),
      );
    const visibleVersionIds = new Set(visibleVersions.map((version) => version.id));
    return {
      id: contract.id,
      workType: contract.workType,
      workId: contract.workId,
      createdAt: contract.createdAt,
      ...(admin ? { createdByUserId: contract.createdByUserId } : {}),
      versions: visibleVersions.map((version) => ({
        id: version.id,
        revision: version.revision,
        sourceVersionId: version.sourceVersionId,
        contentVersionId: version.contentVersionId,
        exclusivity: version.exclusivity,
        media: version.media,
        regions: version.regions,
        startsAt: version.startsAt,
        endsAt: version.endsAt,
        saleAllowed: version.saleAllowed,
        aiTransformationAllowed: version.aiTransformationAllowed,
        generatedResultReuseAllowed: version.generatedResultReuseAllowed,
        approvalState: version.approvalState,
        effectiveFrom: version.effectiveFrom,
        shares: {
          authorRightsHolderBps: version.authorRightsHolderShareBps,
          salesAgencyBps: version.salesAgencyShareBps,
          companyBps: version.companyShareBps,
        },
        policy: {
          pointUsage: version.pointUsagePolicy,
          refundReversal: version.refundReversalPolicy,
          paidPoints: version.paidPointPolicy,
          bonusPoints: version.bonusPointPolicy,
          vat: version.vatPolicy,
          internalGenerationCostTreatment: version.internalGenerationCostTreatment,
        },
        parties: version.parties,
        createdAt: version.createdAt,
        ...(admin ? {
          createdByUserId: version.createdByUserId,
          approvedByUserId: version.approvedByUserId,
        } : {}),
      })),
      audits: contract.audits.filter((audit) => admin || ownerParty || visibleVersionIds.has(audit.contractVersionId)).map((audit) => ({
        id: audit.id,
        contractVersionId: audit.contractVersionId,
        action: audit.action,
        createdAt: audit.createdAt,
        ...(admin ? { actorUserId: audit.actorUserId, snapshotHash: audit.snapshotHash } : {}),
      })),
      boundary: CONTENT_RIGHTS_CONFIGURATION_BOUNDARY,
    };
  }
}
