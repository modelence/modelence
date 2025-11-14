import {
  initRoles,
  getUnauthenticatedRoles,
  getDefaultAuthenticatedRoles,
  hasAccess,
  requireAccess,
  hasPermission,
} from './role';

describe('auth/role', () => {
  beforeEach(() => {
    // Reset roles for each test
    initRoles({}, {} as any);
  });

  describe('initRoles', () => {
    it('should initialize roles and default roles', () => {
      initRoles(
        {
          admin: { permissions: ['read', 'write', 'delete'] },
          user: { permissions: ['read'] },
        },
        {
          authenticated: 'user',
          unauthenticated: 'guest',
        }
      );

      expect(getDefaultAuthenticatedRoles()).toEqual(['user']);
      expect(getUnauthenticatedRoles()).toEqual(['guest']);
    });
  });

  describe('getUnauthenticatedRoles', () => {
    it('should return empty array when no unauthenticated role is set', () => {
      expect(getUnauthenticatedRoles()).toEqual([]);
    });

    it('should return unauthenticated role when set', () => {
      initRoles({}, { unauthenticated: 'guest' } as any);
      expect(getUnauthenticatedRoles()).toEqual(['guest']);
    });
  });

  describe('getDefaultAuthenticatedRoles', () => {
    it('should return empty array when no authenticated role is set', () => {
      expect(getDefaultAuthenticatedRoles()).toEqual([]);
    });

    it('should return authenticated role when set', () => {
      initRoles({}, { authenticated: 'user' } as any);
      expect(getDefaultAuthenticatedRoles()).toEqual(['user']);
    });
  });

  describe('hasPermission', () => {
    beforeEach(() => {
      initRoles(
        {
          admin: { permissions: ['read', 'write', 'delete'] },
          user: { permissions: ['read', 'write'] },
          guest: { permissions: ['read'] },
        },
        {
          authenticated: 'user',
          unauthenticated: 'guest',
        }
      );
    });

    it('should return true when role has permission', () => {
      expect(hasPermission(['admin'], 'read')).toBe(true);
      expect(hasPermission(['admin'], 'write')).toBe(true);
      expect(hasPermission(['admin'], 'delete')).toBe(true);
    });

    it('should return false when role does not have permission', () => {
      expect(hasPermission(['guest'], 'write')).toBe(false);
      expect(hasPermission(['guest'], 'delete')).toBe(false);
    });

    it('should return true if any role has permission', () => {
      expect(hasPermission(['guest', 'admin'], 'delete')).toBe(true);
    });

    it('should return false for empty roles array', () => {
      expect(hasPermission([], 'read')).toBe(false);
    });

    it('should return false for non-existent role', () => {
      expect(hasPermission(['nonexistent'], 'read')).toBe(false);
    });
  });

  describe('hasAccess', () => {
    beforeEach(() => {
      initRoles(
        {
          admin: { permissions: ['read', 'write', 'delete'] },
          user: { permissions: ['read', 'write'] },
          guest: { permissions: ['read'] },
        },
        {
          authenticated: 'user',
          unauthenticated: 'guest',
        }
      );
    });

    it('should return true when all permissions are satisfied', () => {
      expect(hasAccess(['admin'], ['read', 'write', 'delete'])).toBe(true);
      expect(hasAccess(['user'], ['read', 'write'])).toBe(true);
      expect(hasAccess(['guest'], ['read'])).toBe(true);
    });

    it('should return false when not all permissions are satisfied', () => {
      expect(hasAccess(['guest'], ['read', 'write'])).toBe(false);
      expect(hasAccess(['user'], ['read', 'write', 'delete'])).toBe(false);
    });

    it('should return true for empty permissions array', () => {
      expect(hasAccess(['guest'], [])).toBe(true);
    });

    it('should return false when roles are empty and permissions required', () => {
      expect(hasAccess([], ['read'])).toBe(false);
    });
  });

  describe('requireAccess', () => {
    beforeEach(() => {
      initRoles(
        {
          admin: { permissions: ['read', 'write', 'delete'] },
          user: { permissions: ['read', 'write'] },
          guest: { permissions: ['read'] },
        },
        {
          authenticated: 'user',
          unauthenticated: 'guest',
        }
      );
    });

    it('should not throw when all permissions are satisfied', () => {
      expect(() => requireAccess(['admin'], ['read', 'write', 'delete'])).not.toThrow();
      expect(() => requireAccess(['user'], ['read', 'write'])).not.toThrow();
      expect(() => requireAccess(['guest'], ['read'])).not.toThrow();
    });

    it('should throw when permissions are not satisfied', () => {
      expect(() => requireAccess(['guest'], ['write'])).toThrow(
        "Access denied - missing permission: 'write'"
      );
      expect(() => requireAccess(['user'], ['delete'])).toThrow(
        "Access denied - missing permission: 'delete'"
      );
    });

    it('should not throw for empty permissions array', () => {
      expect(() => requireAccess(['guest'], [])).not.toThrow();
    });

    it('should throw with first missing permission', () => {
      expect(() => requireAccess(['guest'], ['write', 'delete'])).toThrow(
        "Access denied - missing permission: 'write'"
      );
    });
  });
});
