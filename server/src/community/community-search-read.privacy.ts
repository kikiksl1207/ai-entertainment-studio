type SearchPrivacyRequest = {
  method?: string;
  path: string;
  headers?: { authorization?: unknown };
};
type SearchPrivacyResponse = {
  setHeader(name: string, value: string): void;
  vary?: (field: string) => unknown;
};

const searchReadRoute = /^\/api\/v1\/lumina-feed\/search\/?$/i;

export function communitySearchReadPrivacyMiddleware(
  request: SearchPrivacyRequest,
  response: SearchPrivacyResponse,
  next: () => void,
) {
  let path: string, method: string | undefined;
  try { path = request.path; method = request.method; }
  catch { next(); return; }
  if (typeof path === 'string' && !/[\u0000-\u0020\u007f]/.test(path)
      && ['GET', 'HEAD'].includes(method ?? '') && searchReadRoute.test(path)) {
    let authorizationPresent = true;
    try { authorizationPresent = request.headers?.authorization !== undefined; }
    catch { /* Unreadable credential metadata must not permit response storage. */ }
    if (authorizationPresent) response.setHeader('Cache-Control', 'private, no-store');
    if (typeof response.vary !== 'function') throw new TypeError('Feed search read response requires Vary support');
    response.vary('Authorization');
  }
  next();
}
