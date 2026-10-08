// Protect only private summary/title responses before parsing and authentication.
export function fanEngagementPrivacyMiddleware(
  request: { method?: string; path: string },
  response: { setHeader(name: string, value: string): void },
  next: () => void,
) {
  let pathname: string;
  try { pathname = request.path; }
  catch { next(); return; }
  const read = ['GET', 'HEAD'].includes(request.method ?? '') &&
    /^\/api\/v1\/me\/fan-engagement\/summary\/?$/i.test(pathname);
  const write = request.method === 'PATCH' &&
    /^\/api\/v1\/me\/fan-engagement\/title\/?$/i.test(pathname);
  if (read || write) response.setHeader('Cache-Control', 'private, no-store');
  next();
}
