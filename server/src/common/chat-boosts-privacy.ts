type PrivacyRequest = { method?: string; path: string };
type PrivacyResponse = {
  setHeader(name: string, value: string): void;
  vary?: (field: string) => unknown;
};

const readRoute = /^\/api\/v1\/(?:chat\/(?:conversations|sessions(?:\/[^/?#]+\/messages)?)|me\/paid-like-quota)\/?$/i;
const writeRoute = /^\/api\/v1\/(?:chat\/(?:sessions(?:\/[^/?#]+\/(?:messages|generate|preflight))?|conversations\/[^/?#]+\/(?:archive|restore))|boost-campaigns\/[^/?#]+\/paid-like)\/?$/i;

export function isChatBoostsPrivateRequest(request: PrivacyRequest): boolean {
  let path: string, method: string | undefined;
  try { path = request.path; method = request.method; }
  catch { return false; }
  if (typeof path !== 'string' || /[\u0000-\u0020\u007f]/.test(path)) return false;
  return (['GET', 'HEAD'].includes(method ?? '') && readRoute.test(path)) ||
    (method === 'POST' && writeRoute.test(path));
}

// Install before body parsing and guards, alongside the existing bootstrap privacy middleware.
export function chatBoostsPrivacyMiddleware(
  request: PrivacyRequest,
  response: PrivacyResponse,
  next: () => void,
) {
  if (isChatBoostsPrivateRequest(request)) {
    response.setHeader('Cache-Control', 'private, no-store');
    if (typeof response.vary !== 'function') throw new TypeError('Chat/paid-like response requires Vary support');
    response.vary('Authorization');
  }
  next();
}
