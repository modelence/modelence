import { z } from 'zod';

import { Args, Context } from '../methods/types';

export async function handleSignupWithPassword(args: Args, { user }: Context) {
  const email = z.string().email().parse(args.email);
  const password = z.string().min(8).parse(args.password);

  if (user) {
    // TODO: handle cases where a user is already logged in
  }

  
}

