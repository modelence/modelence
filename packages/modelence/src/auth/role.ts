import { RoleDefinition, Role, DefaultRoles, Permission } from './types';

const roleMap = new Map<Role, RoleDefinition>();
const defaultRoles: DefaultRoles = {
  authenticated: null,
  unauthenticated: null,
};

export function initRoles(
  roles: Record<Role, RoleDefinition>,
  _defaultRoles: Record<string, Role>
) {
  defaultRoles.authenticated = _defaultRoles.authenticated;
  defaultRoles.unauthenticated = _defaultRoles.unauthenticated;

  for (const [name, definition] of Object.entries(roles)) {
    roleMap.set(name, definition);
  }
}

export function getUnauthenticatedRoles() {
  return defaultRoles.unauthenticated ? [defaultRoles.unauthenticated] : [];
}

export function getDefaultAuthenticatedRoles() {
  return defaultRoles.authenticated ? [defaultRoles.authenticated] : [];
}

export function hasAccess(roles: Role[], requiredPermissions: Permission[]) {
  return requiredPermissions.every((permission) => hasPermission(roles, permission));
}

export function requireAccess(roles: Role[], requiredPermissions: Permission[]) {
  const missingPermission = requiredPermissions.find(
    (permission) => !hasPermission(roles, permission)
  );

  if (missingPermission) {
    throw new Error(`Access denied - missing permission: '${missingPermission}'`);
  }
}

export function hasPermission(roles: Role[], permission: Permission) {
  for (const role of roles) {
    const definition = roleMap.get(role);

    if (definition && definition.permissions.includes(permission)) {
      return true;
    }
  }

  return false;
}

export function isAdmin(user: { roles?: string[] } | null): boolean {
  return user?.roles?.includes('admin') ?? false;
}
