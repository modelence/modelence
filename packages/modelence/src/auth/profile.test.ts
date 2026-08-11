import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getOwnProfile, handleUpdateProfile } from './profile';
import { AuthError, ValidationError } from '../error';
import { usersCollection } from './db';

vi.mock('./db', () => ({
  usersCollection: {
    requireById: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
}));

const baseContext = {
  session: {} as any,
  roles: [],
  clientInfo: {
    screenWidth: 1920,
    screenHeight: 1080,
    windowWidth: 1920,
    windowHeight: 1080,
    pixelRatio: 1,
    orientation: 'landscape' as const,
  },
  connectionInfo: {
    userAgent: 'test',
    ip: '127.0.0.1',
    baseUrl: 'http://localhost:3000',
  },
  req: null,
  res: null,
};

describe('auth/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOwnProfile', () => {
    it('should be a function', () => {
      expect(typeof getOwnProfile).toBe('function');
    });

    it('should throw AuthError when user is not authenticated', async () => {
      await expect(getOwnProfile({}, { ...baseContext, user: null })).rejects.toThrowError(
        AuthError
      );
    });

    it('should retrieve own profile when authenticated', async () => {
      const mockProfile = {
        _id: 'user-id',
        handle: 'john_doe',
        emails: [],
        authMethods: {},
      };
      vi.mocked(usersCollection.requireById).mockResolvedValue(mockProfile as any);

      const result = await getOwnProfile(
        {},
        { ...baseContext, user: { id: 'user-id', handle: 'john_doe', roles: [] } as any }
      );
      expect(result.handle).toBe('john_doe');
    });
  });

  describe('handleUpdateProfile', () => {
    it('should throw AuthError when user is not authenticated', async () => {
      await expect(handleUpdateProfile({}, { ...baseContext, user: null })).rejects.toThrowError(
        AuthError
      );
    });

    it('should throw ValidationError when handle is already taken', async () => {
      const activeUser = { id: 'user-id-1', handle: 'user1', roles: [] };
      const existingUserInDb = { _id: 'user-id-2', handle: 'taken_handle' };

      vi.mocked(usersCollection.requireById).mockResolvedValue({
        _id: 'user-id-1',
        handle: 'user1',
      } as any);
      vi.mocked(usersCollection.findOne).mockResolvedValue(existingUserInDb as any);

      await expect(
        handleUpdateProfile({ handle: 'taken_handle' }, { ...baseContext, user: activeUser as any })
      ).rejects.toThrowError(ValidationError);
    });

    it('should throw ValidationError when profile validation fails', async () => {
      const activeUser = { id: 'user-id-1', handle: 'user1', roles: [] };
      vi.mocked(usersCollection.requireById).mockResolvedValue({
        _id: 'user-id-1',
        handle: 'user1',
      } as any);

      await expect(
        handleUpdateProfile({ handle: 'sh' }, { ...baseContext, user: activeUser as any }) // shorter than MIN_HANDLE_LENGTH
      ).rejects.toThrowError(ValidationError);
    });
  });
});
