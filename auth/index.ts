import { ObjectId } from 'mongodb';

import { obtainSession } from './session';
import { usersCollection } from './user';
import { getDefaultAuthenticatedRoles, getUnauthenticatedRoles } from './role';
import { Role, Session, User } from './types';

export async function authenticate(authToken: string | null): Promise<{ session: Session, user: User | null, roles: Role[] }> {
  const session = await obtainSession(authToken);

  const userDoc = session.userId ? await usersCollection.findOne({ _id: new ObjectId(session.userId) }) : null;
  const user = userDoc ? {
    id: userDoc._id,
    handle: userDoc.handle,
  } : null;

  const roles = user ? getDefaultAuthenticatedRoles() : getUnauthenticatedRoles();

  return {
    user,
    session,
    roles,
  };
}
