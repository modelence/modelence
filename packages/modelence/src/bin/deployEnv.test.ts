import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioApiError, studioRequest } from './studioApi';
import { ask } from './terminal';
import { fillMissingEnvVars } from './deployEnv';

vi.mock('./studioApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./studioApi')>()),
  studioRequest: vi.fn(),
}));
vi.mock('./terminal', () => ({ ask: vi.fn() }));

const session = { host: 'https://studio.test', token: 'tok' };
const target = { environmentId: 'env-1' };
const env = { DATABASE_URL: { type: 'secret' as const }, API_URL: {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('fillMissingEnvVars', () => {
  it('asks for each missing variable and saves the ones entered', async () => {
    vi.mocked(studioRequest)
      .mockResolvedValueOnce({ missingEnvVars: ['API_URL', 'DATABASE_URL'] })
      .mockResolvedValueOnce({ missingEnvVars: ['API_URL'] });
    vi.mocked(ask).mockResolvedValueOnce('').mockResolvedValueOnce('mongodb://x');

    await fillMissingEnvVars({ session, target, env });

    expect(ask).toHaveBeenCalledWith('  API_URL: ', { secret: false });
    expect(ask).toHaveBeenCalledWith('  DATABASE_URL (secret): ', { secret: true });
    expect(vi.mocked(studioRequest).mock.calls[1][2]).toMatchObject({
      method: 'POST',
      token: 'tok',
      body: {
        environmentId: 'env-1',
        env,
        values: [{ key: 'DATABASE_URL', value: 'mongodb://x' }],
      },
    });
  });

  it('asks nothing when every variable has a value', async () => {
    vi.mocked(studioRequest).mockResolvedValueOnce({ missingEnvVars: [] });
    await fillMissingEnvVars({ session, target, env });
    expect(ask).not.toHaveBeenCalled();
    expect(studioRequest).toHaveBeenCalledTimes(1);
  });

  it('saves nothing when every answer is skipped', async () => {
    vi.mocked(studioRequest).mockResolvedValueOnce({ missingEnvVars: ['API_URL'] });
    vi.mocked(ask).mockResolvedValueOnce('');
    await fillMissingEnvVars({ session, target, env });
    expect(studioRequest).toHaveBeenCalledTimes(1);
  });

  it('skips the check on a Studio without the route, and for projects declaring nothing', async () => {
    vi.mocked(studioRequest).mockRejectedValueOnce(new StudioApiError('Not found', 404));
    await fillMissingEnvVars({ session, target, env });
    await fillMissingEnvVars({ session, target, env: undefined });
    expect(studioRequest).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  });

  // Expired tokens are the caller's to handle: it signs in again and retries.
  it('passes other errors on', async () => {
    vi.mocked(studioRequest).mockRejectedValueOnce(new StudioApiError('Invalid token', 401));
    await expect(fillMissingEnvVars({ session, target, env })).rejects.toThrow('Invalid token');
  });
});
