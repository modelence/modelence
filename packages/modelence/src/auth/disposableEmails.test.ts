import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { dbDisposableEmailDomains } from './db';
import { isDisposableEmail, updateDisposableEmailListCron } from './disposableEmails';

describe('auth/disposableEmails', () => {
  const findOneSpy = vi.spyOn(dbDisposableEmailDomains, 'findOne');
  const insertManySpy = vi.spyOn(dbDisposableEmailDomains, 'insertMany');

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  test('isDisposableEmail queries domains collection', async () => {
    findOneSpy.mockResolvedValueOnce({ domain: 'temp-mail.org' } as never);

    expect(await isDisposableEmail('user@temp-mail.org')).toBe(true);
    expect(findOneSpy).toHaveBeenCalledWith({ domain: 'temp-mail.org' });

    findOneSpy.mockResolvedValueOnce(null);
    expect(await isDisposableEmail('user@example.com')).toBe(false);
  });

  test('cron handler downloads domain list and stores batches', async () => {
    (global.fetch as MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('temp-mail.org\nexample.org\n'),
    } as Response);

    await updateDisposableEmailListCron.handler();

    expect(global.fetch).toHaveBeenCalled();
    expect(insertManySpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'temp-mail.org' }),
        expect.objectContaining({ domain: 'example.org' }),
      ])
    );
  });

  test('cron handler ignores duplicate insert errors', async () => {
    (global.fetch as MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('temp-mail.org'),
    } as Response);
    insertManySpy.mockRejectedValueOnce({
      name: 'MongoBulkWriteError',
    });

    await expect(updateDisposableEmailListCron.handler()).resolves.toBeUndefined();
  });

  test('updateDisposableEmailListCron uses daily interval', () => {
    expect(updateDisposableEmailListCron.interval).toBe(86400000);
  });
});
