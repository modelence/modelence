import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { RateLimitError } from '../error';
import { dbRateLimits } from '../rate-limit/db';
import { initRateLimits } from '../rate-limit/rules';
import { obtainSession, sessionsCollection } from './session';
import { handleLiveQueryDisconnect, handleSubscribeLiveQuery } from '../live-query/handlers';
import * as methods from '../methods';
import type { Socket } from 'socket.io';

beforeAll(() => {
  initRateLimits([{ bucket: 'sessionCreation', type: 'ip', window: 60_000, limit: 2 }]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('a burst stops inserting sessions at the IP quota while existing sessions still work', async () => {
  vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
  type RateRecord = typeof dbRateLimits.Doc;
  type SessionRecord = typeof sessionsCollection.Doc;
  const records = new Map<string, RateRecord>();
  const sessions = new Map<string, SessionRecord>();
  const key = (filter: unknown) => String((filter as { value: unknown }).value);

  // Only collection operations are stubbed; session acquisition and the
  // rate-limit decision run through the production implementations.
  vi.spyOn(dbRateLimits, 'findOne').mockImplementation(
    async (filter) => records.get(key(filter)) ?? null
  );
  vi.spyOn(dbRateLimits, 'findOneAndUpdate').mockImplementation(async (filter) => {
    const record = records.get(key(filter));
    const limit = (filter as { windowCount: { $lt: number } }).windowCount.$lt;
    if (!record || record.windowCount >= limit) return null;
    record.windowCount++;
    return record;
  });
  vi.spyOn(dbRateLimits, 'findOneAndUpsert').mockImplementation(async (filter, update) => {
    const doc = { _id: new ObjectId(), ...update.$setOnInsert } as RateRecord;
    records.set(key(filter), doc);
    return { doc, isNew: true };
  });
  vi.spyOn(sessionsCollection, 'findOne').mockImplementation(
    async (filter) => sessions.get(String(filter.authToken)) ?? null
  );
  const insert = vi.spyOn(sessionsCollection, 'insertOne').mockImplementation(async (document) => {
    const doc = { _id: new ObjectId(), ...document } as SessionRecord;
    sessions.set(doc.authToken, doc);
    return { acknowledged: true, insertedId: doc._id };
  });

  const first = await obtainSession(null, '192.0.2.1');
  await obtainSession('invalid-token', '192.0.2.1');
  await expect(obtainSession(null, '192.0.2.1')).rejects.toBeInstanceOf(RateLimitError);
  expect(insert).toHaveBeenCalledTimes(2);

  await expect(obtainSession(first.authToken, '192.0.2.1')).resolves.toEqual(first);
  expect(insert).toHaveBeenCalledTimes(2);
  expect(records.get('192.0.2.1')?.windowCount).toBe(2);

  // An accepted WebSocket must not bypass the quota by re-authenticating
  // subscription events with missing or unknown tokens.
  const socket = {
    id: 'rate-limited-socket',
    handshake: { address: '10.0.0.5', headers: {} },
    emit: vi.fn(),
  } as unknown as Socket;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const runLiveMethod = vi
    .spyOn(methods, 'runLiveMethod')
    .mockRejectedValue(new Error('Unexpected call'));
  for (const authToken of [null, 'unknown-subscription-token']) {
    await handleSubscribeLiveQuery(
      socket,
      { subscriptionId: 'subscription-1', method: 'test', authToken },
      '192.0.2.1'
    );
    expect(socket.emit).toHaveBeenLastCalledWith('liveQueryError', {
      subscriptionId: 'subscription-1',
      error: expect.stringContaining('sessionCreation'),
    });
    expect(insert).toHaveBeenCalledTimes(2);
  }
  expect(runLiveMethod).not.toHaveBeenCalled();
  handleLiveQueryDisconnect(socket);

  await obtainSession(null, '192.0.2.2');
  expect(insert).toHaveBeenCalledTimes(3);
  expect(records.get('192.0.2.2')?.windowCount).toBe(1);
});
