type UploadPrivacyRequest = { url: string };
type UploadPrivacyResponse = { setHeader(name: string, value: string): void };

export function storyUploadPrivacyMiddleware(
  request: UploadPrivacyRequest,
  response: UploadPrivacyResponse,
  next: () => void,
) {
  if (/^\/api\/(?:v1\/)?story-upload\/(?:intake|submissions\/[^/?]+\/generation-profile(?:\/approve)?)\/?(?:\?|$)/i.test(request.url)) {
    response.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}
