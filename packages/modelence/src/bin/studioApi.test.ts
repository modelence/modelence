import { afterEach, describe, expect, it, vi } from 'vitest';
import { studioRequest } from './studioApi';

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
