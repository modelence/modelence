import { randomBytes } from 'crypto';
import { locksCollection } from './db';
import { logDebug } from '../telemetry';
import { time } from '@/time';

/**
 * In-memory cache to avoid frequent lock acquisition attempts
 * for the same resource within a short time frame.
 */
const lockCache: Record<string, number> = {};

/**
 * Time duration to consider a cached lock acquisition valid
 */
const DEFAULT_CACHE_DURATION = time.seconds(10);

/**
 * Unique identifier for this application instance.
 * Generated once per application instance to track which container owns which locks.
 */
const INSTANCE_ID = randomBytes(32).toString('base64url');

/**
 * Time after which a lock is expired
 */
const DEFAULT_LOCK_DURATION = time.seconds(30);

/**
 * Acquires a lock of the specified resource.
 * If the lock already exists and is owned by another container, this will fail.
 * If the lock is expired (no recent heartbeat), it will be taken over.
 *
 * @param resource - The type of lock to acquire
 * @param options.lockDuration - Time in ms after which a lock is considered expired (default: 30s)
 * @param options.lockCacheDuration - Time in ms to cache successful lock acquisition (default: 10s)
 * @param options.instanceId - The unique identifier for this application instance
 * @returns true if lock was acquired, false otherwise
 */
export async function acquireLock(
  resource: string,
  {
    lockDuration = DEFAULT_LOCK_DURATION,
    lockCacheDuration = DEFAULT_CACHE_DURATION,
    instanceId = INSTANCE_ID,
  }: {
    lockDuration: number;
    lockCacheDuration: number;
    instanceId: string;
  }
): Promise<boolean> {
  const now = Date.now();
  if (lockCache[resource]) {
    if (now - lockCache[resource] < 0) {
      logDebug(`Lock acquisition skipped (cached): ${resource}`, {
        source: 'lock',
        resource,
        instanceId,
      });
      return true;
    }
  }

  const staleThresholdDate = new Date(now - lockDuration);

  logDebug(`Attempting to acquire lock: ${resource}`, {
    source: 'lock',
    resource,
    instanceId,
  });

  try {
    const result = await locksCollection.upsertOne(
      {
        $or: [
          { resource, instanceId },
          { resource, acquiredAt: { $lt: staleThresholdDate } },
        ],
      },
      {
        $set: {
          resource,
          instanceId,
          acquiredAt: new Date(),
        },
      }
    );

    const isLockAcquired = result.upsertedCount > 0 || result.modifiedCount > 0;

    if (isLockAcquired) {
      lockCache[resource] = now + lockCacheDuration;
      logDebug(`Lock acquired: ${resource}`, {
        source: 'lock',
        resource,
        instanceId,
      });
    } else {
      logDebug(`Failed to acquire lock (already held): ${resource}`, {
        source: 'lock',
        resource,
        instanceId,
      });
    }

    return isLockAcquired;
  } catch {
    logDebug(`Failed to acquire lock (already held): ${resource}`, {
      source: 'lock',
      resource,
      instanceId,
    });
    return false;
  }
}

/**
 * Releases a lock of the specified resource owned by this container.
 *
 * @param resource - The resource to release the lock for
 * @param options.instanceId - The unique identifier for this application instance
 * @returns true if lock was released, false if lock wasn't owned by this container
 */
export async function releaseLock(
  resource: string,
  {
    instanceId = INSTANCE_ID,
  }: {
    instanceId: string;
  }
): Promise<boolean> {
  const result = await locksCollection.deleteOne({
    resource,
    instanceId,
  });

  lockCache[resource] = 0;

  return result.deletedCount > 0;
}
