import { describe, expect, test } from 'vitest';
import { MongoServerError } from 'mongodb';

import {
  INDEX_ERROR_LOG_PREFIX,
  isUniqueIndexViolation,
  formatUniqueIndexViolationReport,
} from './indexErrors';

function createDuplicateKeyError(
  overrides: { code?: number; errmsg?: string; keyValue?: Record<string, unknown> } = {}
): MongoServerError {
  const error = new MongoServerError({
    errmsg:
      overrides.errmsg ??
      'E11000 duplicate key error collection: app.users index: _modelence_emails.address_1 dup key: { emails.address: "dup@example.com" }',
  });
  error.code = overrides.code ?? 11000;
  if (overrides.keyValue) {
    error.keyValue = overrides.keyValue;
  }
  return error;
}

describe('isUniqueIndexViolation', () => {
  test('detects MongoServerError with duplicate key code 11000', () => {
    expect(isUniqueIndexViolation(createDuplicateKeyError())).toBe(true);
  });

  test('detects E11000 in the message when the code is missing', () => {
    const error = createDuplicateKeyError({ code: undefined });
    error.code = undefined;
    expect(isUniqueIndexViolation(error)).toBe(true);
  });

  test('rejects other Mongo server errors', () => {
    const error = new MongoServerError({ errmsg: 'some other failure' });
    error.code = 27;
    expect(isUniqueIndexViolation(error)).toBe(false);
  });

  test('rejects non-Mongo errors', () => {
    expect(isUniqueIndexViolation(new Error('E11000 duplicate key'))).toBe(false);
    expect(isUniqueIndexViolation(undefined)).toBe(false);
  });
});

describe('formatUniqueIndexViolationReport', () => {
  const index = {
    name: '_modelence_emails.address_1',
    key: { 'emails.address': 1 as const },
    unique: true,
    collation: { locale: 'en', strength: 2 },
    partialFilterExpression: { 'emails.address': { $exists: true } },
  };

  test('starts with the stable greppable prefix', () => {
    const report = formatUniqueIndexViolationReport('users', index, createDuplicateKeyError());
    expect(report.startsWith(INDEX_ERROR_LOG_PREFIX)).toBe(true);
  });

  test('names the collection and index and states the consequence', () => {
    const report = formatUniqueIndexViolationReport('users', index, createDuplicateKeyError());
    expect(report).toContain("collection 'users'");
    expect(report).toContain('_modelence_emails.address_1');
    expect(report).toContain('NOT enforced');
  });

  test('embeds machine-readable details including the index spec and server error', () => {
    const error = createDuplicateKeyError({
      keyValue: { 'emails.address': 'dup@example.com' },
    });
    const report = formatUniqueIndexViolationReport('users', index, error);

    const detailsLine = report.split('\n').find((line) => line.startsWith('Details: '));
    expect(detailsLine).toBeDefined();
    const details = JSON.parse(detailsLine!.slice('Details: '.length));
    expect(details).toMatchObject({
      problem: 'unique-index-violation',
      collection: 'users',
      index: {
        name: '_modelence_emails.address_1',
        key: { 'emails.address': 1 },
        collation: { locale: 'en', strength: 2 },
        partialFilterExpression: { 'emails.address': { $exists: true } },
      },
      duplicateKey: { 'emails.address': 'dup@example.com' },
    });
    expect(details.serverError).toContain('E11000');
  });

  test('includes a runnable aggregation that respects the partial filter and collation', () => {
    const report = formatUniqueIndexViolationReport('users', index, createDuplicateKeyError());

    expect(report).toContain('db.getCollection("users").aggregate(');
    expect(report).toContain('"$group"');
    expect(report).toContain('"$emails.address"');
    // Partial indexes only constrain matching documents, so the lookup must too.
    expect(report).toContain('"$exists":true');
    // Collation changes what counts as equal (e.g. case-insensitive), so the
    // aggregation must run with the same collation to find the same conflicts.
    expect(report).toContain('"collation":{"locale":"en","strength":2}');
  });

  test('unwinds every path prefix so multikey (array) duplicates are found', () => {
    const report = formatUniqueIndexViolationReport('users', index, createDuplicateKeyError());

    // The index spec alone cannot tell which segments are arrays, so both the
    // container and the leaf are unwound; $unwind is a no-op for non-arrays.
    expect(report).toContain('{"$unwind":{"path":"$emails","preserveNullAndEmptyArrays":true}}');
    expect(report).toContain(
      '{"$unwind":{"path":"$emails.address","preserveNullAndEmptyArrays":true}}'
    );
  });

  test('reports only cross-document duplicates, counting distinct document ids', () => {
    const report = formatUniqueIndexViolationReport('users', index, createDuplicateKeyError());

    // A single document repeating a value in its own array must not be
    // flagged, so grouping collects distinct ids and compares their count.
    expect(report).toContain('"ids":{"$addToSet":"$_id"}');
    expect(report).toContain('{"$gt":[{"$size":"$ids"},1]}');
    expect(report).not.toContain('"$sum"');
  });

  test('omits partial filter and collation stages when the index has neither', () => {
    const plainIndex = { name: 'handleIdx', key: { handle: 1 as const }, unique: true };
    const report = formatUniqueIndexViolationReport('users', plainIndex, createDuplicateKeyError());

    const aggregateLine = report.split('\n').find((line) => line.includes('.aggregate('));
    expect(aggregateLine).toBeDefined();
    expect(aggregateLine).not.toContain('$exists');
    expect(aggregateLine).not.toContain('collation');
    expect(aggregateLine).toContain('"$handle"');
    // Undotted fields can still be arrays (multikey), so the leaf is unwound too.
    expect(aggregateLine).toContain(
      '{"$unwind":{"path":"$handle","preserveNullAndEmptyArrays":true}}'
    );
  });

  test('sanitizes dotted field paths in the $group id', () => {
    const report = formatUniqueIndexViolationReport('users', index, createDuplicateKeyError());
    // Dots are not allowed in $group _id field names.
    expect(report).toContain('"emails_address":"$emails.address"');
  });

  test('tells the agent how to fix and retry', () => {
    const report = formatUniqueIndexViolationReport('users', index, createDuplicateKeyError());
    expect(report).toMatch(/merge|delete|update/i);
    expect(report).toMatch(/restart/i);
  });
});
