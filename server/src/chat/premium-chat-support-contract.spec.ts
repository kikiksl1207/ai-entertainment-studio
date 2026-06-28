import {
  PREMIUM_CHAT_SUPPORT_CONTRACT,
  PREMIUM_CHAT_SUPPORT_LEDGER_PROJECTION_CONTRACT,
} from './premium-chat-support-contract';

describe('PREMIUM_CHAT_SUPPORT_LEDGER_PROJECTION_CONTRACT', () => {
  it('is exposed from the premium chat support contract', () => {
    expect(PREMIUM_CHAT_SUPPORT_CONTRACT.ledgerProjection).toBe(
      PREMIUM_CHAT_SUPPORT_LEDGER_PROJECTION_CONTRACT,
    );
  });

  it('keeps donation and like ranking lanes separated', () => {
    const { rankingSeparation } =
      PREMIUM_CHAT_SUPPORT_LEDGER_PROJECTION_CONTRACT;

    expect(rankingSeparation.donationRankingBasis).toBe(
      'confirmed_net_premium_chat_support_only',
    );
    expect(rankingSeparation.likeRankingReceivesSupport).toBe(false);
    expect(rankingSeparation.boostRankingReceivesSupport).toBe(false);
    expect(rankingSeparation.clientSubmittedScoreTrusted).toBe(false);
  });

  it('hides raw ledger and private user fields from read projections', () => {
    const { privacy } = PREMIUM_CHAT_SUPPORT_LEDGER_PROJECTION_CONTRACT;

    expect(privacy.rawDonationOrderIdReturned).toBe(false);
    expect(privacy.rawWalletLedgerIdReturned).toBe(false);
    expect(privacy.rawSupportPointLedgerIdReturned).toBe(false);
    expect(privacy.rawSupportMessageReturned).toBe(false);
    expect(privacy.rawUserEmailReturned).toBe(false);
  });

  it('does not enable wallet, settlement, payout, or ranking mutations', () => {
    const { noMutation } = PREMIUM_CHAT_SUPPORT_LEDGER_PROJECTION_CONTRACT;

    expect(noMutation.donationCreate).toBe(true);
    expect(noMutation.supportPointLedgerWrite).toBe(true);
    expect(noMutation.walletDebit).toBe(true);
    expect(noMutation.walletCredit).toBe(true);
    expect(noMutation.rankingSnapshotWrite).toBe(true);
    expect(noMutation.settlement).toBe(true);
    expect(noMutation.payout).toBe(true);
  });
});
