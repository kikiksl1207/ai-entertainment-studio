// Protect private summary/title and personalized mission reads before authentication.
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
  if (read || write || missionList) response.setHeader('Cache-Control', 'private, no-store');
  if (missionList) {
    if (typeof response.vary !== 'function') throw new TypeError('Mission-list response requires Vary support');
    response.vary('Authorization');
  }
  next();
}
