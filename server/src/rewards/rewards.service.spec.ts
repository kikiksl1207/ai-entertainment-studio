import { RewardsService } from './rewards.service';

describe('RewardsService paid bonus ledger policy', () => {
  it('keeps first charge bonus one-time, base-only, and separate from package bonus', () => {
    const service = new RewardsService({} as never);

    expect(service.getRewardLedgerPolicy()).toMatchObject({
      capScopes: {
        paidBonus: {
          ledgerTypes: ['first_charge_bonus'],
          separatedFromFreePromoCap: true,
          firstChargeBonus: {
            bonusRate: 0.1,
            bonusPercent: 10,
            basisField: 'lumina_products.lumina_amount',
            packageBonusIncluded: false,
            grantTrigger: 'first_successful_paid_lumina_order_only',
            failedProviderEventsLockEligibility: false,
            idempotencyKeyPattern: 'first_charge_bonus:<userId>',
            duplicateBehavior:
              'wallet_ledger_upsert_replay_without_second_bonus_credit',
          },
        },
      },
      ledgerRules: {
        walletMutationRequired: true,
        walletAndLedgerSameTransaction: true,
        clientProvidedAmountAccepted: false,
        duplicateProtection: {
          walletLedgerIdempotencyKey: true,
          patterns: expect.arrayContaining(['first_charge_bonus:<userId>']),
        },
        settlementEligible: false,
        cashRefundable: false,
      },
    });
  });
});
