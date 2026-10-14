type PrivacyRequest = { method?: string; path: string };
type PrivacyResponse = {
  setHeader(name: string, value: string): void;
  vary?: (field: string) => unknown;
};

const readRoute = /^\/(?:api\/v1\/me\/creator-studio\/(?:settlement-preview|payout-summary|settlement-conversions)|admin\/api\/v1\/backstage\/(?:operations\/(?:settlement-preview|partner-settlement-preview)|settlement-conversions))\/?$/i;

export function isSettlementPreviewPrivateRead(request: PrivacyRequest): boolean {
  let path: string, method: string | undefined;
  try { path = request.path; method = request.method; }
  catch { return false; }
  return typeof path === 'string' && !/[\u0000-\u0020\u007f]/.test(path) &&
    ['GET', 'HEAD'].includes(method ?? '') && readRoute.test(path);
}

// Apply before authentication and routing so rejected reads cannot be cached either.
export function settlementPreviewPrivacyMiddleware(
  request: PrivacyRequest,
  response: PrivacyResponse,
  next: () => void,
) {
  if (isSettlementPreviewPrivateRead(request)) {
    response.setHeader('Cache-Control', 'private, no-store');
    if (typeof response.vary !== 'function') throw new TypeError('Settlement read response requires Vary support');
    response.vary('Authorization');
  }
  next();
}
