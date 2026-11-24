import type { Role, Session, UserInfo } from './types';

type AuthSnapshot = {
  session: Session | null;
  user: UserInfo | null;
  roles: Role[];
};

function sameRoles(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((role, index) => role === b[index]);
}

/** Recheck a long-lived socket or subscription against fresh authentication. */
export function isAuthStillCurrent(initial: AuthSnapshot, current: AuthSnapshot): boolean {
  // Keep the expiry check here until the obtainSession fix in #465 lands.
  if (current.session?.expiresAt && !(current.session.expiresAt > new Date())) return false;
  return (
    initial.user?.id === current.user?.id &&
    sameRoles(initial.roles, current.roles) &&
    sameRoles(initial.user?.roles, current.user?.roles)
  );
}
