import { ObjectId } from 'mongodb';

import { obtainSession } from './session';
import { usersCollection } from './db';
import { getDefaultAuthenticatedRoles, getUnauthenticatedRoles } from './role';
import { Role, Session, UserInfo } from './types';

export async function authenticate(
  authToken: string | null
): Promise<{ session: Session; user: UserInfo | null; roles: Role[] }> {
  const session = await obtainSession(authToken);

  const userDoc = session.userId
    ? await usersCollection.findOne({
        _id: new ObjectId(session.userId),
        deletedAt: { $exists: false },
      })
    : null;
  const user = userDoc
    ? {
        id: userDoc._id.toString(),
        handle: userDoc.handle,
        roles: userDoc.roles || [],
        hasRole: (role: string) => (userDoc.roles || []).includes(role),
        requireRole: (role: string) => {
          if (!(userDoc.roles || []).includes(role)) {
            throw new Error(`Access denied - role '${role}' required`);
          }
        },
      }
    : null;

  const roles = user ? getDefaultAuthenticatedRoles() : getUnauthenticatedRoles();

  return {
    user,
    session,
    roles,
  };
}
