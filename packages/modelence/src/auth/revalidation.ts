import type { Role, Session, UserInfo } from './types';

type AuthSnapshot = {
  session: Session | null;
  user: UserInfo | null;
  roles: Role[];
};

function sameRoles(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  // Compare sizes of the sets: duplicates could hide a granted or removed role.
  return setA.size === setB.size && [...setA].every((role) => setB.has(role));
}

/**
 * Whether a long-lived socket may keep acting for the token it connected with.
 * A token that gains a user is a sign-in, not a revocation.
 */
export function isIdentityStillValid(initial: AuthSnapshot, current: AuthSnapshot): boolean {
  // Keep the expiry check here until the obtainSession fix in #465 lands.
  if (current.session?.expiresAt && !(current.session.expiresAt > new Date())) return false;
  return !initial.user || initial.user.id === current.user?.id;
}

/**
 * Whether the auth context captured by a live-query handler still matches.
 * Stricter than `isIdentityStillValid`: a sign-in or any role change needs a
 * fresh subscription.
 */
export function isAuthStillCurrent(initial: AuthSnapshot, current: AuthSnapshot): boolean {
  return (
    isIdentityStillValid(initial, current) &&
    initial.user?.id === current.user?.id &&
    sameRoles(initial.roles, current.roles) &&
    sameRoles(initial.user?.roles ?? [], current.user?.roles ?? [])
  );
}
