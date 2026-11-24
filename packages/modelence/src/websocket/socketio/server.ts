import { Server } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import { authenticate } from '@/auth';
import { isSameAuthenticatedUser } from '@/auth/revalidation';
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
          const current = await authenticate(socket.data.session?.authToken ?? null, {
            persistNewSession: false,
          });
          if (
            !isSameAuthenticatedUser(socket.data, current) ||
            !(await channel.canAccessChannel(current))
          ) {
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
          const current = await authenticate(socket.data.session?.authToken ?? null, {
            persistNewSession: false,
          });
          if (
            !isSameAuthenticatedUser(socket.data, current) ||
            !(await channel.canAccessChannel!(current))
          ) {
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
} as WebsocketServerProvider;
