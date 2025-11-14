import { beforeEach, describe, expect, jest, test } from '@jest/globals';

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
const mockHandleSendResetPasswordToken = jest.fn();
const mockHandleResetPassword = jest.fn();
const mockGetOwnProfile = jest.fn();

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
}));

jest.unstable_mockModule('./signup', () => ({
  handleSignupWithPassword: mockHandleSignupWithPassword,
}));

jest.unstable_mockModule('./verification', () => ({
  handleVerifyEmail: mockHandleVerifyEmail,
}));

jest.unstable_mockModule('./resetPassword', () => ({
  handleSendResetPasswordToken: mockHandleSendResetPasswordToken,
  handleResetPassword: mockHandleResetPassword,
}));

const mockTime = {
  minutes: jest.fn((value: number) => value * 60 * 1000),
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

const { createGuestUser, default: userModule } = await import('./user');

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
          sendResetPasswordToken: mockHandleSendResetPasswordToken,
          resetPassword: mockHandleResetPassword,
        }),
        cronJobs: {
          updateDisposableEmailList: mockUpdateDisposableEmailListCron,
        },
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

    expect(mockTime.minutes).toHaveBeenCalledWith(15);
    expect(mockTime.days).toHaveBeenCalledWith(1);
  });
});
