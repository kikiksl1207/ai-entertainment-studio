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
    return this.presentAdmin(contract);
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
    return this.presentAdmin(contract);
  }

  async approve(actorUserId: string, contractIdValue: string, body: unknown) {
    const contractId = parseContentContractId(contractIdValue);
    const input = parseContentContractApproval(body);
    const contract = await this.repository.approve(actorUserId, contractId, input.sourceVersionId);
    return this.presentAdmin(contract);
  }

  async getAdmin(contractIdValue: string) {
    const contract = await this.repository.findById(parseContentContractId(contractIdValue));
    if (!contract) contentRightsError('NOT_FOUND');
    return this.presentAdmin(contract);
  }

  async listAdmin() {
    const contracts = await this.repository.listAll();
    return { items: contracts.map((contract) => this.presentAdmin(contract)) };
  }

  async getForParty(userId: string, contractIdValue: string) {
    const contract = await this.repository.findById(parseContentContractId(contractIdValue));
    if (!contract) contentRightsError('NOT_FOUND');
    if (!contract.versions.some((version) => version.parties.some((party) => party.userId === userId))) {
      contentRightsError('FORBIDDEN');
    }
    return this.presentParty(contract, userId);
  }

  async listForParty(userId: string) {
    const contracts = await this.repository.listForParty(userId);
    return { items: contracts.map((contract) => this.presentParty(contract, userId)) };
  }

  private presentAdmin(contract: ContentContractRecord) {
    return {
      id: contract.id,
      workType: contract.workType,
      workId: contract.workId,
      createdAt: contract.createdAt,
      createdByUserId: contract.createdByUserId,
      versions: contract.versions.map((version) => ({
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
        createdByUserId: version.createdByUserId,
        approvedByUserId: version.approvedByUserId,
      })),
      audits: contract.audits.map((audit) => ({
        id: audit.id,
        contractVersionId: audit.contractVersionId,
        action: audit.action,
        createdAt: audit.createdAt,
        actorUserId: audit.actorUserId,
        snapshotHash: audit.snapshotHash,
      })),
      boundary: CONTENT_RIGHTS_CONFIGURATION_BOUNDARY,
    };
  }

  private presentParty(contract: ContentContractRecord, partyUserId: string) {
    return {
      id: contract.id,
      workType: contract.workType,
      workId: contract.workId,
      versions: contract.versions.flatMap((version) => {
        const ownParties = version.parties
          .filter((party) => party.userId === partyUserId)
          .map((party) => ({
            role: party.role,
            userId: party.userId,
            agencyIdentifier: party.agencyIdentifier,
            shareBps: party.role === 'sales_agency'
              ? version.salesAgencyShareBps
              : version.authorRightsHolderShareBps,
          }));
        if (ownParties.length === 0) return [];
        return [{
          id: version.id,
          revision: version.revision,
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
          parties: ownParties,
        }];
      }),
    };
  }
}
