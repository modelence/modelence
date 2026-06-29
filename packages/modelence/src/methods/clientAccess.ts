/**
 * Deny-by-default boundary for client-initiated method dispatch.
 *
 * Methods are dispatched by name from the browser via
 * `POST /api/_internal/method/:methodName` (and the live-query socket path),
 * where `:methodName` is taken verbatim from the request. The `_system.*`
 * namespace is reserved for framework-internal modules, many of which proxy
 * privileged operations (e.g. `_system.files.*` issues signed storage URLs and
 * deletes using the app's service token). Those modules are meant to be called
 * from server-side code — inside an app's own queries/mutations that enforce
 * their own authorization — NOT directly from an untrusted client.
 *
 * Rather than auth-gating each system method individually (easy to forget, and
 * silently default-open when omitted), we deny ALL `_system.*` methods from
 * client dispatch unless they appear on this explicit, hand-audited allowlist.
 * A newly added system method is therefore closed to the client by default and
 * must be consciously opened here. App-defined methods (no `_system.` prefix)
 * are unaffected.
 *
 * The allowlist is exactly the set of `_system.*` methods that the framework's
 * own client bundle (`modelence/client`) legitimately calls from the browser —
 * authentication, session, and profile flows that have no server-only caller.
 */
const SYSTEM_PREFIX = '_system.';

/**
 * Exact set of `_system.*` methods the framework's own client bundle invokes.
 * Exported so a test can assert it stays in sync with the actual client callers.
 */
export const CLIENT_CALLABLE_SYSTEM_METHODS: ReadonlySet<string> = new Set([
  // Session lifecycle (bootstrapped from the browser / SSR)
  '_system.session.init',
  '_system.session.heartbeat',
  // Authentication + account flows (the browser is the only caller)
  '_system.user.signupWithPassword',
  '_system.user.loginWithPassword',
  '_system.user.logout',
  '_system.user.verifyEmail',
  '_system.user.resendEmailVerification',
  '_system.user.sendResetPasswordToken',
  '_system.user.resetPassword',
  '_system.user.updateProfile',
  '_system.user.unlinkOAuthProvider',
]);

/**
 * Returns `true` if `methodName` is allowed to be invoked from an untrusted
 * client. App methods are always allowed; `_system.*` methods only if
 * explicitly allowlisted.
 */
export function isClientCallableMethod(methodName: string): boolean {
  if (!methodName.startsWith(SYSTEM_PREFIX)) {
    return true;
  }
  return CLIENT_CALLABLE_SYSTEM_METHODS.has(methodName);
}
