import { Socket } from 'socket.io';
import { z } from 'zod';
import { runLiveMethod } from '../methods';

const subscribeLiveQuerySchema = z.object({
  subscriptionId: z.string().min(1),
  method: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});

const unsubscribeLiveQuerySchema = z.object({
  subscriptionId: z.string().min(1),
});

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
    const { result, trackedQueries } = await runLiveMethod(method, args, socket.data);

    socket.emit('liveQueryData', { subscriptionId, data: result });

    // Log tracked queries (change stream setup will be added later)
    if (trackedQueries.length > 0) {
      console.log(
        `[LiveQuery] ${method} (${subscriptionId}) tracking ${trackedQueries.length} queries:`,
        trackedQueries.map((q) => q.store.getName())
      );
    }

    // TODO: Set up MongoDB change streams for trackedQueries
    // TODO: On change, re-run query and emit updated data
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
  console.log(`[LiveQuery] Unsubscribed: ${subscriptionId}`);
  // TODO: Close change streams for this subscription
}

export function handleLiveQueryDisconnect(socket: Socket) {
  // TODO: Clean up any active live query subscriptions for this socket
  console.log(`[LiveQuery] Cleaning up subscriptions for socket ${socket.id}`);
}
