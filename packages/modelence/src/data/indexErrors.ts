import { Document, IndexDescription, MongoServerError } from 'mongodb';

/**
 * Stable prefix for unique-index failure reports so log tooling and AI agents
 * can find them with a single grep, regardless of which store failed.
 */
export const INDEX_ERROR_LOG_PREFIX = '[modelence:index-error]';

/**
 * Whether an index-creation error means the collection already contains
 * documents that violate a unique constraint (Mongo duplicate-key, E11000).
 * Index-build failures sometimes surface without the 11000 code, so the
 * message is checked as a fallback.
 */
export function isUniqueIndexViolation(error: unknown): error is MongoServerError {
  if (!(error instanceof MongoServerError)) {
    return false;
  }
  return error.code === 11000 || error.message.includes('E11000');
}

/**
 * Builds the report logged when a unique index cannot be created because
 * existing documents violate it. The report is designed to be actionable by
 * an AI agent operating the application: a greppable prefix, a single-line
 * JSON details block, a runnable aggregation that locates the conflicting
 * documents for this exact index spec, and the fix/retry procedure.
 */
export function formatUniqueIndexViolationReport(
  collectionName: string,
  index: IndexDescription,
  error: MongoServerError
): string {
  const details = {
    problem: 'unique-index-violation',
    collection: collectionName,
    index: {
      name: index.name ?? null,
      key: index.key,
      collation: index.collation ?? null,
      partialFilterExpression: index.partialFilterExpression ?? null,
    },
    duplicateKey: error.keyValue ?? null,
    serverError: error.errmsg ?? error.message,
  };

  const aggregateOptions = index.collation ? { collation: index.collation } : undefined;
  const aggregateCall =
    `db.getCollection(${JSON.stringify(collectionName)})` +
    `.aggregate(${JSON.stringify(buildDuplicateLookupPipeline(index))}` +
    (aggregateOptions ? `, ${JSON.stringify(aggregateOptions)}` : '') +
    ')';

  return [
    `${INDEX_ERROR_LOG_PREFIX} Unique index '${index.name ?? JSON.stringify(index.key)}' on ` +
      `collection '${collectionName}' could not be created because existing documents already ` +
      'violate it. Until this is resolved the constraint is NOT enforced, so new duplicates ' +
      'can still be written.',
    `Details: ${JSON.stringify(details)}`,
    'Find the conflicting documents with:',
    `  ${aggregateCall}`,
    'Fix: merge, delete, or update the conflicting documents so each indexed value is unique, ' +
      'then restart the app — the index build is retried on startup.',
  ].join('\n');
}

/**
 * Aggregation that groups documents by the indexed fields and keeps groups
 * claimed by more than one document — i.e. exactly the rows blocking the
 * unique index. Mirrors the index's partial filter so non-indexed documents
 * are not reported. Capped so a badly corrupted collection cannot produce an
 * unbounded result.
 */
function buildDuplicateLookupPipeline(index: IndexDescription): Document[] {
  const fields = Object.keys(index.key);

  // Unique indexes can be multikey (any path segment may be an array), and the
  // index spec alone cannot tell which. $unwind every prefix of every indexed
  // path so individual array values are compared: it passes non-array values
  // through unchanged, so this is also correct for plain scalar fields.
  // preserveNullAndEmptyArrays keeps documents missing the field — under a
  // non-partial unique index those collide on null and must be reported too.
  const unwindStages = fields.flatMap((field) =>
    pathPrefixes(field).map((path) => ({
      $unwind: { path: `$${path}`, preserveNullAndEmptyArrays: true },
    }))
  );

  const groupId = Object.fromEntries(
    // $group _id field names cannot contain dots; the value keeps the real path.
    fields.map((field) => [field.replace(/\./g, '_'), `$${field}`])
  );

  return [
    ...(index.partialFilterExpression ? [{ $match: index.partialFilterExpression }] : []),
    ...unwindStages,
    // Distinct ids, not a row count: after $unwind one document repeating a
    // value in its own array yields several rows, but that is not a
    // cross-document conflict.
    { $group: { _id: groupId, ids: { $addToSet: '$_id' } } },
    { $match: { $expr: { $gt: [{ $size: '$ids' }, 1] } } },
    { $limit: 100 },
  ];
}

function pathPrefixes(field: string): string[] {
  const segments = field.split('.');
  return segments.map((_, index) => segments.slice(0, index + 1).join('.'));
}
