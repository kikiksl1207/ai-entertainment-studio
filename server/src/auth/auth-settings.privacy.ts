// Set this before parsing and authentication, including rejected private requests.
export function settingsPrivacyMiddleware(
  request: { method?: string; url: string },
  response: { setHeader(name: string, value: string): void },
  next: () => void,
) {
  if (['GET', 'HEAD', 'PATCH'].includes(request.method ?? '') &&
    /^\/api\/(?:v1\/)?me\/settings\/?(?:\?|$)/i.test(request.url)) {
    response.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}
