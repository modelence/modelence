import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockRandomBytes = vi.fn();
const mockInsertOne = vi.fn();
const mockDbDisposableEmailDomains = { name: 'disposable' };
const mockEmailVerificationTokensCollection = { name: 'verification' };
const mockResetPasswordTokensCollection = { name: 'reset' };

const mockUpdateDisposableEmailListCron = vi.fn();
const mockHandleLoginWithPassword = vi.fn();
const mockHandleLogout = vi.fn();
const mockHandleSignupWithPassword = vi.fn();
const mockHandleVerifyEmail = vi.fn();
const mockHandleResendEmailVerification = vi.fn();
const mockHandleSendResetPasswordToken = vi.fn();
const mockHandleResetPassword = vi.fn();
const mockHandleResetPasswordLanding = vi.fn();
const mockGetOwnProfile = vi.fn();
const mockHandleUpdateProfile = vi.fn();

const moduleCtorMock = vi.fn();

vi.doMock('crypto', () => ({
  randomBytes: mockRandomBytes,
}));

vi.doMock('./db', () => ({
  usersCollection: {
    insertOne: mockInsertOne,
  },
  dbDisposableEmailDomains: mockDbDisposableEmailDomains,
  emailVerificationTokensCollection: mockEmailVerificationTokensCollection,
  resetPasswordTokensCollection: mockResetPasswordTokensCollection,
}));

vi.doMock('./disposableEmails', () => ({
  updateDisposableEmailListCron: mockUpdateDisposableEmailListCron,
}));

vi.doMock('./login', () => ({
  handleLoginWithPassword: mockHandleLoginWithPassword,
  handleLogout: mockHandleLogout,
}));

vi.doMock('./profile', () => ({
  getOwnProfile: mockGetOwnProfile,
  handleUpdateProfile: mockHandleUpdateProfile,
}));

vi.doMock('./signup', () => ({
  handleSignupWithPassword: mockHandleSignupWithPassword,
}));

vi.doMock('./verification', () => ({
  handleVerifyEmail: mockHandleVerifyEmail,
  handleResendEmailVerification: mockHandleResendEmailVerification,
}));

vi.doMock('./resetPassword', () => ({
  handleSendResetPasswordToken: mockHandleSendResetPasswordToken,
  handleResetPassword: mockHandleResetPassword,
  handleResetPasswordLanding: mockHandleResetPasswordLanding,
}));

const mockTime = {
  seconds: vi.fn((value: number) => value * 1000),
  minutes: vi.fn((value: number) => value * 60 * 1000),
  hours: vi.fn((value: number) => value * 60 * 60 * 1000),
  days: vi.fn((value: number) => value * 24 * 60 * 60 * 1000),
};

vi.doMock('../time', () => ({
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

vi.doMock('../app/module', () => ({
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
          {
            path: '/api/_internal/auth/reset-password',
            handlers: {
              get: mockHandleResetPasswordLanding,
            },
          },
        ],
      })
    );
  });

  describe('buildAuthRateLimits', () => {
    beforeEach(() => {
      mockTime.seconds.mockClear();
      mockTime.minutes.mockClear();
      mockTime.hours.mockClear();
      mockTime.days.mockClear();
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

    test('produces exactly 12 rules covering all auth buckets', () => {
      const rules = buildAuthRateLimits();
      expect(rules).toHaveLength(12);

      const buckets = new Set(rules.map((r) => r.bucket));
      expect(buckets).toEqual(
        new Set(['signup', 'signupAttempt', 'signin', 'verification', 'passwordReset'])
      );
    });

    test('array override merges into defaults by (bucket, type, window)', () => {
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

    test('array override of a single window preserves the other defaults', () => {
      const rules = buildAuthRateLimits({
        signup: [{ type: 'ip', window: 15 * 60 * 1000, limit: 5 }],
      });

      const signupRules = rules.filter((r) => r.bucket === 'signup');
      expect(signupRules).toHaveLength(2);
      const signup15m = signupRules.find((r) => r.window === 15 * 60 * 1000);
      const signupDay = signupRules.find((r) => r.window === 24 * 60 * 60 * 1000);
      expect(signup15m?.limit).toBe(5);
      expect(signupDay?.limit).toBe(200);
    });

    test('array override can add new windows alongside the defaults', () => {
      const rules = buildAuthRateLimits({
        signup: [
          { type: 'ip', window: 60 * 1000, limit: 2 },
          { type: 'ip', window: 60 * 60 * 1000, limit: 20 },
        ],
      });

      const signupRules = rules.filter((r) => r.bucket === 'signup');
      // 2 defaults + 2 additions = 4
      expect(signupRules).toHaveLength(4);
      const windows = signupRules.map((r) => r.window).sort((a, b) => a - b);
      expect(windows).toEqual([60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000]);
    });

    test('empty array override leaves the bucket defaults intact', () => {
      const rules = buildAuthRateLimits({ signup: [] });
      const signupRules = rules.filter((r) => r.bucket === 'signup');
      expect(signupRules).toHaveLength(2);
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

    test('overrides applied across multiple buckets', () => {
      const rules = buildAuthRateLimits({
        signup: [{ type: 'ip', window: 24 * 60 * 60 * 1000, limit: 10 }],
        signin: [
          { type: 'ip', window: 15 * 60 * 1000, limit: 5 },
          { type: 'ip', window: 24 * 60 * 60 * 1000, limit: 20 },
        ],
        passwordReset: [
          { type: 'email', window: 60 * 60 * 1000, limit: 2 },
          { type: 'email', window: 24 * 60 * 60 * 1000, limit: 3 },
        ],
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
  });
});
