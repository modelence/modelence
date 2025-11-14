import { emailVerificationTemplate } from './emailVerficationTemplate';

describe('auth/templates/emailVerificationTemplate', () => {
  test('should generate template with name', () => {
    const result = emailVerificationTemplate({
      name: 'John',
      email: 'john@example.com',
      verificationUrl: 'https://example.com/verify?token=abc123',
    });

    expect(result).toContain('Hi John');
    expect(result).toContain('john@example.com');
    expect(result).toContain('https://example.com/verify?token=abc123');
  });

  test('should generate template without name', () => {
    const result = emailVerificationTemplate({
      email: 'user@example.com',
      verificationUrl: 'https://example.com/verify?token=xyz789',
    });

    expect(result).toContain('Hi,');
    expect(result).not.toContain('Hi undefined');
    expect(result).toContain('user@example.com');
    expect(result).toContain('https://example.com/verify?token=xyz789');
  });

  test('should include verification link twice', () => {
    const verificationUrl = 'https://example.com/verify?token=test';
    const result = emailVerificationTemplate({
      email: 'test@example.com',
      verificationUrl,
    });

    const matches = result.match(/https:\/\/example\.com\/verify\?token=test/g);
    expect(matches).toHaveLength(2);
  });

  test('should include instructions', () => {
    const result = emailVerificationTemplate({
      email: 'test@example.com',
      verificationUrl: 'https://example.com/verify',
    });

    expect(result).toContain('verify your email address');
    expect(result).toContain('If you did not request this');
  });
});
