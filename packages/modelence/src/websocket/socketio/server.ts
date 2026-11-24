import { Server } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import { authenticate } from '@/auth';
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
  multiInstance = isMultiInstance;
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
      void deliverProtectedBroadcast(payload);
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
      let authorized = false;

      for (const channel of channels) {
        if (channel.category === category) {
          // A connection may have outlived its session or a role change.
          const current = await authenticate(socket.data.session?.authToken ?? null, {
            persistNewSession: false,
          });
          if (
            current.user?.id === socket.data.user?.id &&
            current.session.expiresAt > new Date() &&
            (!channel.canAccessChannel || (await channel.canAccessChannel(current)))
          ) {
            void socket.join(channelName);
            authorized = true;
            socket.emit('joinedChannel', channelName);
          }
          break; // Found matching channel - stop searching
        }
      }

      if (!authorized) {
        socket.emit('joinError', { channel: channelName, error: 'Access denied' });
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
  void deliverProtectedBroadcast({ category, id, data });
  if (multiInstance) {
    socketServer.serverSideEmit('_modelenceSecureBroadcast', { category, id, data });
  }
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
            current.user?.id !== socket.data.user?.id ||
            !(current.session.expiresAt > new Date()) ||
            !(await channel.canAccessChannel!(current))
          ) {
            await socket.leave(room);
            return;
          }
          socket.emit(category, data);
        } catch (error) {
          await socket.leave(room);
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
