import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { setWebsocketConfig } from '@/app/websocketConfig';

const mockLogError = vi.fn();
vi.doMock('@/telemetry', () => ({ logError: mockLogError }));

const { revalidateUserConnections } = await import('./revocation');

describe('auth/revocation', () => {
  const userId = new ObjectId();
  const revalidateUser = vi.fn();
  const provider = { init: vi.fn(), broadcast: vi.fn() };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => setWebsocketConfig({ provider: undefined }));

  test('passes the user id to the WebSocket provider', async () => {
    setWebsocketConfig({ provider: { ...provider, revalidateUser } });

    await revalidateUserConnections(userId);

    expect(revalidateUser).toHaveBeenCalledWith(userId.toString());
  });

  test('does nothing without a provider', async () => {
    await expect(revalidateUserConnections(userId)).resolves.toBeUndefined();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test('does nothing when a custom provider does not implement it', async () => {
    setWebsocketConfig({ provider });

    await expect(revalidateUserConnections(userId)).resolves.toBeUndefined();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test('logs a failure instead of failing the revocation', async () => {
    const error = new Error('adapter is down');
    revalidateUser.mockRejectedValueOnce(error);
    setWebsocketConfig({ provider: { ...provider, revalidateUser } });

    await expect(revalidateUserConnections(userId)).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith(expect.any(String), { error });
  });
});
