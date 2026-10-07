export function storyChatHistoryPrivacyMiddleware(
  request: { url: string; method: string },
  response: { setHeader(name: string, value: string): void },
  next: () => void,
) {
  if (/^(?:GET|HEAD)$/i.test(request.method) &&
      /^\/api\/(?:v1\/)?chat\/sessions\/[^/?]+\/messages(?:[/?]|$)/i.test(request.url)) {
    response.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}
