import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { ObjectId } from 'mongodb';

const createObjectId = (value: string): ObjectId =>
  ({
    toString: () => value,
  }) as unknown as ObjectId;

const mockConsumeRateLimit = jest.fn();
const mockSendVerificationEmail = jest.fn();
const mockValidateEmail = jest.fn();
const mockValidatePassword = jest.fn();
const mockIsDisposableEmail = jest.fn();
const mockHashPassword = jest.fn();
const mockGetAuthConfig = jest.fn();
const mockFindOne = jest.fn();
const mockInsertOne = jest.fn();

jest.unstable_mockModule('../rate-limit/rules', () => ({
  consumeRateLimit: mockConsumeRateLimit,
}));

jest.unstable_mockModule('./verification', () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

jest.unstable_mockModule('./validators', () => ({
  validateEmail: mockValidateEmail,
  validatePassword: mockValidatePassword,
}));

jest.unstable_mockModule('./disposableEmails', () => ({
  isDisposableEmail: mockIsDisposableEmail,
}));

jest.unstable_mockModule('./password', () => ({
  hashPassword: mockHashPassword,
}));

jest.unstable_mockModule('@/app/authConfig', () => ({
  getAuthConfig: mockGetAuthConfig,
}));

jest.unstable_mockModule('./db', () => ({
  usersCollection: {
    findOne: mockFindOne,
    insertOne: mockInsertOne,
  },
}));

const { handleSignupWithPassword } = await import('./signup');

describe('auth/signup', () => {
  const baseContext = {
    session: { authToken: 'token', expiresAt: new Date(), userId: null },
    connectionInfo: { ip: '1.1.1.1', baseUrl: 'http://localhost' },
    user: null,
    roles: [],
    clientInfo: {
      screenWidth: 0,
      screenHeight: 0,
      windowWidth: 0,
      windowHeight: 0,
      pixelRatio: 1,
      orientation: null,
    },
  };

  const authConfig = {
    onAfterSignup: jest.fn(),
    onSignupError: jest.fn(),
    signup: {
      onSuccess: jest.fn(),
      onError: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthConfig.mockReturnValue(authConfig as never);
    mockValidateEmail.mockImplementation((v) => v);
    mockValidatePassword.mockImplementation((v) => v);
    mockConsumeRateLimit.mockResolvedValue(undefined as never);
    mockSendVerificationEmail.mockResolvedValue(undefined as never);
    mockFindOne.mockResolvedValue(null as never);
    mockHashPassword.mockResolvedValue('hash' as never);
    mockIsDisposableEmail.mockResolvedValue(false as never);
    mockInsertOne.mockResolvedValue({ insertedId: createObjectId('generated') } as never);
  });

  test('creates user and triggers verification email', async () => {
    const insertedId = createObjectId('user-1');
    mockInsertOne.mockResolvedValue({ insertedId } as never);
    mockFindOne.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
      _id: insertedId,
      handle: 'testuser',
      createdAt: new Date(),
      authMethods: {},
      emails: [{ address: 'test@example.com', verified: false }],
    } as never);

    const result = await handleSignupWithPassword(
      { email: 'test@example.com', password: 'Secret123' },
      baseContext
    );

    expect(mockValidateEmail).toHaveBeenCalledWith('test@example.com');
    expect(mockValidatePassword).toHaveBeenCalledWith('Secret123');
    expect(mockConsumeRateLimit).toHaveBeenCalledWith({
      bucket: 'signupAttempt',
      type: 'ip',
      value: '1.1.1.1',
    });
    expect(mockHashPassword).toHaveBeenCalled();
    expect(mockSendVerificationEmail).toHaveBeenCalledWith({
      userId: insertedId,
      email: 'test@example.com',
      baseUrl: baseContext.connectionInfo?.baseUrl,
    });
    expect(authConfig.onAfterSignup).toHaveBeenCalled();
    expect(result).toBe(insertedId);
  });

  test('throws when disposable email detected', async () => {
    mockIsDisposableEmail.mockResolvedValue(true as never);

    await expect(
      handleSignupWithPassword({ email: 'temp@domain.com', password: 'Secret123' }, baseContext)
    ).rejects.toThrow('Please use a permanent email address');
  });

  test('throws when user already exists', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: createObjectId('existing'),
      handle: 'existinguser',
      createdAt: new Date(),
      authMethods: {},
      status: 'active',
      emails: [{ address: 'test@example.com', verified: true }],
    } as never);

    await expect(
      handleSignupWithPassword({ email: 'test@example.com', password: 'Secret123' }, baseContext)
    ).rejects.toThrow('User with email already exists: test@example.com');

    expect(authConfig.onSignupError).toHaveBeenCalled();
    expect(authConfig.signup.onError).toHaveBeenCalled();
  });
});
