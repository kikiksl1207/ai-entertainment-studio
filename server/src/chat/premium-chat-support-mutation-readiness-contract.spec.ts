import { PREMIUM_CHAT_SUPPORT_MUTATION_READINESS_CONTRACT } from './premium-chat-support-mutation-readiness-contract';

describe('premium chat support mutation readiness contract', () => {
  it('keeps current support mutation disabled while read-only surfaces are ready', () => {
    expect(PREMIUM_CHAT_SUPPORT_MUTATION_READINESS_CONTRACT).toMatchObject({
      feature: 'premium_chat_support_mutation',
      currentStatus: 'readiness_contract_only',
      mutationEndpoint: {
        method: 'POST',
        path: '/api/v1/chat/premium-rooms/:roomId/support-messages',
        publicRouteEnabled: false,
        requiresIdempotencyKey: true,
        serverAmountAuthority: 'server_normalized_premium_chat_support_amount',
        clientSubmittedAmountTrusted: false,
      },
    });
    expect(
      PREMIUM_CHAT_SUPPORT_MUTATION_READINESS_CONTRACT.readOnlySurfacesReady,
    ).toEqual(
      expect.arrayContaining([
        'GET /api/v1/chat/premium-support-contract',
        'support ranking and ledger projection contracts',
      ]),
    );
  });

  it('requires wallet, support ledger, moderation, and refund guards before enablement', () => {
    expect(
      PREMIUM_CHAT_SUPPORT_MUTATION_READINESS_CONTRACT.requiredBeforeEnablement,
    ).toEqual(
      expect.arrayContaining([
        'wallet debit ledger and premium support domain record same transaction',
        'support point ledger write idempotency',
        'room status supportability check',
        'message moderation placeholder policy',
        'refund and chargeback exclusion from support ranking',
      ]),
    );
    expect(
      Object.values(
        PREMIUM_CHAT_SUPPORT_MUTATION_READINESS_CONTRACT.noMutationUntilEnabled,
      ),
    ).not.toContain(false);
  });

  it('does not expose private identifiers or auth material in responses', () => {
    expect(PREMIUM_CHAT_SUPPORT_MUTATION_READINESS_CONTRACT.responsePolicy).toMatchObject({
      returnsRawWalletLedgerId: false,
      returnsRawSupportPointLedgerId: false,
      returnsRawEmail: false,
      returnsToken: false,
      returnsCookie: false,
    });
  });
});
