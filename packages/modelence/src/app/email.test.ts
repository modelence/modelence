import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import type { EmailPayload } from '../types';

const mockGetEmailConfig = jest.fn();

jest.unstable_mockModule('@/app/emailConfig', () => ({
  getEmailConfig: mockGetEmailConfig,
}));

const { sendEmail } = await import('./email');

describe('app/email', () => {
  beforeEach(() => {
    mockGetEmailConfig.mockReset();
  });

  test('throws when email provider is not configured', () => {
    mockGetEmailConfig.mockReturnValue({});

    expect(() => sendEmail({} as never)).toThrow(
      'Email provider is not configured, see https://docs.modelence.com/email for more details.'
    );
  });

  test('delegates to configured provider', () => {
    const sendEmailFn = jest.fn().mockReturnValue('sent');
    const provider = { sendEmail: sendEmailFn };
    const payload: EmailPayload = {
      from: 'noreply@example.com',
      to: 'test@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    };
    mockGetEmailConfig.mockReturnValue({ provider });

    const result = sendEmail(payload as never);

    expect(sendEmailFn).toHaveBeenCalledWith(payload);
    expect(result).toBe('sent');
  });
});
