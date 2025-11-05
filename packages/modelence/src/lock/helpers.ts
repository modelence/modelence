import { randomBytes } from 'crypto';
import { locksCollection } from './collection';

/**
 * Unique identifier for this application instance.
 * Generated once per application instance to track which container owns which locks.
 */
export const containerId = randomBytes(32).toString('base64url');

/**
 * Time after which a lock is considered stale if no heartbeat update was received
 */
export const LOCK_STALE_THRESHOLD_MS = 30000; // 30 seconds

/**
 * Interval at which lock heartbeats are updated in the database
 */
export const LOCK_HEARTBEAT_INTERVAL_MS = 5000; // 5 seconds

/**
 * Map of lock types to their heartbeat interval timers
 */
const heartbeatIntervals = new Map<string, NodeJS.Timeout>();

/**
 * Acquires a lock of the specified type.
 * If the lock already exists and is owned by another container, this will fail.
 * If the lock is stale (no recent heartbeat), it will be taken over.
 *
 * @param type - The type of lock to acquire
 * @param staleThreshold - Time in ms after which a lock is considered stale (default: 30s)
 * @returns true if lock was acquired, false otherwise
 */
export async function acquireLock(
  type: string,
  staleThreshold: number = LOCK_STALE_THRESHOLD_MS
): Promise<boolean> {
  const now = new Date();
  const staleThresholdDate = new Date(now.getTime() - staleThreshold);

  console.log(`Attempting to acquire lock: ${type}`);

  // Try to insert a new lock
  try {
    await locksCollection.insertOne({
      type,
      containerId,
      acquiredAt: now,
      heartbeatAt: now,
    });
    return true;
  } catch {
    // Lock already exists, check if it's stale
    const existingLock = await locksCollection.findOne({
      type,
      heartbeatAt: { $lt: staleThresholdDate },
    });

    if (!existingLock) {
      // Lock exists and is not stale
      return false;
    }

    // Try to acquire the stale lock
    const result = await locksCollection.updateOne(
      {
        type,
        heartbeatAt: { $lt: staleThresholdDate },
      },
      {
        $set: {
          containerId,
          acquiredAt: now,
          heartbeatAt: now,
        },
      }
    );

    return result.modifiedCount > 0;
  }
}

/**
 * Releases a lock of the specified type owned by this container.
 *
 * @param type - The type of lock to release
 * @returns true if lock was released, false if lock wasn't owned by this container
 */
export async function releaseLock(type: string): Promise<boolean> {
  const result = await locksCollection.deleteOne({
    type,
    containerId,
  });

  return result.deletedCount > 0;
}

/**
 * Updates the heartbeat timestamp for a lock owned by this container.
 *
 * @param type - The type of lock to update
 * @returns true if heartbeat was updated, false if lock wasn't owned by this container
 */
export async function updateLockHeartbeat(type: string): Promise<boolean> {
  const result = await locksCollection.updateOne(
    {
      type,
      containerId,
    },
    {
      $set: {
        heartbeatAt: new Date(),
      },
    }
  );

  return result.modifiedCount > 0;
}

/**
 * Verifies that this container owns the lock of the specified type.
 *
 * @param type - The type of lock to verify
 * @returns true if this container owns the lock, false otherwise
 */
export async function verifyLockOwnership(type: string): Promise<boolean> {
  const lock = await locksCollection.findOne({
    type,
    containerId,
  });

  return lock !== null;
}

/**
 * Checks if a lock of the specified type exists and is stale.
 *
 * @param type - The type of lock to check
 * @param staleThreshold - Time in ms after which a lock is considered stale (default: 30s)
 * @returns true if a stale lock exists, false otherwise
 */
export async function isStaleLock(
  type: string,
  staleThreshold: number = LOCK_STALE_THRESHOLD_MS
): Promise<boolean> {
  const staleThresholdDate = new Date(Date.now() - staleThreshold);

  const lock = await locksCollection.findOne({
    type,
    containerId: { $ne: containerId },
    heartbeatAt: { $lt: staleThresholdDate },
  });

  return lock !== null;
}

/**
 * Starts a periodic heartbeat update for a lock of the specified type.
 * The heartbeat will be updated every LOCK_HEARTBEAT_INTERVAL_MS.
 * If a heartbeat is already running for this lock type, this is a no-op.
 *
 * @param type - The type of lock to start heartbeat for
 * @param interval - Custom interval in ms (default: 5 seconds)
 */
export function startLockHeartbeat(
  type: string,
  interval: number = LOCK_HEARTBEAT_INTERVAL_MS
): void {
  // Don't start if already running
  if (heartbeatIntervals.has(type)) {
    return;
  }

  const intervalId = setInterval(async () => {
    await updateLockHeartbeat(type);
  }, interval);

  heartbeatIntervals.set(type, intervalId);
}

/**
 * Stops the periodic heartbeat update for a lock of the specified type.
 *
 * @param type - The type of lock to stop heartbeat for
 */
export function stopLockHeartbeat(type: string): void {
  const intervalId = heartbeatIntervals.get(type);
  if (intervalId) {
    clearInterval(intervalId);
    heartbeatIntervals.delete(type);
  }
}

/**
 * Stops all running lock heartbeats.
 */
export function stopAllLockHeartbeats(): void {
  for (const [type, intervalId] of heartbeatIntervals.entries()) {
    clearInterval(intervalId);
    heartbeatIntervals.delete(type);
  }
}
