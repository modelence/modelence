import { ObjectId } from '@/server';
import { usersCollection } from './db';
import { invalidateAllUserSessions } from './session';

// Strength-2 collation: callers pass a lowercased address while the stored one
// may keep its original casing (e.g. OAuth-created accounts), or the match
// silently fails.
const USER_COLLATION = { locale: 'en', strength: 2 } as const;

/**
 * Records the first proof that someone owns `email` (an emailed magic link,
 * one-time code or password reset) and drops everything attached to the
 * account before that proof.
 *
 * Anyone can password-sign-up an address they don't control, then link OAuth
 * providers and hold sessions while verification is not enforced. So in one
 * atomic write the address is marked verified and every auth method (password
 * and OAuth providers) is removed, then all of the account's sessions are
 * signed out. Callers that start a session for the owner must do so after this.
 *
 * The write matches only while the address is still unverified. If a
 * concurrent verification, reset or link already proved ownership, nothing is
 * changed: what that owner set up must survive.
 *
 * @returns The updated user doc, or `null` when nothing was claimed (the
 * address was already verified or is no longer on the account).
 */
export async function claimUnverifiedEmail(userId: ObjectId, email: string) {
  // `$elemMatch` binds both conditions, and the positional `$`, to the one
  // element carrying `email` (see verifyEmailToken).
  const claimedDoc = await usersCollection.findOneAndUpdate(
    { _id: userId, emails: { $elemMatch: { address: email, verified: { $ne: true } } } },
    { $set: { 'emails.$.verified': true, authMethods: {} } },
    { collation: USER_COLLATION, returnDocument: 'after' }
  );
  if (!claimedDoc) {
    return null;
  }

  await invalidateAllUserSessions(userId);
  return claimedDoc;
}
