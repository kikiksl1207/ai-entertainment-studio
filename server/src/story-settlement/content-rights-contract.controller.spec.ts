import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ADMIN_PERMISSIONS_KEY } from '../auth/decorators/admin-permissions.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AdminContentRightsContractController,
  PartyContentRightsContractController,
} from './content-rights-contract.controller';

describe('content rights contract route authorization', () => {
  it('requires admin authentication and write permission for every mutation', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminContentRightsContractController)).toEqual([
      AdminAuthGuard,
      AdminPermissionGuard,
    ]);
    for (const method of ['create', 'revise', 'approve'] as const) {
      expect(Reflect.getMetadata(
        ADMIN_PERMISSIONS_KEY,
        AdminContentRightsContractController.prototype[method],
      )).toEqual(['settlements:write']);
    }
  });

  it('exposes participant reads only behind authenticated user guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PartyContentRightsContractController)).toEqual([
      JwtAuthGuard,
    ]);
    expect(PartyContentRightsContractController.prototype).not.toHaveProperty('create');
    expect(PartyContentRightsContractController.prototype).not.toHaveProperty('approve');
  });
});
