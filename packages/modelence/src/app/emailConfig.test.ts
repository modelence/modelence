import { describe, test, expect, beforeEach, jest } from '@jest/globals';

describe('emailConfig', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('returns a frozen empty config by default', async () => {
    const { getEmailConfig } = await import('./emailConfig');

    const config = getEmailConfig();

    expect(config).toEqual({});
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('merges new config properties while preserving previous ones', async () => {
    const { setEmailConfig, getEmailConfig } = await import('./emailConfig');

    const mockProvider = {
      sendEmail: jest.fn(async () => {}),
    };

    setEmailConfig({ from: 'noreply@example.com' });
    setEmailConfig({ provider: mockProvider });

    const config = getEmailConfig();

    expect(config).toMatchObject({
      from: 'noreply@example.com',
      provider: mockProvider,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('later updates override existing keys and create a new frozen object', async () => {
    const { setEmailConfig, getEmailConfig } = await import('./emailConfig');

    setEmailConfig({ from: 'first@example.com' });
    const previousConfig = getEmailConfig();

    setEmailConfig({ from: 'second@example.com' });

    const updatedConfig = getEmailConfig();

    expect(updatedConfig.from).toBe('second@example.com');
    expect(updatedConfig).not.toBe(previousConfig);
    expect(Object.isFrozen(updatedConfig)).toBe(true);
  });

  test('sets verification email configuration', async () => {
    const { setEmailConfig, getEmailConfig } = await import('./emailConfig');

    const verificationTemplate = ({
      name,
    }: {
      name: string;
      email: string;
      verificationUrl: string;
    }) => `Hello ${name}`;

    setEmailConfig({
      verification: {
        subject: 'Verify your email',
        template: verificationTemplate,
        redirectUrl: 'https://example.com/verified',
      },
    });

    const config = getEmailConfig();

    expect(config.verification).toMatchObject({
      subject: 'Verify your email',
      template: verificationTemplate,
      redirectUrl: 'https://example.com/verified',
    });
  });

  test('sets password reset email configuration', async () => {
    const { setEmailConfig, getEmailConfig } = await import('./emailConfig');

    const resetTemplate = ({ name, resetUrl }: { name: string; email: string; resetUrl: string }) =>
      `Hello ${name}, reset your password at ${resetUrl}`;

    setEmailConfig({
      passwordReset: {
        subject: 'Reset your password',
        template: resetTemplate,
        redirectUrl: 'https://example.com/reset-complete',
      },
    });

    const config = getEmailConfig();

    expect(config.passwordReset).toMatchObject({
      subject: 'Reset your password',
      template: resetTemplate,
      redirectUrl: 'https://example.com/reset-complete',
    });
  });

  test('sets deprecated emailVerifiedRedirectUrl', async () => {
    const { setEmailConfig, getEmailConfig } = await import('./emailConfig');

    setEmailConfig({
      emailVerifiedRedirectUrl: 'https://example.com/deprecated-redirect',
    });

    const config = getEmailConfig();

    expect(config.emailVerifiedRedirectUrl).toBe('https://example.com/deprecated-redirect');
  });

  test('sets multiple email provider configurations', async () => {
    const { setEmailConfig, getEmailConfig } = await import('./emailConfig');

    const mockProvider = {
      sendEmail: jest.fn(async () => {}),
    };

    setEmailConfig({
      provider: mockProvider,
      from: 'hello@example.com',
    });

    const config = getEmailConfig();

    expect(config.provider).toBe(mockProvider);
    expect(config.from).toBe('hello@example.com');
  });

  test('sets complete email configuration with all options', async () => {
    const { setEmailConfig, getEmailConfig } = await import('./emailConfig');

    const mockProvider = {
      sendEmail: jest.fn(async () => {}),
    };

    const verificationTemplate = ({
      name,
    }: {
      name: string;
      email: string;
      verificationUrl: string;
    }) => `Verify ${name}`;
    const resetTemplate = ({ name }: { name: string; email: string; resetUrl: string }) =>
      `Reset password for ${name}`;

    setEmailConfig({
      provider: mockProvider,
      from: 'support@example.com',
      verification: {
        subject: 'Verify Email',
        template: verificationTemplate,
        redirectUrl: 'https://example.com/verified',
      },
      passwordReset: {
        subject: 'Reset Password',
        template: resetTemplate,
        redirectUrl: 'https://example.com/reset-done',
      },
      emailVerifiedRedirectUrl: 'https://example.com/legacy',
    });

    const config = getEmailConfig();

    expect(config).toMatchObject({
      provider: mockProvider,
      from: 'support@example.com',
      verification: {
        subject: 'Verify Email',
        template: verificationTemplate,
        redirectUrl: 'https://example.com/verified',
      },
      passwordReset: {
        subject: 'Reset Password',
        template: resetTemplate,
        redirectUrl: 'https://example.com/reset-done',
      },
      emailVerifiedRedirectUrl: 'https://example.com/legacy',
    });
    expect(Object.isFrozen(config)).toBe(true);
  });
});
