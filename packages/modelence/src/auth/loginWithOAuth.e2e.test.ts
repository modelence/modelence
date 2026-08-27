import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockConsumeOAuthExchangeCode = vi.fn();
const mockSetSessionUser = vi.fn();
const mockFindOne = vi.fn();

vi.doMock('./session', () => ({
  consumeOAuthExchangeCode: mockConsumeOAuthExchangeCode,
  setSessionUser: mockSetSessionUser,
}));
vi.doMock('./db', () => ({ usersCollection: { findOne: mockFindOne } }));
vi.doMock('@/server', () => ({ consumeRateLimit: vi.fn() }));
vi.doMock('@/app/authConfig', () => ({ getAuthConfig: () => ({}) }));

const { handleLoginWithOAuth } = await import('./loginWithOAuth');

const USER_ID = new ObjectId();
const ctx = (o = {}) =>
  ({
    session: { authToken: 'tok', userId: null, expiresAt: new Date() },
    connectionInfo: { ip: '1.2.3.4' },
    ...o,
  }) as never;

/**
 * Redemption-side invariants, paired with the initiation invariants in
 * providers/oauth-common.e2e.test.ts. Together they cover the two halves that
 * must agree: a code is minted only with a binding, and redeemed only with the
 * matching verifier.
 */
describe('loginWithOAuth — redemption invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsumeOAuthExchangeCode.mockResolvedValue({
      userId: USER_ID.toString(),
      provider: 'google',
    });
    mockFindOne.mockResolvedValue({ _id: USER_ID, handle: 'u', status: 'active' });
  });

  test('R1: verifier is forwarded to the commit point', async () => {
    await handleLoginWithOAuth({ code: 'c', codeVerifier: 'v' }, ctx());
    expect(mockConsumeOAuthExchangeCode).toHaveBeenCalledWith('c', 'v');
  });

  test('R2: an authenticated session is never rebound', async () => {
    await expect(
      handleLoginWithOAuth({ code: 'c', codeVerifier: 'v' }, ctx({ user: { _id: USER_ID } }))
    ).rejects.toThrow(/already authenticated/i);
    expect(mockConsumeOAuthExchangeCode).not.toHaveBeenCalled();
  });

  test('R3: a rejected code never sets a session', async () => {
    mockConsumeOAuthExchangeCode.mockResolvedValue(null);
    await expect(handleLoginWithOAuth({ code: 'c', codeVerifier: 'v' }, ctx())).rejects.toThrow();
    expect(mockSetSessionUser).not.toHaveBeenCalled();
  });

  test('R4: a disabled account cannot redeem', async () => {
    mockFindOne.mockResolvedValue(null);
    await expect(handleLoginWithOAuth({ code: 'c', codeVerifier: 'v' }, ctx())).rejects.toThrow();
    expect(mockSetSessionUser).not.toHaveBeenCalled();
  });

  test('R5: unknown/expired/mismatched are indistinguishable to the caller', async () => {
    const messages: string[] = [];
    for (const ret of [null, null]) {
      mockConsumeOAuthExchangeCode.mockResolvedValue(ret);
      await handleLoginWithOAuth({ code: 'c', codeVerifier: 'v' }, ctx()).catch((e: Error) =>
        messages.push(e.message)
      );
    }
    mockConsumeOAuthExchangeCode.mockResolvedValue({
      userId: USER_ID.toString(),
      provider: 'google',
    });
    mockFindOne.mockResolvedValue(null);
    await handleLoginWithOAuth({ code: 'c', codeVerifier: 'v' }, ctx()).catch((e: Error) =>
      messages.push(e.message)
    );
    expect(new Set(messages).size).toBe(1);
  });
});
