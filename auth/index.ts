import { Session, User } from './types';
import { obtainSession } from './session';
import { usersCollection } from './user';

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
