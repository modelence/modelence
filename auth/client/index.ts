import { callMethod } from '../../client/method';

export async function signupWithPassword({ email, password }: { email: string, password: string }) {
  return callMethod('_system.user.signupWithPassword', { email, password });
}

export async function loginWithPassword({ email, password }: { email: string, password: string }) {
  return callMethod('_system.user.loginWithPassword', { email, password });
}
