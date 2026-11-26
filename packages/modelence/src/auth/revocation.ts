import type { ObjectId } from 'mongodb';
import { getWebsocketConfig } from '@/app/websocketConfig';
import { logError } from '@/telemetry';

/**
 * Cuts the WebSocket connections that a session change left without a valid
 * session. Must run after the change is written.
 *
 * Never throws: the revocation itself is already saved, and a connection that
 * was missed still has its access checked on every join, broadcast and live
 * query update.
 */
export async function revalidateUserConnections(userId: ObjectId) {
  try {
    await getWebsocketConfig().provider?.revalidateUser?.(userId.toString());
  } catch (error) {
    logError('Failed to revalidate WebSocket connections after a session change', { error });
  }
}
