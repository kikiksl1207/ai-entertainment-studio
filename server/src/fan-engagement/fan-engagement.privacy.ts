// Protect private summary/title and personalized mission/concept reads before authentication.
export function fanEngagementPrivacyMiddleware(
  request: { method?: string; path: string },
  response: { setHeader(name: string, value: string): void; vary?: (field: string) => unknown },
  next: () => void,
) {
  let pathname: string;
  try { pathname = request.path; }
  catch { next(); return; }
  const read = ['GET', 'HEAD'].includes(request.method ?? '') &&
    /^\/api\/v1\/me\/fan-engagement\/summary\/?$/i.test(pathname);
  const write = request.method === 'PATCH' &&
    /^\/api\/v1\/me\/fan-engagement\/title\/?$/i.test(pathname);
  const missionList = ['GET', 'HEAD'].includes(request.method ?? '') &&
    /^\/api\/v1\/fan-engagement\/missions\/?$/i.test(pathname);
  const conceptList = ['GET', 'HEAD'].includes(request.method ?? '') &&
    /^\/api\/v1\/fan-engagement\/concept-votes\/?$/i.test(pathname);
  if (read || write || missionList || conceptList) response.setHeader('Cache-Control', 'private, no-store');
  if (missionList || conceptList) {
    if (typeof response.vary !== 'function') throw new TypeError(missionList
      ? 'Mission-list response requires Vary support' : 'Concept-list response requires Vary support');
    response.vary('Authorization');
  }
  next();
}
