type PrivacyRequest = { method?: string; path: string };
type PrivacyResponse = {
  setHeader(name: string, value: string): void;
  vary?: (field: string) => unknown;
};

const privateReadRoute = /^\/api\/v1\/me\/(?:lumina-feed(?:\/likes)?|hidden-posts)\/?$/i;

// Apply before guards so private read failures cannot become shared cache entries.
export function communityPersonalizedReadPrivacyMiddleware(
  request: PrivacyRequest,
  response: PrivacyResponse,
  next: () => void,
) {
  let path: string, method: string | undefined;
  try { path = request.path; method = request.method; }
  catch { next(); return; }
  if (typeof path === 'string' && !/[\u0000-\u0020\u007f]/.test(path)
      && ['GET', 'HEAD'].includes(method ?? '') && privateReadRoute.test(path)) {
    response.setHeader('Cache-Control', 'private, no-store');
    if (typeof response.vary !== 'function') throw new TypeError('Personalized feed read response requires Vary support');
    response.vary('Authorization');
  }
  next();
}
