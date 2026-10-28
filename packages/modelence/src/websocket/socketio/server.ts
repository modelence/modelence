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
import express, { type Request } from 'express';
import { configureTrustedProxies, getClientIp } from '@/app/clientIp';

let socketServer: SocketServer | null = null;

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
  const ipResolver = express();
  configureTrustedProxies(ipResolver);

  const getSocketClientIp = (socket: Socket) => {
    // Socket.IO upgrades do not run through Express. Use its request prototype
    // to apply the same trusted-proxy IP resolution as HTTP requests.
    const request = Object.assign(Object.create(express.request) as Request, {
      app: ipResolver,
      headers: socket.request.headers,
      socket: socket.request.socket,
    });
    return getClientIp(request);
  };

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

  socketServer.use(async (socket, next) => {
    const token = socket.handshake.auth.token;

    try {
      socket.data = await authenticate(token, getSocketClientIp(socket));
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)));
    }
  });

  socketServer.on('connection', (socket: Socket) => {
    socket.on('disconnect', () => {
      handleLiveQueryDisconnect(socket);
    });

    socket.on('joinChannel', async (channelName: string) => {
      const [category] = channelName.split(':');
      let authorized = false;

      for (const channel of channels) {
        if (channel.category === category) {
          if (!channel.canAccessChannel || (await channel.canAccessChannel(socket.data))) {
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
      handleSubscribeLiveQuery(socket, payload, getSocketClientIp(socket))
    );
    socket.on('unsubscribeLiveQuery', (payload) => handleUnsubscribeLiveQuery(socket, payload));
  });

  console.log('Socket.IO server initialized');
}

function broadcast<T>({ category, id, data }: { category: string; id: string; data: T }) {
  socketServer?.to(`${category}:${id}`).emit(category, data);
}

export default {
  init,
  broadcast,
} as WebsocketServerProvider;
