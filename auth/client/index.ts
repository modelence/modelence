import { setCurrentUser } from '../../client/session';
import { callMethod } from '../../client/method';

type User = {
  id: string;
  handle: string;
};

export async function signupWithPassword({ email, password }: { email: string, password: string }) {
  return callMethod('_system.user.signupWithPassword', { email, password });
}

export async function loginWithPassword({ email, password }: { email: string, password: string }) {
  const { user } = await callMethod<{ user: User }>('_system.user.loginWithPassword', { email, password });
  setCurrentUser(user);
  return user;
}

export async function logout() {
  await callMethod('_system.user.logout');
  setCurrentUser(null);
}