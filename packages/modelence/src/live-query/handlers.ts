import { Socket } from 'socket.io';
import { z } from 'zod';
import { authenticate } from '../auth';
import { runLiveMethod } from '../methods';
import { getResponseTypeMap } from '../methods/serialize';
import { LiveQueryCleanup } from './context';
import { Context } from '@/methods/types';

interface ActiveSubscription {
  cleanup: LiveQueryCleanup | null;
  aborted?: boolean;
}

const socketSubscriptions = new Map<string, Map<string, ActiveSubscription>>();

function getSocketSubs(socket: Socket): Map<string, ActiveSubscription> {
  let subs = socketSubscriptions.get(socket.id);
  if (!subs) {
    subs = new Map();
    socketSubscriptions.set(socket.id, subs);
  }
  return subs;
}

export async function handleSubscribeLiveQuery(socket: Socket, payload: unknown) {
  const parsed = z
    .object({
      subscriptionId: z.string().min(1),
      method: z.string().min(1),
      args: z.record(z.unknown()).default({}),
      authToken: z.string().nullish(),
      clientInfo: z.object({
        screenWidth: z.number(),
        screenHeight: z.number(),
        windowWidth: z.number(),
        windowHeight: z.number(),
        pixelRatio: z.number(),
        orientation: z.string().nullable(),
      }),
    })
    .safeParse(payload);
  if (!parsed.success) {
    socket.emit('liveQueryError', {
      subscriptionId: null,
      error: `Invalid payload: ${parsed.error.message}`,
    });
    return;
  }
  const { subscriptionId, method, args, authToken, clientInfo } = parsed.data;

  const subs = getSocketSubs(socket);

  // Clean up any existing subscription with the same ID (handles reconnect race conditions)
  const existingSub = subs.get(subscriptionId);
  if (existingSub) {
    if (existingSub.cleanup) {
      try {
        existingSub.cleanup();
      } catch (err) {
        console.error('[LiveQuery] Error cleaning up existing subscription:', err);
      }
    } else {
      // Subscription is still initializing - mark it for abort so it cleans up when ready
      existingSub.aborted = true;
    }
  }

  // Create placeholder entry BEFORE the async call so disconnect handler can find it
  const subscription: ActiveSubscription = { cleanup: null };
  subs.set(subscriptionId, subscription);

  try {
    const { session, user, roles } = await authenticate(authToken ?? null);

    const context: Context = {
      session,
      user,
      roles,
      clientInfo,
      connectionInfo: {
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
      },
    };

    const liveData = await runLiveMethod(method, args, context);

    const fetchAndEmit = async () => {
      const data = await liveData.fetch();
      if (subscription.aborted) {
        return;
      }
      socket.emit('liveQueryData', {
        subscriptionId,
        data,
        typeMap: getResponseTypeMap(data),
      });
    };

    // Set to true to perform initial fetch at the beginning
    let isPendingPublish = true;
    let isFetching = false;

    const processPendingPublish = () => {
      if (subscription.aborted || !isPendingPublish || isFetching) {
        return;
      }
      isPendingPublish = false;
      isFetching = true;
      fetchAndEmit()
        .catch((err) => {
          if (subscription.aborted) {
            return;
          }
          console.error(`[LiveQuery] Error fetching data for ${method}:`, err);
          socket.emit('liveQueryError', {
            subscriptionId,
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          isFetching = false;
          // Process the next pending publish if another publish was triggered while fetching
          processPendingPublish();
        });
    };

    const cleanup = liveData.watch({
      publish: () => {
        /*
          Use a pending flag to ensure concurrent publishes are processed sequentially
          (and run only once if there have been multiple publishes while the previous one was processing)
          Without sequential processing, we could end up sending an older fetch after a newer one
        */
        isPendingPublish = true;
        processPendingPublish();
      },
    });

    if (subscription.aborted) {
      // Unsubscribe/disconnect happened during watch setup - clean up immediately
      if (cleanup) {
        try {
          cleanup();
        } catch (err) {
          console.error('[LiveQuery] Error cleaning up after disconnect during setup:', err);
        }
      }
      return;
    }

    subscription.cleanup = cleanup || null;

    // Process initial fetch
    processPendingPublish();
  } catch (error) {
    subs.delete(subscriptionId);
    console.error(`[LiveQuery] Error in ${method}:`, error);
    socket.emit('liveQueryError', {
      subscriptionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function handleUnsubscribeLiveQuery(socket: Socket, payload: unknown) {
  const parsed = z
    .object({
      subscriptionId: z.string().min(1),
    })
    .safeParse(payload);
  if (!parsed.success) {
    console.warn(`[LiveQuery] Invalid unsubscribe payload: ${parsed.error.message}`);
    return;
  }
  const { subscriptionId } = parsed.data;

  const subs = socketSubscriptions.get(socket.id);
  if (!subs) return;

  const sub = subs.get(subscriptionId);
  if (sub) {
    if (sub.cleanup) {
      try {
        sub.cleanup();
      } catch (err) {
        console.error('[LiveQuery] Error in cleanup:', err);
      }
    } else {
      sub.aborted = true;
    }
    subs.delete(subscriptionId);
  }
}

export function handleLiveQueryDisconnect(socket: Socket) {
  const subs = socketSubscriptions.get(socket.id);
  if (subs) {
    // Clean up all subscriptions for this socket
    for (const sub of subs.values()) {
      if (sub.cleanup) {
        try {
          sub.cleanup();
        } catch (err) {
          console.error('[LiveQuery] Error in cleanup on disconnect:', err);
        }
      } else {
        sub.aborted = true;
      }
    }
    socketSubscriptions.delete(socket.id);
  }
}
