import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireById = vi.fn();
const mockFindOne = vi.fn();
const mockUpdateOne = vi.fn();
const mockValidateProfileFields = vi.fn();
const mockValidateProfileUpdate = vi.fn();
const mockConsumeRateLimit = vi.fn();

vi.doMock('./db', () => ({
  usersCollection: {
    requireById: mockRequireById,
    findOne: mockFindOne,
    updateOne: mockUpdateOne,
  },
}));

vi.doMock('./validators', () => ({
  validateProfileFields: mockValidateProfileFields,
}));

vi.doMock('@/app/authConfig', () => ({
  getAuthConfig: () => ({ validateProfileUpdate: mockValidateProfileUpdate }),
}));

vi.doMock('../rate-limit/rules', () => ({
  consumeRateLimit: mockConsumeRateLimit,
}));

vi.doMock('./utils', () => ({
  serializeUserForClient: (profile: unknown) => profile,
}));

const { getOwnProfile, handleUpdateProfile } = await import('./profile');

describe('auth/profile', () => {
  const authenticatedContext = {
    user: { id: 'user-1' },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireById.mockResolvedValue({
      _id: 'profile-1',
      handle: 'existing-handle',
      authMethods: {},
      emails: [],
    } as never);
    mockFindOne.mockResolvedValue(null as never);
    mockUpdateOne.mockResolvedValue(undefined as never);
    mockValidateProfileFields.mockImplementation((props: unknown) => props);
    mockValidateProfileUpdate.mockResolvedValue(undefined as never);
    mockConsumeRateLimit.mockResolvedValue(undefined as never);
  });

  describe('getOwnProfile', () => {
    it('should be a function', () => {
      expect(typeof getOwnProfile).toBe('function');
    });

    it('should throw error when user is not authenticated', async () => {
      await expect(
        getOwnProfile(
          {},
          {
            user: null,
            session: null,
            roles: [],
            clientInfo: {
              screenWidth: 1920,
              screenHeight: 1080,
              windowWidth: 1920,
              windowHeight: 1080,
              pixelRatio: 1,
              orientation: 'landscape',
            },
            connectionInfo: {
              userAgent: 'test',
              ip: '127.0.0.1',
            },
            req: null,
            res: null,
          }
        )
      ).rejects.toThrow('Not authenticated');
    });
  });

  describe('handleUpdateProfile', () => {
    it('does not consume the profile update limit when field validation fails', async () => {
      mockValidateProfileFields.mockImplementation(() => {
        throw new Error('Invalid profile field');
      });

      await expect(
        handleUpdateProfile({ firstName: 'Invalid' }, authenticatedContext)
      ).rejects.toThrow('Invalid profile field');

      expect(mockConsumeRateLimit).not.toHaveBeenCalled();
    });

    it('does not consume the profile update limit when the validation hook rejects', async () => {
      mockValidateProfileUpdate.mockRejectedValue(new Error('Profile update rejected') as never);

      await expect(
        handleUpdateProfile({ firstName: 'Blocked' }, authenticatedContext)
      ).rejects.toThrow('Profile update rejected');

      expect(mockConsumeRateLimit).not.toHaveBeenCalled();
    });

    it('consumes the profile update limit before persisting a valid update', async () => {
      await handleUpdateProfile({ firstName: 'Updated' }, authenticatedContext);

      expect(mockConsumeRateLimit).toHaveBeenCalledWith({
        bucket: 'updateProfile',
        type: 'user',
        value: 'user-1',
      });
      expect(mockUpdateOne).toHaveBeenCalled();
    });
  });
});
