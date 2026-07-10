import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockToArray = vi.fn();
const mockAggregate = vi.fn((_pipeline: Record<string, unknown>[]) => ({
  toArray: mockToArray,
}));

vi.doMock('./db', () => ({
  usersCollection: {
    aggregate: mockAggregate,
  },
}));

const { findDuplicateEmails, formatDuplicateEmailReport } = await import('./duplicateEmails');

describe('auth/duplicateEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findDuplicateEmails', () => {
    test('excludes deleted accounts and dedupes by distinct account id', async () => {
      mockToArray.mockResolvedValue([]);

      await findDuplicateEmails();

      const pipeline = mockAggregate.mock.calls[0]?.[0] ?? [];
      expect(pipeline[0]).toEqual({
        $match: { 'emails.address': { $exists: true }, status: { $ne: 'deleted' } },
      });
      // Grouping is case-insensitive and counts distinct account ids only.
      expect(pipeline).toContainEqual(
        expect.objectContaining({
          $group: expect.objectContaining({
            _id: { $toLower: '$emails.address' },
            userIds: { $addToSet: '$_id' },
          }),
        })
      );
    });

    test('maps aggregation output into address/count/userIds groups', async () => {
      mockToArray.mockResolvedValue([
        { _id: 'alice@x.com', userIds: ['a1', 'a2'] },
        { _id: 'bob@y.com', userIds: ['b1', 'b2', 'b3'] },
      ]);

      const result = await findDuplicateEmails();

      expect(result).toEqual([
        { address: 'alice@x.com', count: 2, userIds: ['a1', 'a2'] },
        { address: 'bob@y.com', count: 3, userIds: ['b1', 'b2', 'b3'] },
      ]);
    });

    test('returns an empty list when there are no duplicates', async () => {
      mockToArray.mockResolvedValue([]);
      expect(await findDuplicateEmails()).toEqual([]);
    });

    test('caps the number of groups via the limit argument', async () => {
      mockToArray.mockResolvedValue([]);

      await findDuplicateEmails(5);

      const pipeline = mockAggregate.mock.calls[0]?.[0] ?? [];
      expect(pipeline).toContainEqual({ $limit: 5 });
    });

    test('tolerates a malformed userIds field without throwing', async () => {
      mockToArray.mockResolvedValue([{ _id: 'weird@x.com', userIds: undefined }]);

      const result = await findDuplicateEmails();

      expect(result).toEqual([{ address: 'weird@x.com', count: 0, userIds: [] }]);
    });
  });

  describe('formatDuplicateEmailReport', () => {
    test('lists every duplicate email with its account ids and actionable guidance', () => {
      const report = formatDuplicateEmailReport([
        { address: 'alice@x.com', count: 2, userIds: ['a1', 'a2'] },
      ]);

      expect(report).toContain('CRITICAL');
      expect(report).toContain('alice@x.com -> 2 accounts (a1, a2)');
      expect(report).toContain('findDuplicateEmails()');
    });
  });
});
