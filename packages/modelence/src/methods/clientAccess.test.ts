import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { glob } from 'glob';
import { describe, expect, test } from 'vitest';
import { CLIENT_CALLABLE_SYSTEM_METHODS, isClientCallableMethod } from './clientAccess';

describe('isClientCallableMethod', () => {
  describe('app-defined methods (no _system. prefix) are always callable', () => {
    test.each([
      'todo.create',
      'documents.requestUpload',
      'billing.checkout',
      'a',
      // A method that merely contains "_system" but is not prefixed with it.
      'my_system.thing',
      'app._system.files.getFileUrl',
    ])('%s is allowed', (name) => {
      expect(isClientCallableMethod(name)).toBe(true);
    });
  });

  describe('reserved _system.* file methods are blocked from the client', () => {
    test.each([
      '_system.files.getUploadUrl',
      '_system.files.getFileUrl',
      '_system.files.downloadFile',
      '_system.files.deleteFile',
    ])('%s is denied', (name) => {
      expect(isClientCallableMethod(name)).toBe(false);
    });
  });

  describe('other reserved _system.* modules are blocked from the client', () => {
    test.each([
      '_system.lock.acquire',
      '_system.cron.run',
      '_system.migration.apply',
      '_system.rateLimit.check',
      '_system.system.anything',
      // Defense against a hypothetical future system method that forgets to be
      // added to the allowlist: it must be closed by default.
      '_system.user.someNewInternalMethod',
    ])('%s is denied', (name) => {
      expect(isClientCallableMethod(name)).toBe(false);
    });
  });

  describe('allowlisted auth/session methods remain callable', () => {
    test.each([
      '_system.session.init',
      '_system.session.heartbeat',
      '_system.user.signupWithPassword',
      '_system.user.loginWithPassword',
      '_system.user.logout',
      '_system.user.verifyEmail',
      '_system.user.resendEmailVerification',
      '_system.user.sendResetPasswordToken',
      '_system.user.resetPassword',
      '_system.user.updateProfile',
      '_system.user.unlinkOAuthProvider',
    ])('%s is allowed', (name) => {
      expect(isClientCallableMethod(name)).toBe(true);
    });
  });

  describe('the allowlist matches names exactly (no prefix games)', () => {
    test.each([
      // Trailing segment past an allowlisted name must not pass.
      '_system.user.logout.extra',
      // A path that starts like an allowlisted one but diverges.
      '_system.userX.logout',
      // Case sensitivity: the dispatcher matches the exact registered name.
      '_system.User.logout',
    ])('%s is denied', (name) => {
      expect(isClientCallableMethod(name)).toBe(false);
    });
  });

  describe('allowlist stays in sync with the framework client bundle', () => {
    // Directories whose modules are imported into `modelence/client` and may
    // legitimately call `_system.*` methods from the browser. If a new client
    // caller is added, this test fails until the method is allowlisted —
    // guarding against accidentally re-exposing a system method to the client.
    const here = dirname(fileURLToPath(import.meta.url));
    const srcRoot = resolve(here, '..');
    const clientSourceGlobs = [
      'auth/client/**/*.{ts,tsx}',
      'client/**/*.{ts,tsx}',
      'ssr/**/*.{ts,tsx}',
      'websocket/**/*.{ts,tsx}',
    ];

    test('every _system.* method called from client code is allowlisted', async () => {
      const files = (
        await Promise.all(
          clientSourceGlobs.map((pattern) =>
            glob(pattern, { cwd: srcRoot, absolute: true, ignore: '**/*.test.*' })
          )
        )
      ).flat();

      const referenced = new Set<string>();
      // Only count names dispatched via the method transports — `callMethod(...)`
      // and `subscribeLiveQuery(...)`. This deliberately ignores `getConfig(...)`
      // and other `'_system.*'` literals (e.g. config keys) that are not method
      // dispatches and therefore never hit the deny-by-default boundary.
      // The optional `<...>` covers both `callMethod('_system…')` and
      // `callMethod<T>('_system…')`; `\s*` spans newlines so a method string on
      // the line after the call is still collected.
      const dispatchPattern =
        /\b(?:callMethod|subscribeLiveQuery)\s*(?:<[^>]*>)?\s*\(\s*['"`](_system\.[a-zA-Z0-9_.]+)['"`]/g;
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(dispatchPattern)) {
          referenced.add(match[1]);
        }
      }

      // Sanity check: the scan must actually find the known client callers,
      // otherwise a regex/path regression would make this test vacuously pass.
      // Cover both dispatch forms: a generic call (`callMethod<T>(...)`) and a
      // plain one (`callMethod(...)`), since they are matched differently.
      expect(referenced.has('_system.user.loginWithPassword')).toBe(true); // callMethod<T>(...)
      expect(referenced.has('_system.user.logout')).toBe(true); // callMethod(...)

      const missing = [...referenced].filter((name) => !CLIENT_CALLABLE_SYSTEM_METHODS.has(name));

      expect(
        missing,
        `These _system.* methods are called from client code but are not in ` +
          `CLIENT_CALLABLE_SYSTEM_METHODS. Either allowlist them (if they are ` +
          `genuinely safe to call from an untrusted client) or remove the client ` +
          `caller: ${missing.join(', ')}`
      ).toEqual([]);
    });
  });
});
