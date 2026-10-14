type PrivacyRequest = { method?: string; path: string };
type PrivacyResponse = {
  setHeader(name: string, value: string): void;
  vary?: (field: string) => unknown;
};

const readRoute = /^\/(?:admin\/api\/v1|api\/v1\/me\/creator-studio)\/content-rights-contracts(?:\/[^/?#]+)?\/?$/i;

export function isContentRightsContractPrivateRead(request: PrivacyRequest): boolean {
  let path: string, method: string | undefined;
  try { path = request.path; method = request.method; }
  catch { return false; }
  return typeof path === 'string' && !/[\u0000-\u0020\u007f]/.test(path) &&
    ['GET', 'HEAD'].includes(method ?? '') && readRoute.test(path);
}

// Installed before routing and guards so denials retain the same private-read boundary.
export function contentRightsContractPrivacyMiddleware(
  request: PrivacyRequest,
  response: PrivacyResponse,
  next: () => void,
) {
  if (isContentRightsContractPrivateRead(request)) {
    response.setHeader('Cache-Control', 'private, no-store');
    if (typeof response.vary !== 'function') throw new TypeError('Contract read response requires Vary support');
    response.vary('Authorization');
  }
  next();
}
