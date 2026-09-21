import 'reflect-metadata';
import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';

describe('Story purchase errors through the real HTTP exception filter', () => {
  it.each([
    ['REQUIRED', undefined, 'story.purchase.confirmationRequired'],
    ['STALE', { confirmedPriceLumina: '999', expectedReleaseId: 'release', expectedReleaseRevision: 2 },
      'story.purchase.confirmationStale'],
  ] as const)('preserves no-wallet-mutation details for %s', async (suffix, confirmation, messageKey) => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'reader', status: 'active', deleted_at: null }]),
      userEntitlement: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      walletLedger: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      walletAccount: { findUnique: jest.fn(), updateMany: jest.fn() },
      storyWork: { findUnique: jest.fn().mockResolvedValue({
        id: 'work', slug: 'published-story', status: 'published', publishedAt: new Date(0),
        fixtureSource: false, coverManifest: {}, activeReleaseId: 'release', releaseRevision: 2,
        priceLumina: new Decimal(120),
      }) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: 'release' }) },
    };
    const prisma = { $transaction: jest.fn().mockImplementation(run => run(tx)) };
    const service = new StoryProductionService(prisma as never);
    const controller = new StoryProductionController(service, {} as never);
    let thrown: unknown;
    try { await controller.purchase({ id: 'reader' } as never, 'work', 'purchase-http-key', confirmation); }
    catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      code: `STORY_PURCHASE_CONFIRMATION_${suffix}`, walletMutation: false,
    });

    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = { switchToHttp: () => ({
      getRequest: () => ({ url: '/stories/work/purchase', headers: {} }),
      getResponse: () => ({ status }),
    }) } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(thrown, host);

    expect(status).toHaveBeenCalledWith(409);
    const wire = JSON.parse(JSON.stringify(json.mock.calls[0][0]));
    expect(wire).toMatchObject({ success: false, error: {
      code: `STORY_PURCHASE_CONFIRMATION_${suffix}`, statusCode: 409, messageKey,
      details: { walletMutation: false },
    } });
    expect(wire.error.details).toEqual({ walletMutation: false });
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
    expect(tx.userEntitlement.upsert).not.toHaveBeenCalled();
  });
});
