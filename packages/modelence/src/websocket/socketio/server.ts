import { Server } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import { authenticate } from '@/auth';
import { isIdentityStillValid } from '@/auth/revalidation';
import { getConfig } from '@/config/server';
import { getClient } from '@/db/client';
import { WebsocketServerProvider } from '../types';
import { ServerChannel } from '../serverChannel';
import {
  handleSubscribeLiveQuery,
  handleUnsubscribeLiveQuery,
  handleLiveQueryDisconnect,
} from '@/live-query';
import type { Collection, Document } from 'mongodb';
import { logError } from '@/telemetry';
import { createClientIpResolver } from '@/app/clientIp';

let socketServer: SocketServer | null = null;
let activeChannels: ServerChannel[] = [];
let multiInstance = false;
const roomDeliveryQueues = new Map<string, Promise<void>>();

const COLLECTION = '_modelenceSocketio';
const ADAPTER_TTL_SECONDS = 60;
const REVALIDATE_USER_EVENT = 'modelence:revalidateUser';

export async function init({
  httpServer,
  channels,
}: {
  httpServer: Server;
  channels: ServerChannel[];
}) {
  const mongodbClient = getClient();
  const isMultiInstance = Boolean(getConfig('_system.multiInstance'));
  const resolveClientIp = createClientIpResolver();
  activeChannels = channels;

  console.log('Initializing Socket.IO server...');

  let mongoCollection: Collection<Document> | null = null;

  if (isMultiInstance && mongodbClient) {
    mongoCollection = mongodbClient.db().collection(COLLECTION);

    try {
      await mongoCollection.createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: ADAPTER_TTL_SECONDS, background: true }
      );
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as { code: number }).code === 85) {
        try {
          await mongoCollection.dropIndex('createdAt_1');
          await mongoCollection.createIndex(
            { createdAt: 1 },
            { expireAfterSeconds: ADAPTER_TTL_SECONDS, background: true }
          );
        } catch (retryError: unknown) {
          logError('Failed to recreate index on MongoDB collection for Socket.IO:', {
            error: retryError,
            collection: COLLECTION,
          });
        }
      } else {
        logError('Failed to create index on MongoDB collection for Socket.IO:', {
          error,
          collection: COLLECTION,
        });
      }
    }
  }

  multiInstance = Boolean(mongoCollection);

  socketServer = new SocketServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    adapter: mongoCollection ? createAdapter(mongoCollection) : undefined,
    transports: ['websocket'],
    perMessageDeflate: false,
    // Don't enable `connectionStateRecovery`: it would put a connection closed
    // by `closeConnection` back into its rooms without checking its session.
  });

  socketServer.on('error', (error) => {
    logError('Socket.IO error:', { error });
  });

  socketServer.on(
    '_modelenceSecureBroadcast',
    (payload: { category: string; id: string; data: unknown }) => {
      queueProtectedBroadcast(payload);
    }
  );

  // Sent by the instance that handled the revocation to all the others.
  socketServer.on(REVALIDATE_USER_EVENT, (userId: string) => {
    void revalidateLocalConnections(userId);
  });

  socketServer.use(async (socket, next) => {
    const token = socket.handshake.auth.token;

    try {
      // The handshake never returns a session token, so do not save a new one.
      socket.data = await authenticate(token, { persistNewSession: false });
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)));
    }
  });

  socketServer.on('connection', (socket: Socket) => {
    // Every subscription uses the IP from the upgrade request.
    const clientIp = resolveClientIp(socket.request);

    socket.on('disconnect', () => {
      handleLiveQueryDisconnect(socket);
    });

    socket.on('joinChannel', async (channelName: string) => {
      if (typeof channelName !== 'string') {
        socket.emit('joinError', { channel: channelName, error: 'Access denied' });
        return;
      }
      const [category] = channelName.split(':');
      const channel = channels.find((item) => item.category === category);
      if (!channel) {
        socket.emit('joinError', { channel: channelName, error: 'Access denied' });
        return;
      }
      try {
        if (channel.canAccessChannel) {
          const current = await reauthenticate(socket);
          if (!current || !(await channel.canAccessChannel(current))) {
            socket.emit('joinError', { channel: channelName, error: 'Access denied' });
            return;
          }
        }
        await socket.join(channelName);
        socket.emit('joinedChannel', channelName);
      } catch (error) {
        logError('Failed to authorize channel join:', { error, category });
        socket.emit('joinError', { channel: channelName, error: 'Unable to join channel' });
      }
    });

    socket.on('leaveChannel', (channelName: string) => {
      void socket.leave(channelName);
      console.log(`User ${socket.id} left channel ${channelName}`);
      socket.emit('leftChannel', channelName);
    });

    socket.on('subscribeLiveQuery', (payload) =>
      handleSubscribeLiveQuery(socket, payload, clientIp)
    );
    socket.on('unsubscribeLiveQuery', (payload) => handleUnsubscribeLiveQuery(socket, payload));
  });

  console.log('Socket.IO server initialized');
}

/** Returns the socket's fresh auth, or null if its access was revoked. */
async function reauthenticate(socket: Pick<Socket, 'data'>) {
  const current = await authenticate(socket.data.session?.authToken ?? null, {
    persistNewSession: false,
  });
  if (!isIdentityStillValid(socket.data, current)) return null;
  // An anonymous token can gain a user. Remember it, so that a later sign-out
  // or switch to another user counts as a revocation.
  if (current.user) socket.data = current;
  return current;
}

/**
 * Cuts a connection that is no longer entitled to its user's data, including
 * anything still being prepared for it.
 *
 * Closes the transport rather than calling `socket.disconnect()`, which tells
 * the client not to come back. A legitimate client reconnects by itself, sends
 * the token it holds now and re-joins and re-subscribes with it.
 */
function closeConnection(socket: Socket) {
  // Discard pending packets, so a client that stopped reading can't delay it.
  socket.conn.close(true);
}

async function isConnectionRevoked(socket: Socket) {
  try {
    return (await reauthenticate(socket)) === null;
  } catch (error) {
    logError('Failed to revalidate a WebSocket connection', { error });
    return true;
  }
}

/*
  Finds the connections by scanning rather than with a room per user: a client
  can leave any room by name, and would be missed here if it left that one.
*/
async function revalidateLocalConnections(userId: string) {
  const connectionsByToken = new Map<string, Socket[]>();
  for (const socket of socketServer?.sockets.sockets.values() ?? []) {
    if (socket.data.user?.id === userId) {
      const { authToken } = socket.data.session;
      connectionsByToken.set(authToken, [...(connectionsByToken.get(authToken) ?? []), socket]);
    }
  }

  await Promise.all(
    [...connectionsByToken.values()].map(async (connections) => {
      if (await isConnectionRevoked(connections[0])) {
        connections.forEach(closeConnection);
      }
    })
  );
}

async function revalidateUser(userId: string) {
  // The in-memory adapter has no other instances to tell, and warns if asked to.
  if (multiInstance) {
    try {
      socketServer?.serverSideEmit(REVALIDATE_USER_EVENT, userId);
    } catch (error) {
      logError('Failed to forward a WebSocket revalidation', { error });
    }
  }
  await revalidateLocalConnections(userId);
}

function broadcast<T>({ category, id, data }: { category: string; id: string; data: T }) {
  if (!socketServer) return;
  const room = `${category}:${id}`;
  const channel = activeChannels.find((item) => item.category === category);
  if (!channel) return;
  if (!channel.canAccessChannel) {
    socketServer.to(room).emit(category, data);
    return;
  }

  // Each instance reauthorizes its own sockets. Do not fetch remote sockets:
  // their data includes bearer session tokens, which would otherwise travel
  // through the MongoDB adapter's request/response collection.
  queueProtectedBroadcast({ category, id, data });
  if (multiInstance) {
    try {
      socketServer.serverSideEmit('_modelenceSecureBroadcast', { category, id, data });
    } catch (error) {
      logError('Failed to forward channel broadcast:', { error, category });
    }
  }
}

function queueProtectedBroadcast<T>(payload: { category: string; id: string; data: T }) {
  const room = `${payload.category}:${payload.id}`;
  const previous = roomDeliveryQueues.get(room) ?? Promise.resolve();
  const next = previous.then(() => deliverProtectedBroadcast(payload));
  roomDeliveryQueues.set(room, next);
  void next.finally(() => {
    if (roomDeliveryQueues.get(room) === next) roomDeliveryQueues.delete(room);
  });
}

async function deliverProtectedBroadcast<T>({
  category,
  id,
  data,
}: {
  category: string;
  id: string;
  data: T;
}) {
  const channel = activeChannels.find((item) => item.category === category);
  if (!socketServer || !channel?.canAccessChannel) return;
  const room = `${category}:${id}`;
  try {
    const sockets = await socketServer.local.in(room).fetchSockets();
    await Promise.all(
      sockets.map(async (socket) => {
        try {
          const current = await reauthenticate(socket);
          if (!current || !(await channel.canAccessChannel!(current))) {
            await socket.leave(room);
            socket.emit('leftChannel', room);
            return;
          }
          socket.emit(category, data);
        } catch (error) {
          logError('Failed to authorize channel recipient:', { error, category });
        }
      })
    );
  } catch (error) {
    logError('Failed to broadcast channel message:', { error, category });
  }
}

export default {
  init,
  broadcast,
  revalidateUser,
} as WebsocketServerProvider;
