import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, ValidationError } from '../error';

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

    it('should throw AuthError when user is not authenticated', async () => {
      await expect(getOwnProfile({}, { user: null } as never)).rejects.toThrowError(AuthError);
    });

    it('should retrieve own profile when authenticated', async () => {
      const mockProfile = {
        _id: 'user-id',
        handle: 'john_doe',
        emails: [],
        authMethods: {},
      };
      mockRequireById.mockResolvedValueOnce(mockProfile);

      const result = await getOwnProfile({}, authenticatedContext);
      expect(result.handle).toBe('john_doe');
    });
  });

  describe('handleUpdateProfile', () => {
    it('should throw AuthError when user is not authenticated', async () => {
      await expect(handleUpdateProfile({}, { user: null } as never)).rejects.toThrowError(
        AuthError
      );
    });

    it('should throw ValidationError when handle is already taken', async () => {
      mockFindOne.mockResolvedValueOnce({ _id: 'user-id-2', handle: 'taken_handle' });

      await expect(
        handleUpdateProfile({ handle: 'taken_handle' }, authenticatedContext)
      ).rejects.toThrowError(ValidationError);
    });

    it('does not consume the profile update limit when field validation fails', async () => {
      mockValidateProfileFields.mockImplementation(() => {
        throw new ValidationError('Invalid profile field');
      });

      await expect(
        handleUpdateProfile({ firstName: 'Invalid' }, authenticatedContext)
      ).rejects.toThrowError(ValidationError);

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

    it('allows legacy users with invalid handle characters to update other fields when handle is unchanged', async () => {
      mockRequireById.mockResolvedValueOnce({
        _id: 'legacy-1',
        handle: 'legacy.user',
      });

      await handleUpdateProfile(
        { handle: 'legacy.user', firstName: 'Updated' },
        authenticatedContext
      );

      expect(mockValidateProfileFields).toHaveBeenCalledWith({ firstName: 'Updated' });
    });
  });
});
