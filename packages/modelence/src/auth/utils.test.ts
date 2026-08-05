import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resolveUniqueHandle } from './utils';
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
