import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockRandomBytes = jest.fn();
const mockInsertOne = jest.fn();
const mockDbDisposableEmailDomains = { name: 'disposable' };
const mockEmailVerificationTokensCollection = { name: 'verification' };
const mockResetPasswordTokensCollection = { name: 'reset' };

const mockUpdateDisposableEmailListCron = jest.fn();
const mockHandleLoginWithPassword = jest.fn();
const mockHandleLogout = jest.fn();
const mockHandleSignupWithPassword = jest.fn();
const mockHandleVerifyEmail = jest.fn();
const mockHandleResendEmailVerification = jest.fn();
const mockHandleSendResetPasswordToken = jest.fn();
const mockHandleResetPassword = jest.fn();
const mockGetOwnProfile = jest.fn();
const mockHandleUpdateProfile = jest.fn();

const moduleCtorMock = jest.fn();

jest.unstable_mockModule('crypto', () => ({
  randomBytes: mockRandomBytes,
}));

jest.unstable_mockModule('./db', () => ({
  usersCollection: {
    insertOne: mockInsertOne,
  },
  dbDisposableEmailDomains: mockDbDisposableEmailDomains,
  emailVerificationTokensCollection: mockEmailVerificationTokensCollection,
  resetPasswordTokensCollection: mockResetPasswordTokensCollection,
}));

jest.unstable_mockModule('./disposableEmails', () => ({
  updateDisposableEmailListCron: mockUpdateDisposableEmailListCron,
}));

jest.unstable_mockModule('./login', () => ({
  handleLoginWithPassword: mockHandleLoginWithPassword,
  handleLogout: mockHandleLogout,
}));

jest.unstable_mockModule('./profile', () => ({
  getOwnProfile: mockGetOwnProfile,
  handleUpdateProfile: mockHandleUpdateProfile,
}));

jest.unstable_mockModule('./signup', () => ({
  handleSignupWithPassword: mockHandleSignupWithPassword,
}));

jest.unstable_mockModule('./verification', () => ({
  handleVerifyEmail: mockHandleVerifyEmail,
  handleResendEmailVerification: mockHandleResendEmailVerification,
}));

jest.unstable_mockModule('./resetPassword', () => ({
  handleSendResetPasswordToken: mockHandleSendResetPasswordToken,
  handleResetPassword: mockHandleResetPassword,
}));

const mockTime = {
  seconds: jest.fn((value: number) => value * 1000),
  minutes: jest.fn((value: number) => value * 60 * 1000),
  hours: jest.fn((value: number) => value * 60 * 60 * 1000),
  days: jest.fn((value: number) => value * 24 * 60 * 60 * 1000),
};

jest.unstable_mockModule('../time', () => ({
  time: mockTime,
}));

class ModuleMock {
  name: string;
  config: unknown;
  constructor(name: string, config: unknown) {
    moduleCtorMock(name, config);
    this.name = name;
    this.config = config;
  }
}

jest.unstable_mockModule('../app/module', () => ({
  Module: ModuleMock,
}));

const { createGuestUser, buildAuthRateLimits, default: userModule } = await import('./user');

describe('auth/user', () => {
  beforeEach(() => {
    mockRandomBytes.mockReset();
    mockInsertOne.mockReset();
  });

  test('createGuestUser inserts guest account and returns id', async () => {
    mockRandomBytes.mockReturnValue({
      toString: () => 'abc+/XYZ==',
    });
    const insertedId = 'guest-id';
    mockInsertOne.mockResolvedValue({ insertedId } as never);

    const result = await createGuestUser();

    expect(mockRandomBytes).toHaveBeenCalledWith(9);
    expect(mockInsertOne).toHaveBeenCalledWith({
      handle: 'guest_abcabXYZ==',
      status: 'active',
      createdAt: expect.any(Date),
      authMethods: {},
    });
    expect(result).toBe(insertedId);
  });

  test('module registers stores, handlers, and rate limits', () => {
    expect(userModule).toBeInstanceOf(ModuleMock);

    expect(moduleCtorMock).toHaveBeenCalledWith(
      '_system.user',
      expect.objectContaining({
        stores: expect.arrayContaining([
          expect.objectContaining({ insertOne: mockInsertOne }),
          mockDbDisposableEmailDomains,
          mockEmailVerificationTokensCollection,
          mockResetPasswordTokensCollection,
        ]),
        queries: {
          getOwnProfile: mockGetOwnProfile,
        },
        mutations: expect.objectContaining({
          signupWithPassword: mockHandleSignupWithPassword,
          loginWithPassword: mockHandleLoginWithPassword,
          logout: mockHandleLogout,
          resendEmailVerification: mockHandleResendEmailVerification,
          sendResetPasswordToken: mockHandleSendResetPasswordToken,
          resetPassword: mockHandleResetPassword,
          updateProfile: mockHandleUpdateProfile,
        }),
        cronJobs: {
          updateDisposableEmailList: mockUpdateDisposableEmailListCron,
        },
        rateLimits: expect.arrayContaining([
          expect.objectContaining({ bucket: 'signup', limit: 20 }),
          expect.objectContaining({ bucket: 'signupAttempt', limit: 50 }),
          expect.objectContaining({ bucket: 'signin', limit: 50 }),
          expect.objectContaining({ bucket: 'verification', limit: 1 }),
          expect.objectContaining({ bucket: 'passwordReset', limit: 10 }),
        ]),
        routes: [
          {
            path: '/api/_internal/auth/verify-email',
            handlers: {
              get: mockHandleVerifyEmail,
            },
          },
        ],
      })
    );
  });

  describe('buildAuthRateLimits', () => {
    let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;

    beforeEach(() => {
      mockTime.seconds.mockClear();
      mockTime.minutes.mockClear();
      mockTime.hours.mockClear();
      mockTime.days.mockClear();
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    test('returns default limits when called with no config', () => {
      const rules = buildAuthRateLimits();

      const signup15m = rules.find((r) => r.bucket === 'signup' && r.window === 15 * 60 * 1000);
      const signupDay = rules.find(
        (r) => r.bucket === 'signup' && r.window === 24 * 60 * 60 * 1000
      );
      expect(signup15m?.limit).toBe(20);
      expect(signupDay?.limit).toBe(200);

      const attempt15m = rules.find(
        (r) => r.bucket === 'signupAttempt' && r.window === 15 * 60 * 1000
      );
      const attemptDay = rules.find(
        (r) => r.bucket === 'signupAttempt' && r.window === 24 * 60 * 60 * 1000
      );
      expect(attempt15m?.limit).toBe(50);
      expect(attemptDay?.limit).toBe(500);

      expect(mockTime.seconds).toHaveBeenCalledWith(60);
      expect(mockTime.minutes).toHaveBeenCalledWith(15);
      expect(mockTime.hours).toHaveBeenCalledWith(1);
      expect(mockTime.days).toHaveBeenCalledWith(1);
    });

    test('applies signup limit overrides', () => {
      const rules = buildAuthRateLimits({
        signup: { perIp15Minutes: 5, perIpPerDay: 50 },
      });

      const signup15m = rules.find((r) => r.bucket === 'signup' && r.window === 15 * 60 * 1000);
      const signupDay = rules.find(
        (r) => r.bucket === 'signup' && r.window === 24 * 60 * 60 * 1000
      );
      expect(signup15m?.limit).toBe(5);
      expect(signupDay?.limit).toBe(50);

      // Unrelated buckets keep their defaults
      const signin15m = rules.find((r) => r.bucket === 'signin' && r.window === 15 * 60 * 1000);
      expect(signin15m?.limit).toBe(50);
    });

    test('applies partial overrides — unspecified fields keep defaults', () => {
      const rules = buildAuthRateLimits({
        signup: { perIp15Minutes: 3 },
      });

      const signup15m = rules.find((r) => r.bucket === 'signup' && r.window === 15 * 60 * 1000);
      const signupDay = rules.find(
        (r) => r.bucket === 'signup' && r.window === 24 * 60 * 60 * 1000
      );
      expect(signup15m?.limit).toBe(3);
      expect(signupDay?.limit).toBe(200); // default preserved
    });

    test('applies overrides across multiple buckets', () => {
      const rules = buildAuthRateLimits({
        signup: { perIpPerDay: 10 },
        signin: { perIp15Minutes: 5, perIpPerDay: 20 },
        passwordReset: { perEmailPerHour: 2, perEmailPerDay: 3 },
      });

      const signupDay = rules.find(
        (r) => r.bucket === 'signup' && r.window === 24 * 60 * 60 * 1000
      );
      expect(signupDay?.limit).toBe(10);

      const signin15m = rules.find((r) => r.bucket === 'signin' && r.window === 15 * 60 * 1000);
      const signinDay = rules.find(
        (r) => r.bucket === 'signin' && r.window === 24 * 60 * 60 * 1000
      );
      expect(signin15m?.limit).toBe(5);
      expect(signinDay?.limit).toBe(20);

      const pwResetEmailHour = rules.find(
        (r) => r.bucket === 'passwordReset' && r.type === 'email' && r.window === 60 * 60 * 1000
      );
      const pwResetEmailDay = rules.find(
        (r) =>
          r.bucket === 'passwordReset' && r.type === 'email' && r.window === 24 * 60 * 60 * 1000
      );
      expect(pwResetEmailHour?.limit).toBe(2);
      expect(pwResetEmailDay?.limit).toBe(3);
    });

    test('produces exactly 12 rules covering all auth buckets', () => {
      const rules = buildAuthRateLimits();
      expect(rules).toHaveLength(12);

      const buckets = new Set(rules.map((r) => r.bucket));
      expect(buckets).toEqual(
        new Set(['signup', 'signupAttempt', 'signin', 'verification', 'passwordReset'])
      );
    });

    test('array override fully replaces defaults for that bucket', () => {
      const rules = buildAuthRateLimits({
        signup: [
          { type: 'ip', window: 15 * 60 * 1000, limit: 10 },
          { type: 'ip', window: 24 * 60 * 60 * 1000, limit: 30 },
        ],
      });

      const signupRules = rules.filter((r) => r.bucket === 'signup');
      expect(signupRules).toEqual([
        { bucket: 'signup', type: 'ip', window: 15 * 60 * 1000, limit: 10 },
        { bucket: 'signup', type: 'ip', window: 24 * 60 * 60 * 1000, limit: 30 },
      ]);
    });

    test('array override can add windows beyond the built-in two', () => {
      const rules = buildAuthRateLimits({
        signup: [
          { type: 'ip', window: 60 * 1000, limit: 2 },
          { type: 'ip', window: 15 * 60 * 1000, limit: 10 },
          { type: 'ip', window: 60 * 60 * 1000, limit: 20 },
          { type: 'ip', window: 24 * 60 * 60 * 1000, limit: 30 },
        ],
      });

      const signupRules = rules.filter((r) => r.bucket === 'signup');
      expect(signupRules).toHaveLength(4);
    });

    test('array override can drop the bucket to zero rules', () => {
      const rules = buildAuthRateLimits({ signup: [] });
      const signupRules = rules.filter((r) => r.bucket === 'signup');
      expect(signupRules).toHaveLength(0);
    });

    test('array override on one bucket leaves other buckets at defaults', () => {
      const rules = buildAuthRateLimits({
        signup: [{ type: 'ip', window: 15 * 60 * 1000, limit: 7 }],
      });

      const signinRules = rules.filter((r) => r.bucket === 'signin');
      expect(signinRules).toHaveLength(2);
      const signin15m = signinRules.find((r) => r.window === 15 * 60 * 1000);
      expect(signin15m?.limit).toBe(50);
    });

    test('legacy object form still works (back-compat)', () => {
      const rules = buildAuthRateLimits({
        signup: { perIp15Minutes: 5, perIpPerDay: 50 },
      });

      const signup15m = rules.find((r) => r.bucket === 'signup' && r.window === 15 * 60 * 1000);
      const signupDay = rules.find(
        (r) => r.bucket === 'signup' && r.window === 24 * 60 * 60 * 1000
      );
      expect(signup15m?.limit).toBe(5);
      expect(signupDay?.limit).toBe(50);
    });

    test('mixing array and legacy forms across buckets works', () => {
      const rules = buildAuthRateLimits({
        signup: [{ type: 'ip', window: 15 * 60 * 1000, limit: 7 }],
        signin: { perIp15Minutes: 9 },
      });

      const signup = rules.filter((r) => r.bucket === 'signup');
      expect(signup).toHaveLength(1);
      expect(signup[0].limit).toBe(7);

      const signin15m = rules.find((r) => r.bucket === 'signin' && r.window === 15 * 60 * 1000);
      expect(signin15m?.limit).toBe(9);
      // Legacy partial override keeps unspecified default
      const signinDay = rules.find(
        (r) => r.bucket === 'signin' && r.window === 24 * 60 * 60 * 1000
      );
      expect(signinDay?.limit).toBe(500);
    });
  });
});
