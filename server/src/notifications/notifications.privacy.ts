// Protect private notification responses before parsing and authentication.
export function notificationPrivacyMiddleware(
  request: { method?: string; url: string },
  response: { setHeader(name: string, value: string): void },
  next: () => void,
) {
  const read = ['GET', 'HEAD'].includes(request.method ?? '') &&
    /^\/api\/(?:v1\/)?me\/notifications(?:\/unread-count)?\/?(?:\?|$)/i.test(request.url);
  const write = request.method === 'PATCH' &&
    /^\/api\/(?:v1\/)?me\/notifications\/(?:read-all|[^/?]+\/read)\/?(?:\?|$)/i.test(request.url);
  if (read || write) response.setHeader('Cache-Control', 'private, no-store');
  next();
}
