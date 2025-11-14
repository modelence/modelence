import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { ObjectId } from 'mongodb';

const mockObtainSession = jest.fn();
const mockFindOne = jest.fn();
const mockGetDefaultAuthenticatedRoles = jest.fn();
const mockGetUnauthenticatedRoles = jest.fn();

jest.unstable_mockModule('./session', () => ({
  obtainSession: mockObtainSession,
}));

jest.unstable_mockModule('./db', () => ({
  usersCollection: {
    findOne: mockFindOne,
  },
}));

jest.unstable_mockModule('./role', () => ({
  getDefaultAuthenticatedRoles: mockGetDefaultAuthenticatedRoles,
  getUnauthenticatedRoles: mockGetUnauthenticatedRoles,
}));

const { authenticate } = await import('./index');

describe('auth/index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDefaultAuthenticatedRoles.mockReturnValue([]);
    mockGetUnauthenticatedRoles.mockReturnValue([]);
  });

  test('returns unauthenticated context when session has no user', async () => {
    const session = { authToken: 'token', expiresAt: new Date(), userId: null };
    mockObtainSession.mockResolvedValue(session as never);
    const roles = ['guest'];
    mockGetUnauthenticatedRoles.mockReturnValue(roles);

    const result = await authenticate(null);

    expect(result.session).toEqual(session);
    expect(result.user).toBeNull();
    expect(result.roles).toBe(roles);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test('maps database user info when session has userId', async () => {
    const userId = new ObjectId('507f1f77bcf86cd799439011');
    const session = {
      authToken: 'token',
      expiresAt: new Date(),
      userId,
    };
    mockObtainSession.mockResolvedValue(session as never);
    const userDoc = {
      _id: userId,
      handle: 'demo',
      roles: ['admin'],
      createdAt: new Date(),
      authMethods: {},
    };
    mockFindOne.mockResolvedValue(userDoc as never);
    mockGetDefaultAuthenticatedRoles.mockReturnValue(['authenticated']);

    const result = await authenticate('token');

    expect(mockFindOne).toHaveBeenCalled();
    expect(result.user?.id).toBe(String(userDoc._id));
    expect(result.user?.handle).toBe('demo');
    expect(result.roles).toEqual(['authenticated']);

    expect(result.user?.hasRole('admin')).toBe(true);
    expect(() => result.user?.requireRole('missing')).toThrow(
      "Access denied - role 'missing' required"
    );
  });
});
