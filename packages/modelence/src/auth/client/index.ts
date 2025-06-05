import { setCurrentUser } from '../../client/session';
import { callMethod } from '../../client/method';

export type UserInfo = {
  id: string;
  handle: string;
};

export async function signupWithPassword({ email, password }: { email: string, password: string }) {
  await callMethod('_system.user.signupWithPassword', { email, password });

  // TODO: handle auto-login from the signup method itself to avoid a second method call
  await loginWithPassword({ email, password });
}

export async function loginWithPassword({ email, password }: { email: string, password: string }) {
  const { user } = await callMethod<{ user: UserInfo }>('_system.user.loginWithPassword', { email, password });
  setCurrentUser(user);
  return user;
}

export async function logout() {
  await callMethod('_system.user.logout');
  setCurrentUser(null);
}