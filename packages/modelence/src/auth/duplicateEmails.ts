import { usersCollection } from './db';

/**
 * A single email address that is shared by more than one non-deleted user
 * account, which blocks the unique `emails.address` index from being built.
 */
export type DuplicateEmailGroup = {
  address: string;
  count: number;
  userIds: string[];
};

/**
 * Finds every email address that is claimed by more than one non-deleted
 * account. These are exactly the rows that prevent the unique `emails.address`
 * index from building, so the report is used both by the framework's startup
 * pre-flight (to explain why the constraint could not be enforced) and by
 * operators resolving the duplicates by hand.
 *
 * Matching is case-insensitive to mirror the index collation: `A@x.com` and
 * `a@x.com` count as the same address.
 *
 * @param limit - Cap on the number of duplicate groups returned so a badly
 *   corrupted collection cannot produce an unbounded report. Defaults to 100.
 */
export async function findDuplicateEmails(limit = 100): Promise<DuplicateEmailGroup[]> {
  const groups = await usersCollection
    .aggregate([
      // Deleted accounts are excluded: they do not participate in the partial
      // unique index and must not be flagged for cleanup.
      { $match: { 'emails.address': { $exists: true }, status: { $ne: 'deleted' } } },
      { $unwind: '$emails' },
      {
        $group: {
          _id: { $toLower: '$emails.address' },
          userIds: { $addToSet: '$_id' },
        },
      },
      // $addToSet dedupes by _id, so a single account listing the same address
      // twice never registers as a duplicate; only distinct accounts do.
      { $match: { $expr: { $gt: [{ $size: '$userIds' }, 1] } } },
      { $sort: { _id: 1 } },
      { $limit: limit },
    ])
    .toArray();

  return groups.map((group) => {
    const userIds = Array.isArray(group.userIds) ? group.userIds : [];
    return {
      address: String(group._id),
      count: userIds.length,
      userIds: userIds.map((id) => String(id)),
    };
  });
}

/**
 * Builds the human-readable, actionable message logged when the unique email
 * index cannot be enforced because duplicates already exist. Kept pure and
 * separate from the logging call so it can be unit-tested directly.
 */
export function formatDuplicateEmailReport(duplicates: DuplicateEmailGroup[]): string {
  const lines = duplicates.map(
    (group) => `  ${group.address} -> ${group.count} accounts (${group.userIds.join(', ')})`
  );

  return [
    '[modelence] CRITICAL: the unique index on user emails could not be enforced ' +
      'because duplicate-email accounts already exist. Until these are resolved, ' +
      'concurrent sign-ups can create additional duplicate accounts for the same email.',
    `Duplicate emails (${duplicates.length}${duplicates.length >= 100 ? '+' : ''}):`,
    ...lines,
    'Resolve by keeping one account per email (e.g. disable or merge the extras), ' +
      'then restart so the constraint can be applied. ' +
      'Programmatic access: findDuplicateEmails() from modelence/server.',
  ].join('\n');
}
