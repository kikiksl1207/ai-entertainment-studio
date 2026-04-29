export type PaymentCheckoutPayload = {
  provider: string;
  orderNo: string;
  amount: string;
  currency: string;
  orderName: string;
  clientKey?: string;
  successUrl?: string;
  failUrl?: string;
};

export type ParsedPaymentWebhook = {
  orderNo: string;
  providerTransactionId: string;
  status: 'paid' | 'failed' | 'cancelled';
  amount: string;
  rawPayload: unknown;
};

export interface PaymentProviderAdapter {
  readonly provider: string;
  createCheckoutPayload(input: {
    orderNo: string;
    amount: string;
    currency: string;
    orderName: string;
  }): PaymentCheckoutPayload;
  verifyAndParseWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    rawBody?: Buffer,
  ): ParsedPaymentWebhook;
}
