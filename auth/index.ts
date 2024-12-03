import { Session, User } from './types';
import { initSessions, obtainSession } from './session';
import { _createMethodInternal } from '../methods';
import { handleSignupWithPassword } from './signup';
import { initUsersCollection, usersCollection } from './users';

export async function initAuth() {
  _createMethodInternal('mutation', '_system.signupWithPassword', handleSignupWithPassword);
  await initSessions();
  await initUsersCollection();
}

export async function authenticate(authToken: string | null): Promise<{ session: Session, user: User | null }> {
  const session = await obtainSession(authToken);

  const userDoc = session.userId ? await usersCollection.findOne({ _id: session.userId }) : null;
  const user = userDoc ? {
    id: userDoc._id,
    handle: userDoc.handle,
  } : null;

  return {
    user,
    session,
  };
}
