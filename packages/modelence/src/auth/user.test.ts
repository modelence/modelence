import userModule, { createGuestUser } from './user';

describe('auth/user', () => {
  describe('createGuestUser', () => {
    it('should be a function', () => {
      expect(typeof createGuestUser).toBe('function');
    });
  });

  describe('userModule', () => {
    it('should export a module with name', () => {
      expect(userModule.name).toBe('_system.user');
    });

    it('should have queries defined', () => {
      expect(userModule.queries).toBeDefined();
      expect(userModule.queries.getOwnProfile).toBeDefined();
    });

    it('should have mutations defined', () => {
      expect(userModule.mutations).toBeDefined();
      expect(userModule.mutations.signupWithPassword).toBeDefined();
      expect(userModule.mutations.loginWithPassword).toBeDefined();
      expect(userModule.mutations.logout).toBeDefined();
      expect(userModule.mutations.sendResetPasswordToken).toBeDefined();
      expect(userModule.mutations.resetPassword).toBeDefined();
    });

    it('should have stores defined', () => {
      expect(userModule.stores).toBeDefined();
      expect(Array.isArray(userModule.stores)).toBe(true);
      expect(userModule.stores.length).toBeGreaterThan(0);
    });

    it('should have cronJobs defined', () => {
      expect(userModule.cronJobs).toBeDefined();
      expect(userModule.cronJobs.updateDisposableEmailList).toBeDefined();
    });

    it('should have rate limits defined', () => {
      expect(userModule.rateLimits).toBeDefined();
      expect(Array.isArray(userModule.rateLimits)).toBe(true);
      expect(userModule.rateLimits.length).toBeGreaterThan(0);
    });

    it('should have config schema defined', () => {
      expect(userModule.configSchema).toBeDefined();
      expect(userModule.configSchema['auth.email.enabled']).toBeDefined();
      expect(userModule.configSchema['auth.google.enabled']).toBeDefined();
      expect(userModule.configSchema['auth.github.enabled']).toBeDefined();
    });

    it('should have routes defined', () => {
      expect(userModule.routes).toBeDefined();
      expect(Array.isArray(userModule.routes)).toBe(true);
      expect(userModule.routes.length).toBeGreaterThan(0);
    });
  });
});
