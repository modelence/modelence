import { randomBytes } from 'crypto';

import { Module } from '../app/module';
import { handleSignupWithPassword } from './signup';
import { handleLoginWithPassword, handleLogout } from './login';
import { getOwnProfile } from './profile';
import { dbDisposableEmailDomains, usersCollection } from './db';
import { updateDisposableEmailListCron } from './disposableEmails';
import { time } from '../time';

async function createGuestUser() {
  // TODO: add rate-limiting and captcha handling

  const guestId = randomBytes(9)
    .toString('base64')
    .replace(/[+/]/g, c => c === '+' ? 'a' : 'b');

  const handle = `guest_${guestId}`;
  // TODO: re-try on handle collision

  const result = await usersCollection.insertOne({
    handle,
    createdAt: new Date(),
    authMethods: {},
  });

  return result.insertedId;
}

export default new Module('_system.user', {
  stores: [usersCollection, dbDisposableEmailDomains],
  queries: {
    getOwnProfile,
  },
  mutations: {
    signupWithPassword: handleSignupWithPassword,
    loginWithPassword: handleLoginWithPassword,
    logout: handleLogout,
  },
  cronJobs: {
    updateDisposableEmailList: updateDisposableEmailListCron
  },
  rateLimits: [{
    bucket: 'signup',
    type: 'ip',
    window: time.minutes(15),
    limit: 20,
  }, {
    bucket: 'signup',
    type: 'ip',
    window: time.days(1),
    limit: 200,
  }],
});
