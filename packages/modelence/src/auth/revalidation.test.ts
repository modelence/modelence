import { describe, expect, test } from 'vitest';
import type { Session, UserInfo } from './types';
import { isAuthStillCurrent, isIdentityStillValid } from './revalidation';

function buildAuth(
  user: { id: string; roles: string[] } | null,
  { roles = [], expiresInMs = 60_000 }: { roles?: string[]; expiresInMs?: number } = {}
) {
  return {
    session: { authToken: 'token', expiresAt: new Date(Date.now() + expiresInMs) } as Session,
    user: user as UserInfo | null,
    roles,
  };
}

const anonymous = buildAuth(null);
const reader = buildAuth({ id: 'user-1', roles: ['reader'] });
const otherUser = buildAuth({ id: 'user-2', roles: ['reader'] });
const expiredReader = buildAuth({ id: 'user-1', roles: ['reader'] }, { expiresInMs: -1 });

describe('isIdentityStillValid', () => {
  test.each([
    ['the same user', reader, reader, true],
    ['an anonymous session that stays anonymous', anonymous, anonymous, true],
    ['an anonymous session that gains a user', anonymous, reader, true],
    ['a role change', reader, buildAuth({ id: 'user-1', roles: ['admin'] }), true],
    ['a signed-out user', reader, anonymous, false],
    ['a different user', reader, otherUser, false],
    ['an expired session', reader, expiredReader, false],
    ['an anonymous session that gains a user but is expired', anonymous, expiredReader, false],
  ])('%s', (_name, initial, current, expected) => {
    expect(isIdentityStillValid(initial, current)).toBe(expected);
  });
});

describe('isAuthStillCurrent', () => {
  const withRoles = (roles: string[]) => buildAuth({ id: 'user-1', roles });

  test.each([
    ['identical roles', ['a', 'b'], ['a', 'b'], true],
    ['reordered roles', ['a', 'b'], ['b', 'a'], true],
    ['repeated roles', ['a', 'a'], ['a'], true],
    ['a granted role', ['a'], ['a', 'b'], false],
    ['a removed role', ['a', 'b'], ['a'], false],
    ['a granted role hidden by a duplicate', ['a', 'a'], ['a', 'b'], false],
    ['a removed role hidden by a duplicate', ['a', 'b'], ['a', 'a'], false],
  ])('user roles: %s', (_name, before, after, expected) => {
    expect(isAuthStillCurrent(withRoles(before), withRoles(after))).toBe(expected);
  });

  test('context roles are compared regardless of order', () => {
    const before = buildAuth(null, { roles: ['guest', 'viewer'] });
    expect(isAuthStillCurrent(before, buildAuth(null, { roles: ['viewer', 'guest'] }))).toBe(true);
    expect(isAuthStillCurrent(before, buildAuth(null, { roles: ['guest'] }))).toBe(false);
  });

  // The handler captured an anonymous context, so it needs a new subscription.
  test('an anonymous session that gains a user is not current', () => {
    expect(isAuthStillCurrent(anonymous, buildAuth({ id: 'user-1', roles: [] }))).toBe(false);
  });

  test('a signed-out user is not current', () => {
    expect(isAuthStillCurrent(reader, anonymous)).toBe(false);
  });
});
