import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTransientError, StudioApiError, studioRequest } from './studioApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('studioRequest', () => {
  it('keeps the path of a Studio served under a prefix', async () => {
    const fetchMock = vi.fn(async (_url: URL) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await studioRequest('https://corp.example/studio', '/api/deploy/status', {
      query: { deploymentId: 'd1' },
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://corp.example/studio/api/deploy/status?deploymentId=d1'
    );
  });
});

describe('studioRequest errors', () => {
  it.each([
    ['{"error":"No such build"}', 'No such build', true],
    ['<html>Not found</html>', '<html>Not found</html>', false],
    ['{}', '{}', false],
  ])('tells a JSON error from any other body: %s', async (body, message, isJson) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 404 }))
    );
    await expect(studioRequest('https://h', '/api/x')).rejects.toMatchObject({
      message,
      status: 404,
      isJson,
    });
  });
});

describe('isTransientError', () => {
  it('covers a missing network and a busy Studio only', () => {
    const transient = [429, 502].map((status) => new StudioApiError('x', status));
    for (const error of [new TypeError('fetch failed'), ...transient]) {
      expect(isTransientError(error)).toBe(true);
    }
    const refused = [400, 401].map((status) => new StudioApiError('x', status));
    for (const error of [new Error('x'), ...refused]) {
      expect(isTransientError(error)).toBe(false);
    }
  });
});
