import { Socket } from 'socket.io';
import { z } from 'zod';
import { runLiveMethod } from '../methods';
import { getResponseTypeMap } from '../methods/serialize';
import { LiveQueryCleanup } from './context';

const subscribeLiveQuerySchema = z.object({
  subscriptionId: z.string().min(1),
  method: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});

const unsubscribeLiveQuerySchema = z.object({
  subscriptionId: z.string().min(1),
});

interface ActiveSubscription {
  cleanup: LiveQueryCleanup | null;
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
  const parsed = subscribeLiveQuerySchema.safeParse(payload);
  if (!parsed.success) {
    socket.emit('liveQueryError', {
      subscriptionId: null,
      error: `Invalid payload: ${parsed.error.message}`,
    });
    return;
  }
  const { subscriptionId, method, args } = parsed.data;

  try {
      const publish = (data: unknown) => {
        socket.emit('liveQueryData', {
          subscriptionId,
          data,
          typeMap: getResponseTypeMap(data),
        });
      };

    const cleanup = await runLiveMethod(method, args, socket.data, { publish });

    const subs = getSocketSubs(socket);
    subs.set(subscriptionId, { cleanup });
  } catch (error) {
    console.error(`[LiveQuery] Error in ${method}:`, error);
    socket.emit('liveQueryError', {
      subscriptionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function handleUnsubscribeLiveQuery(socket: Socket, payload: unknown) {
  const parsed = unsubscribeLiveQuerySchema.safeParse(payload);
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
      }
    }
    socketSubscriptions.delete(socket.id);
  }
}
