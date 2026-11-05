import { describe, test, expect, vi, beforeEach } from 'vitest';
import { setQueryParams, resolveUniqueHandle } from './utils';
import { usersCollection } from './db';
import { validateHandle } from './validators';

vi.mock('./db', () => ({
  usersCollection: {
    findOne: vi.fn(),
  },
}));

describe('auth/utils resolveUniqueHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sanitizes dots and pluses from email local-part into valid handles', async () => {
    vi.mocked(usersCollection.findOne).mockResolvedValue(null);

    const handle = await resolveUniqueHandle(undefined, 'john.doe+test@example.com');
    expect(handle).toBe('john_doe_test');
    expect(() => validateHandle(handle)).not.toThrow();
  });

  test('pads short local-part with underscores', async () => {
    vi.mocked(usersCollection.findOne).mockResolvedValue(null);

    const handle = await resolveUniqueHandle(undefined, 'a@example.com');
    expect(handle).toBe('a__');
    expect(() => validateHandle(handle)).not.toThrow();
  });
});

describe('auth/utils setQueryParams', () => {
  test('replaces existing values for the same keys', () => {
    expect(
      setQueryParams('/verified?status=pending&source=signup&message=old', {
        status: 'error',
        message: 'Link expired',
      })
    ).toBe('/verified?source=signup&status=error&message=Link%20expired');
  });

  test('starts a query string when the URL has none', () => {
    expect(setQueryParams('/verified', { status: 'verified' })).toBe('/verified?status=verified');
  });

  test('joins with & when the URL already has a query string', () => {
    expect(setQueryParams('https://app.example.com/auth?next=/home', { status: 'error' })).toBe(
      'https://app.example.com/auth?next=/home&status=error'
    );
  });

  test('does not add a separator after a trailing ? or &', () => {
    expect(setQueryParams('/verified?', { status: 'verified' })).toBe('/verified?status=verified');
    expect(setQueryParams('/verified?a=1&', { status: 'verified' })).toBe(
      '/verified?a=1&status=verified'
    );
  });

  test('puts params inside a hash-router fragment, as before', () => {
    expect(setQueryParams('/#/verified', { status: 'verified' })).toBe(
      '/#/verified?status=verified'
    );
    expect(
      setQueryParams('https://app.example.com/?ref=1#/auth?next=home', { status: 'error' })
    ).toBe('https://app.example.com/?ref=1#/auth?next=home&status=error');
  });

  test('encodes values with encodeURIComponent', () => {
    expect(setQueryParams('/reset', { status: 'error', message: 'Link expired & invalid' })).toBe(
      '/reset?status=error&message=Link%20expired%20%26%20invalid'
    );
  });
});
