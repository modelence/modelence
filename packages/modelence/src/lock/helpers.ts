import { randomBytes } from 'crypto';
import { MongoError } from 'mongodb';
import { locksCollection } from './db';
import { logDebug } from '../telemetry';
import { time } from '@/time';

/**
 * In-memory cache to avoid frequent lock acquisition attempts
 * for the same resource within a short time frame.
 */
const lockCache: Record<
  string,
  {
    value: boolean;
    expiresAt: number;
  }
> = {};

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

type LockOptions = {
  lockDuration?: number;
  successfulLockCacheDuration?: number;
  failedLockCacheDuration?: number;
  heartbeat?: boolean;
  bypassCache?: boolean;
  instanceId?: string;
};

type LockHeartbeat = {
  timer: ReturnType<typeof setTimeout> | null;
  stopRequested: boolean;
  lockDuration: number;
  heartbeatInterval: number;
};

const lockHeartbeats = new Map<string, LockHeartbeat>();

type DuplicateKeyMongoError = MongoError & {
  code?: number;
  keyPattern?: Record<string, unknown>;
};

const isDuplicateKeyError = (error: unknown): error is DuplicateKeyMongoError =>
  error instanceof MongoError && error.code === 11000;

const hasKeyPatternField = (error: DuplicateKeyMongoError, field: string): boolean =>
  typeof error.keyPattern === 'object' &&
  error.keyPattern !== null &&
  Object.prototype.hasOwnProperty.call(error.keyPattern, field);

/**
 * TODO(v1.0.0): Remove legacy `resource` fallback support.
 * This helper only exists for pre-1.0.0 lock documents where `_id !== resource`.
 * Delete this function and its call sites when releasing 1.0.0.
 */
const shouldFallbackToLegacyStrategy = async ({
  error,
  resource,
}: {
  error: DuplicateKeyMongoError;
  resource: string;
}): Promise<boolean> => {
  if (hasKeyPatternField(error, 'resource')) {
    return true;
  }

  if (hasKeyPatternField(error, '_id')) {
    return false;
  }

  const existingLock = (await locksCollection.findOne({ resource })) as {
    _id?: unknown;
  } | null;

  return !!existingLock && existingLock._id !== resource;
};

const tryAcquireLockById = async ({
  resource,
  staleThresholdDate,
  instanceId,
}: {
  resource: string;
  staleThresholdDate: Date;
  instanceId: string;
}): Promise<boolean> => {
  const result = await locksCollection.upsertOne(
    {
      _id: resource,
      $or: [{ instanceId }, { acquiredAt: { $lt: staleThresholdDate } }],
    },
    {
      $set: {
        resource,
        instanceId,
        acquiredAt: new Date(),
      },
      $setOnInsert: {
        _id: resource,
      },
    }
  );

  return result.upsertedCount > 0 || result.modifiedCount > 0;
};

const deleteLegacyLock = async ({
  resource,
  instanceId,
  staleThresholdDate,
}: {
  resource: string;
  instanceId: string;
  staleThresholdDate?: Date;
}): Promise<boolean> => {
  const selector = staleThresholdDate
    ? {
        resource,
        _id: { $ne: resource },
        $or: [{ instanceId }, { acquiredAt: { $lt: staleThresholdDate } }],
      }
    : {
        resource,
        instanceId,
      };

  const legacyDeleteResult = await locksCollection.deleteOne(selector);

  return legacyDeleteResult.deletedCount > 0;
};

const stopLockHeartbeat = (resource: string) => {
  const heartbeatKey = resource;
  const heartbeat = lockHeartbeats.get(heartbeatKey);
  if (!heartbeat) {
    return;
  }

  heartbeat.stopRequested = true;
  if (heartbeat.timer) {
    clearTimeout(heartbeat.timer);
    heartbeat.timer = null;
  }

  lockHeartbeats.delete(heartbeatKey);
};

const startLockHeartbeat = ({
  resource,
  lockDuration,
  instanceId,
}: {
  resource: string;
  lockDuration: number;
  instanceId: string;
}) => {
  const heartbeatInterval = Math.floor(lockDuration / 3);
  const heartbeatKey = resource;
  const existingHeartbeat = lockHeartbeats.get(heartbeatKey);

  if (
    existingHeartbeat &&
    !existingHeartbeat.stopRequested &&
    existingHeartbeat.heartbeatInterval === heartbeatInterval &&
    existingHeartbeat.lockDuration === lockDuration
  ) {
    return;
  }

  if (existingHeartbeat) {
    existingHeartbeat.stopRequested = true;
    if (existingHeartbeat.timer) {
      clearTimeout(existingHeartbeat.timer);
      existingHeartbeat.timer = null;
    }
    lockHeartbeats.delete(heartbeatKey);
  }

  const heartbeat: LockHeartbeat = {
    timer: null,
    stopRequested: false,
    lockDuration,
    heartbeatInterval,
  };

  const scheduleRefresh = () => {
    heartbeat.timer = setTimeout(() => {
      acquireLock(resource, {
        lockDuration,
        bypassCache: true,
        instanceId,
      })
        .then((isLockAcquired) => {
          if (!isLockAcquired) {
            heartbeat.stopRequested = true;
            logDebug(`Lost lock while refreshing heartbeat: ${resource}`, {
              source: 'lock',
              resource,
              instanceId,
            });
          }
        })
        .finally(() => {
          if (heartbeat.stopRequested) {
            lockHeartbeats.delete(heartbeatKey);
            return;
          }
          scheduleRefresh();
        });
    }, heartbeatInterval);
  };

  lockHeartbeats.set(heartbeatKey, heartbeat);
  scheduleRefresh();
};

/**
 * Acquires a lock of the specified resource.
 * If the lock already exists and is owned by another container, this will fail.
 * If the lock is expired (no recent heartbeat), it will be taken over.
 *
 * @param resource - The type of lock to acquire
 * @param options.lockDuration - Time in ms after which a lock is considered expired (default: 30s)
 * @param options.successfulLockCacheDuration - Time in ms to cache successful lock acquisition
 * @param options.failedLockCacheDuration - Time in ms to cache failed lock acquisition
 * @param options.heartbeat - If true, auto-refreshes lock ownership at lockDuration/3 intervals
 * @param options.bypassCache - If true, skips the in-memory cache and always hits the DB
 * @param options.instanceId - The unique identifier for this application instance
 * @returns true if lock was acquired, false otherwise
 */
export async function acquireLock(
  resource: string,
  {
    lockDuration = DEFAULT_LOCK_DURATION,
    successfulLockCacheDuration = DEFAULT_CACHE_DURATION,
    failedLockCacheDuration = DEFAULT_CACHE_DURATION,
    heartbeat,
    bypassCache,
    instanceId = INSTANCE_ID,
  }: LockOptions = {}
): Promise<boolean> {
  const now = Date.now();
  if (!bypassCache && lockCache[resource] && now < lockCache[resource].expiresAt) {
    if (lockCache[resource].value && heartbeat) {
      startLockHeartbeat({
        resource,
        lockDuration,
        instanceId,
      });
    }
    return lockCache[resource].value;
  }

  const staleThresholdDate = new Date(now - lockDuration);

  logDebug(`Attempting to acquire lock: ${resource}`, {
    source: 'lock',
    resource,
    instanceId,
  });

  try {
    const isLockAcquired = await acquireLockById({
      resource,
      staleThresholdDate,
      instanceId,
    });

    lockCache[resource] = {
      value: isLockAcquired,
      expiresAt: now + (isLockAcquired ? successfulLockCacheDuration : failedLockCacheDuration),
    };

    if (isLockAcquired) {
      if (heartbeat) {
        startLockHeartbeat({
          resource,
          lockDuration,
          instanceId,
        });
      }

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
    lockCache[resource] = {
      value: false,
      expiresAt: now + failedLockCacheDuration,
    };
    logDebug(`Failed to acquire lock (already held): ${resource}`, {
      source: 'lock',
      resource,
      instanceId,
    });
    return false;
  }
}

const acquireLockById = async ({
  resource,
  staleThresholdDate,
  instanceId,
}: {
  resource: string;
  staleThresholdDate: Date;
  instanceId: string;
}): Promise<boolean> => {
  try {
    return await tryAcquireLockById({ resource, staleThresholdDate, instanceId });
  } catch (error) {
    // TODO(v1.0.0): Remove the legacy fallback
    // Backward compatibility: if an old lock doc exists with a non-resource _id and
    // a unique `resource` index, upserting the new `_id = resource` shape can fail.
    // Migrate that legacy lock document to `_id = resource` and retry current strategy.
    if (isDuplicateKeyError(error) && (await shouldFallbackToLegacyStrategy({ error, resource }))) {
      const hasDeletedLegacyLock = await deleteLegacyLock({
        resource,
        staleThresholdDate,
        instanceId,
      });

      if (!hasDeletedLegacyLock) {
        return false;
      }

      try {
        return await tryAcquireLockById({ resource, staleThresholdDate, instanceId });
      } catch (retryError) {
        if (isDuplicateKeyError(retryError)) {
          return false;
        }
        throw retryError;
      }
    }

    // Duplicate _id means the lock exists but was not eligible for update (owned + fresh).
    if (isDuplicateKeyError(error)) {
      return false;
    }

    throw error;
  }
};

/**
 * Releases a lock of the specified resource owned by this container.
 *
 * @param resource - The resource to release the lock for
 * @param options.instanceId - The unique identifier for this application instance
 * @returns true if lock was released, false if lock wasn't owned by this container or release failed.
 */
export async function releaseLock(
  resource: string,
  {
    instanceId = INSTANCE_ID,
  }: {
    instanceId?: string;
  } = {}
): Promise<boolean> {
  stopLockHeartbeat(resource);

  try {
    const result = await locksCollection.deleteOne({
      _id: resource,
      instanceId,
    });

    // TODO(v1.0.0): Remove the legacy fallback
    if (result.deletedCount === 0) {
      const hasDeletedLegacyLock = await deleteLegacyLock({
        resource,
        instanceId,
      });

      return hasDeletedLegacyLock;
    }

    return result.deletedCount > 0;
  } catch {
    return false;
  } finally {
    delete lockCache[resource];
  }
}
