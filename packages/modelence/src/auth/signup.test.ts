import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ObjectId } from 'mongodb';

const createObjectId = (value: string): ObjectId =>
  ({
    toString: () => value,
  }) as unknown as ObjectId;

const mockConsumeRateLimit = vi.fn();
const mockSendVerificationEmail = vi.fn();
const mockValidateEmail = vi.fn();
const mockValidatePassword = vi.fn();
const mockValidateHandle = vi.fn();
const mockValidateProfileFields = vi.fn();
const mockIsDisposableEmail = vi.fn();
const mockHash = vi.fn();
const mockGetAuthConfig = vi.fn();
const mockFindOne = vi.fn();
const mockInsertOne = vi.fn();
const mockResolveUniqueHandle = vi.fn();

vi.doMock('../rate-limit/rules', () => ({
  consumeRateLimit: mockConsumeRateLimit,
}));

vi.doMock('./verification', () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

vi.doMock('./validators', () => ({
  validateEmail: mockValidateEmail,
  validatePassword: mockValidatePassword,
  validateHandle: mockValidateHandle,
  validateProfileFields: mockValidateProfileFields,
}));

vi.doMock('./disposableEmails', () => ({
  isDisposableEmail: mockIsDisposableEmail,
}));

vi.doMock('bcrypt', () => ({
  default: {
    hash: mockHash,
  },
  hash: mockHash,
}));

vi.doMock('@/app/authConfig', () => ({
  getAuthConfig: mockGetAuthConfig,
}));

vi.doMock('./db', () => ({
  usersCollection: {
    findOne: mockFindOne,
    insertOne: mockInsertOne,
  },
}));

vi.doMock('./utils', () => ({
  resolveUniqueHandle: mockResolveUniqueHandle,
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

  const authConfig: {
    onAfterSignup: ReturnType<typeof vi.fn>;
    onSignupError: ReturnType<typeof vi.fn>;
    onBeforeSignup?: ReturnType<typeof vi.fn>;
    allowDisposableEmails?: boolean;
    signup: { onSuccess: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn> };
  } = {
    onAfterSignup: vi.fn(),
    onSignupError: vi.fn(),
    onBeforeSignup: vi.fn(),
    signup: {
      onSuccess: vi.fn(),
      onError: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authConfig.allowDisposableEmails = false;
    authConfig.onBeforeSignup = vi.fn();
    mockGetAuthConfig.mockReturnValue(authConfig as never);
    mockValidateEmail.mockImplementation((v: unknown) => v);
    mockValidatePassword.mockImplementation((v: unknown) => v);
    mockValidateHandle.mockImplementation((v: unknown) => v);
    mockValidateProfileFields.mockImplementation((fields: unknown) => fields);
    mockResolveUniqueHandle.mockImplementation(
      async (_raw: unknown, email: unknown) => (email as string).split('@')[0]
    );
    mockConsumeRateLimit.mockResolvedValue(undefined as never);
    mockSendVerificationEmail.mockResolvedValue(undefined as never);
    mockFindOne.mockResolvedValue(null as never);
    mockHash.mockResolvedValue('hash' as never);
    mockIsDisposableEmail.mockResolvedValue(false as never);
    mockInsertOne.mockResolvedValue({ insertedId: createObjectId('generated') } as never);
  });

  test('creates user and triggers verification email', async () => {
    const insertedId = createObjectId('user-1');
    mockInsertOne.mockResolvedValue({ insertedId } as never);
    // findOne calls: 1) email check → null, 2) re-fetch after insert → user doc
    mockFindOne
      .mockResolvedValueOnce(null as never) // email check
      .mockResolvedValueOnce({
        _id: insertedId,
        handle: 'test',
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
    expect(mockHash).toHaveBeenCalled();
    expect(mockSendVerificationEmail).toHaveBeenCalledWith({
      userId: insertedId,
      email: 'test@example.com',
      baseUrl: baseContext.connectionInfo?.baseUrl,
    });
    expect(authConfig.onAfterSignup).toHaveBeenCalled();
    expect(result).toBe(insertedId);

    // The inserted document should use the email-derived handle
    expect(mockInsertOne).toHaveBeenCalledWith(expect.objectContaining({ handle: 'test' }));
  });

  test('uses provided handle when supplied', async () => {
    const insertedId = createObjectId('user-2');
    mockInsertOne.mockResolvedValue({ insertedId } as never);
    mockResolveUniqueHandle.mockResolvedValueOnce('myhandle' as never);
    // findOne calls: 1) email check → null, 2) re-fetch → user doc
    mockFindOne
      .mockResolvedValueOnce(null as never) // email check
      .mockResolvedValueOnce({
        _id: insertedId,
        handle: 'myhandle',
        createdAt: new Date(),
        authMethods: {},
        emails: [{ address: 'test@example.com', verified: false }],
      } as never);

    const result = await handleSignupWithPassword(
      { email: 'test@example.com', password: 'Secret123', handle: 'myhandle' },
      baseContext
    );

    expect(mockResolveUniqueHandle).toHaveBeenCalledWith('myhandle', 'test@example.com');
    expect(result).toBe(insertedId);
    expect(mockInsertOne).toHaveBeenCalledWith(expect.objectContaining({ handle: 'myhandle' }));
  });

  test('throws when provided handle is already taken', async () => {
    mockResolveUniqueHandle.mockRejectedValueOnce(new Error('Handle already taken.') as never);
    // findOne calls: 1) email check → null
    mockFindOne.mockResolvedValueOnce(null as never);

    await expect(
      handleSignupWithPassword(
        { email: 'test@example.com', password: 'Secret123', handle: 'taken' },
        baseContext
      )
    ).rejects.toThrow('Handle already taken.');
  });

  test('auto-generates handle with suffix when email-derived handle is taken', async () => {
    const insertedId = createObjectId('user-3');
    mockInsertOne.mockResolvedValue({ insertedId } as never);
    mockResolveUniqueHandle.mockResolvedValueOnce('test_2' as never);
    // findOne calls: 1) email check → null, 2) re-fetch → user doc
    mockFindOne
      .mockResolvedValueOnce(null as never) // email check
      .mockResolvedValueOnce({
        _id: insertedId,
        handle: 'test_2',
        createdAt: new Date(),
        authMethods: {},
        emails: [{ address: 'test@example.com', verified: false }],
      } as never);

    const result = await handleSignupWithPassword(
      { email: 'test@example.com', password: 'Secret123' },
      baseContext
    );

    expect(result).toBe(insertedId);
    expect(mockInsertOne).toHaveBeenCalledWith(expect.objectContaining({ handle: 'test_2' }));
  });

  test('includes profile fields in user document when provided', async () => {
    const insertedId = createObjectId('user-5');
    mockInsertOne.mockResolvedValue({ insertedId } as never);
    mockValidateProfileFields.mockReturnValue({
      firstName: 'John',
      lastName: 'Doe',
      avatarUrl: 'https://example.com/avatar.jpg',
    });
    // findOne calls: 1) email check → null, 2) re-fetch → user doc
    mockFindOne
      .mockResolvedValueOnce(null as never) // email check
      .mockResolvedValueOnce({
        _id: insertedId,
        handle: 'john',
        createdAt: new Date(),
        authMethods: {},
        emails: [{ address: 'john@example.com', verified: false }],
        firstName: 'John',
        lastName: 'Doe',
        avatarUrl: 'https://example.com/avatar.jpg',
      } as never);

    const result = await handleSignupWithPassword(
      {
        email: 'john@example.com',
        password: 'Secret123',
        firstName: 'John',
        lastName: 'Doe',
        avatarUrl: 'https://example.com/avatar.jpg',
      },
      baseContext
    );

    expect(mockValidateProfileFields).toHaveBeenCalledWith({
      firstName: 'John',
      lastName: 'Doe',
      avatarUrl: 'https://example.com/avatar.jpg',
    });
    expect(result).toBe(insertedId);
    expect(mockInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'john',
        firstName: 'John',
        lastName: 'Doe',
        avatarUrl: 'https://example.com/avatar.jpg',
      })
    );
  });

  test('does not include profile fields when not provided', async () => {
    const insertedId = createObjectId('user-6');
    mockInsertOne.mockResolvedValue({ insertedId } as never);
    mockValidateProfileFields.mockReturnValue({});
    // findOne calls: 1) email check → null, 2) re-fetch → user doc
    mockFindOne
      .mockResolvedValueOnce(null as never) // email check
      .mockResolvedValueOnce({
        _id: insertedId,
        handle: 'test',
        createdAt: new Date(),
        authMethods: {},
        emails: [{ address: 'test@example.com', verified: false }],
      } as never);

    await handleSignupWithPassword(
      { email: 'test@example.com', password: 'Secret123' },
      baseContext
    );

    const insertedDoc = mockInsertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedDoc).not.toHaveProperty('firstName');
    expect(insertedDoc).not.toHaveProperty('lastName');
    expect(insertedDoc).not.toHaveProperty('avatarUrl');
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

  test('invokes onBeforeSignup with normalized props before insert', async () => {
    const insertedId = createObjectId('user-before-1');
    mockInsertOne.mockResolvedValue({ insertedId } as never);
    mockFindOne.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
      _id: insertedId,
      handle: 'test',
      createdAt: new Date(),
      authMethods: {},
      emails: [{ address: 'test@example.com', verified: false }],
    } as never);

    await handleSignupWithPassword(
      {
        email: 'test@example.com',
        password: 'Secret123',
        firstName: 'Test',
        lastName: 'User',
        handle: 'desired',
      },
      baseContext
    );

    expect(authConfig.onBeforeSignup).toHaveBeenCalledWith({
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      handle: 'desired',
      provider: 'email',
      connectionInfo: baseContext.connectionInfo,
    });
    // Hook must run before insert
    const beforeOrder = authConfig.onBeforeSignup!.mock.invocationCallOrder[0];
    const insertOrder = mockInsertOne.mock.invocationCallOrder[0];
    expect(beforeOrder).toBeLessThan(insertOrder);
  });

  test('rejection from onBeforeSignup aborts signup and triggers onSignupError', async () => {
    authConfig.onBeforeSignup = vi.fn(() => {
      throw new Error('Domain not allowed');
    });
    mockFindOne.mockResolvedValueOnce(null as never);

    await expect(
      handleSignupWithPassword({ email: 'test@example.com', password: 'Secret123' }, baseContext)
    ).rejects.toThrow('Domain not allowed');

    expect(mockInsertOne).not.toHaveBeenCalled();
    expect(authConfig.onSignupError).toHaveBeenCalled();
    expect(authConfig.signup.onError).toHaveBeenCalled();
  });

  test('does not invoke onBeforeSignup when user already exists', async () => {
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
    ).rejects.toThrow('User with email already exists');

    expect(authConfig.onBeforeSignup).not.toHaveBeenCalled();
  });

  test('skips built-in disposable check when allowDisposableEmails is true', async () => {
    authConfig.allowDisposableEmails = true;
    mockIsDisposableEmail.mockResolvedValue(true as never);

    const insertedId = createObjectId('user-disposable-allowed');
    mockInsertOne.mockResolvedValue({ insertedId } as never);
    mockFindOne.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
      _id: insertedId,
      handle: 'temp',
      createdAt: new Date(),
      authMethods: {},
      emails: [{ address: 'temp@disposable.com', verified: false }],
    } as never);

    const result = await handleSignupWithPassword(
      { email: 'temp@disposable.com', password: 'Secret123' },
      baseContext
    );

    expect(result).toBe(insertedId);
    expect(mockInsertOne).toHaveBeenCalled();
  });

  test('built-in disposable check still runs when allowDisposableEmails is false (default)', async () => {
    mockIsDisposableEmail.mockResolvedValue(true as never);

    await expect(
      handleSignupWithPassword({ email: 'temp@disposable.com', password: 'Secret123' }, baseContext)
    ).rejects.toThrow('Please use a permanent email address');

    expect(authConfig.onBeforeSignup).not.toHaveBeenCalled();
    expect(mockInsertOne).not.toHaveBeenCalled();
  });
});
