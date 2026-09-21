import { Module } from '@nestjs/common';
import {
  AdminContentRightsContractController,
  PartyContentRightsContractController,
} from './content-rights-contract.controller';
import {
  ContentRightsContractRepository,
  PrismaContentRightsContractRepository,
} from './content-rights-contract.repository';
import { ContentRightsContractService } from './content-rights-contract.service';

@Module({
  controllers: [AdminContentRightsContractController, PartyContentRightsContractController],
  providers: [
    ContentRightsContractService,
    { provide: ContentRightsContractRepository, useClass: PrismaContentRightsContractRepository },
  ],
})
export class ContentRightsContractModule {}
