import { getOwnProfile } from './profile';

describe('auth/profile', () => {
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
          }
        )
      ).rejects.toThrow('Not authenticated');
    });
  });
});
