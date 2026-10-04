// Run before the JSON parser so even malformed private-review requests cannot be cached.
export function authorBodyReviewPrivacyMiddleware(
  request: { url: string }, response: { setHeader(name: string, value: string): void }, next: () => void,
) {
  if (/^\/api\/(?:v1\/)?me\/creator-studio\/stories\/[^/?]+\/body-review(?:[/?]|$)/i.test(request.url)) {
    response.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}
