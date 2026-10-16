import { storyUploadPrivacyMiddleware } from './story-upload.privacy';

// AUTHOR UNRUN, current-only pure calls. No HTTP, AppModule, auth, service, or DB.
function probe() {
  const headers = new Map<string, string>([
    ['cache-control', 'public, max-age=60'],
    ['vary', 'Origin, Accept-Encoding'],
    ['x-synthetic', 'unchanged'],
  ]);
  const response = {
    setHeader: jest.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    }),
  };
  return { headers, response };
}

describe('Story upload early privacy middleware (pure calls)', () => {
  it('01 sets private no-store before next on exact URL shapes for all method variants', () => {
    const roots = ['/api/v1/story-upload', '/api/story-upload'];
    const suffixes = [
      '/intake',
      '/submissions/synthetic-submission/generation-profile',
      '/submissions/synthetic-submission/generation-profile/approve',
    ];
    const methods = ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'];

    for (const root of roots) {
      for (const suffix of suffixes) {
        const path = root + suffix;
        const variants = [
          path,
          path + '/',
          path + '?synthetic=1&next=/unrelated',
          path + '?next=/approve/child',
          path + '/?synthetic=1',
          path.toUpperCase(),
        ];
        for (const url of variants) {
          for (const method of methods) {
            const request = Object.freeze({ url, method });
            const p = probe();
            const next = jest.fn(() => {
              expect(p.headers.get('cache-control')).toBe('private, no-store');
              expect(p.headers.get('vary')).toBe('Origin, Accept-Encoding');
              expect(p.headers.get('x-synthetic')).toBe('unchanged');
            });

            storyUploadPrivacyMiddleware(request, p.response, next);

            expect(p.response.setHeader).toHaveBeenCalledTimes(1);
            expect(p.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
            expect(next).toHaveBeenCalledTimes(1);
            expect(request).toEqual({ url, method });
            expect([...p.headers]).toEqual([
              ['cache-control', 'private, no-store'],
              ['vary', 'Origin, Accept-Encoding'],
              ['x-synthetic', 'unchanged'],
            ]);
          }
        }
      }
    }

    // Invalid/encoded IDs remain the downstream controller's decision.
    for (const segment of ['not-a-uuid', '%2F', '%20']) {
      const p = probe();
      const next = jest.fn();
      storyUploadPrivacyMiddleware(
        { url: '/api/v1/story-upload/submissions/' + segment + '/generation-profile' },
        p.response,
        next,
      );
      expect(p.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
      expect(p.response.setHeader).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('02 leaves lookalikes, neighbors and unrelated headers unchanged', () => {
    const urls = [
      '/api/v1/story-upload',
      '/api/v1/story-upload/',
      '/api/v1/story-upload/intake-extra',
      '/api/v1/story-upload/intake/child',
      '/api/v1/story-upload/intake//',
      '/api/v1/story-upload/intakes',
      '/api/v1/story-upload/submissions',
      '/api/v1/story-upload/submissions/synthetic-submission',
      '/api/v1/story-upload/submissions//generation-profile',
      '/api/v1/story-upload/submissions/a/b/generation-profile',
      '/api/v1/story-upload/submissions/synthetic-submission/generation-profiles',
      '/api/v1/story-upload/submissions/synthetic-submission/generation-profile-extra',
      '/api/v1/story-upload/submissions/synthetic-submission/generation-profile/child',
      '/api/v1/story-upload/submissions/synthetic-submission/generation-profile/approve-extra',
      '/api/v1/story-upload/submissions/synthetic-submission/generation-profile/approve/child',
      '/api/v1/story-upload/submissions/synthetic-submission/generation-profile//',
      '/api/v2/story-upload/intake',
      '/story-upload/intake',
      '/api/v1/story-upload-extra/intake',
      '/api/v1/%73tory-upload/intake',
      '/api/v1/public/story-upload/intake',
      '/api/v1/me/creator-studio/stories/synthetic-story/body-review',
      '/api/v1/ott/catalog',
      '/health',
    ];

    for (const url of urls) {
      for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
        const request = Object.freeze({ url, method });
        const p = probe();
        const before = [...p.headers];
        const next = jest.fn(() => {
          expect([...p.headers]).toEqual(before);
        });

        storyUploadPrivacyMiddleware(request, p.response, next);

        expect(p.response.setHeader).not.toHaveBeenCalled();
        expect([...p.headers]).toEqual(before);
        expect(next).toHaveBeenCalledTimes(1);
        expect(request).toEqual({ url, method });
      }
    }
  });

  it('03 preserves callback and error behavior without inspecting credentials or body', () => {
    const url = '/api/v1/story-upload/intake';
    const request = Object.freeze({
      url,
      get method(): never { throw new Error('Synthetic unexpected method read'); },
      get headers(): never { throw new Error('Synthetic unexpected headers read'); },
      get body(): never { throw new Error('Synthetic unexpected body read'); },
    });
    const p = probe();
    const next = jest.fn();
    storyUploadPrivacyMiddleware(request, p.response, next);
    expect(p.response.setHeader).toHaveBeenCalledTimes(1);
    expect(p.headers.get('cache-control')).toBe('private, no-store');
    expect(next).toHaveBeenCalledTimes(1);

    // Outside Express's string-URL type contract: benign values coerce to nonmatches.
    const wrongUrls: unknown[] = [undefined, null, 0, false, {}, []];
    for (const value of wrongUrls) {
      const malformed = probe();
      const before = [...malformed.headers];
      const malformedNext = jest.fn();
      storyUploadPrivacyMiddleware({ url: value as string }, malformed.response, malformedNext);
      expect(malformed.response.setHeader).not.toHaveBeenCalled();
      expect([...malformed.headers]).toEqual(before);
      expect(malformedNext).toHaveBeenCalledTimes(1);
    }

    const urlFailure = new Error('Synthetic URL failure');
    const unreadable = { get url(): string { throw urlFailure; } };
    const unreadableResponse = probe();
    const unreadableNext = jest.fn();
    expect(() => storyUploadPrivacyMiddleware(unreadable, unreadableResponse.response, unreadableNext))
      .toThrow(urlFailure);
    expect(unreadableResponse.response.setHeader).not.toHaveBeenCalled();
    expect(unreadableNext).not.toHaveBeenCalled();

    const headerFailure = new Error('Synthetic header failure');
    const brokenResponse = { setHeader: jest.fn(() => { throw headerFailure; }) };
    const blockedNext = jest.fn();
    expect(() => storyUploadPrivacyMiddleware({ url }, brokenResponse, blockedNext)).toThrow(headerFailure);
    expect(brokenResponse.setHeader).toHaveBeenCalledTimes(1);
    expect(blockedNext).not.toHaveBeenCalled();

    for (const callbackUrl of [url, '/health']) {
      const callbackResponse = probe();
      const nextFailure = new Error('Synthetic next failure');
      const throwingNext = jest.fn(() => { throw nextFailure; });
      expect(() => storyUploadPrivacyMiddleware({ url: callbackUrl }, callbackResponse.response, throwingNext))
        .toThrow(nextFailure);
      expect(throwingNext).toHaveBeenCalledTimes(1);
      expect(callbackResponse.response.setHeader).toHaveBeenCalledTimes(callbackUrl === url ? 1 : 0);
    }
  });
});
