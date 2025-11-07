import { randomBytes } from 'crypto';
import { locksCollection } from './collection';
import { logDebug } from '../telemetry';
import { time } from '@/time';

/**
 * Unique identifier for this application instance.
 * Generated once per application instance to track which container owns which locks.
 */
const containerId = randomBytes(32).toString('base64url');

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
 * @param lockDuration - Time in ms after which a lock is considered expired (default: 30s)
 * @returns true if lock was acquired, false otherwise
 */
export async function acquireLock(
  resource: string,
  lockDuration: number = DEFAULT_LOCK_DURATION
): Promise<boolean> {
  const now = new Date();
  const staleThresholdDate = new Date(now.getTime() - lockDuration);

  logDebug(`Attempting to acquire lock: ${resource}`, {
    source: 'lock',
    resource,
    containerId,
  });

  try {
    const result = await locksCollection.upsertOne(
      {
        $or: [
          { resource, containerId },
          { resource, acquiredAt: { $lt: staleThresholdDate } },
        ],
      },
      {
        $set: {
          resource,
          containerId,
          acquiredAt: now,
        },
      }
    );

    const isLockAcquired = result.upsertedCount > 0 || result.modifiedCount > 0;

    if (isLockAcquired) {
      logDebug(`Lock acquired: ${resource}`, {
        source: 'lock',
        resource,
        containerId,
      });
    } else {
      logDebug(`Failed to acquire lock (already held): ${resource}`, {
        source: 'lock',
        resource,
        containerId,
      });
    }

    return isLockAcquired;
  } catch {
    logDebug(`Failed to acquire lock (already held): ${resource}`, {
      source: 'lock',
      resource,
      containerId,
    });
    return false;
  }
}

/**
 * Releases a lock of the specified resource owned by this container.
 *
 * @param resource - The resource to release the lock for
 * @returns true if lock was released, false if lock wasn't owned by this container
 */
export async function releaseLock(resource: string): Promise<boolean> {
  const result = await locksCollection.deleteOne({
    resource,
    containerId,
  });

  return result.deletedCount > 0;
}

/**
 * Verifies that this container owns the lock of the specified resource.
 *
 * @param resource - The resource to verify
 * @returns true if this container owns the lock, false otherwise
 */
export async function verifyLockOwnership(resource: string): Promise<boolean> {
  const lock = await locksCollection.findOne({
    resource,
    containerId,
  });

  return lock !== null;
}
