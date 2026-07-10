import { WALLET_READONLY_QA_FIXTURE_CONTRACT } from './wallet-readonly-qa-fixture-contract';

describe('wallet read-only QA fixture contract', () => {
  it('covers balance product bonus pending failed and refunded wallet states', () => {
    expect(WALLET_READONLY_QA_FIXTURE_CONTRACT.states.map((item) => item.walletStateKey)).toEqual([
      'balance_ready',
      'products_ready',
      'first_charge_bonus_available',
      'payment_pending',
      'payment_failed',
      'payment_refunded',
    ]);
    expect(WALLET_READONLY_QA_FIXTURE_CONTRACT.allowedOutput).toEqual(
      expect.arrayContaining([
        'runId',
        'fixtureStatus',
        'walletStateKey',
        'publicPath',
        'paymentStatusKey',
      ]),
    );
  });

  it('does not open payment provider refund or ledger mutation paths', () => {
    expect(WALLET_READONLY_QA_FIXTURE_CONTRACT.mutationPolicy).toMatchObject({
      walletDebit: false,
      walletCredit: false,
      paymentOrderCreate: false,
      paymentProviderCall: false,
      refundMutation: false,
      walletLedgerWrite: false,
      settlementMutation: false,
      payoutMutation: false,
    });
    expect(WALLET_READONLY_QA_FIXTURE_CONTRACT.allowedOutput.join(' ')).not.toMatch(
      /transaction id|ledger id|provider payment key|provider payload|API key|database URL|raw user id/i,
    );
  });
});
