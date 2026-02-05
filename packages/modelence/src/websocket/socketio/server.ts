import { Server } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import { authenticate } from '@/auth';
import { getClient } from '@/db/client';
import { WebsocketServerProvider } from '../types';
import { ServerChannel } from '../serverChannel';
import {
  handleSubscribeLiveQuery,
  handleUnsubscribeLiveQuery,
  handleLiveQueryDisconnect,
} from '@/live-query';
import type { Collection, Document } from 'mongodb';

let socketServer: SocketServer | null = null;

const COLLECTION = '_modelenceSocketio';

export async function init({
  httpServer,
  channels,
}: {
  httpServer: Server;
  channels: ServerChannel[];
}) {
  const mongodbClient = getClient();

  console.log('Initializing Socket.IO server...');

  let mongoCollection: Collection<Document> | null = null;

  if (mongodbClient) {
    mongoCollection = mongodbClient.db().collection(COLLECTION);

    try {
      await mongoCollection.createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 3600, background: true }
      );
    } catch (error) {
      console.error('Failed to create index on MongoDB collection for Socket.IO:', error);
    }
  }

  socketServer = new SocketServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    adapter: mongoCollection ? createAdapter(mongoCollection) : undefined,
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
    perMessageDeflate: false,
  });

  socketServer.on('error', (error) => {
    console.error('Socket.IO error:', error);
  });

  socketServer.use(async (socket, next) => {
    // Store connection info in socket.data for use in per-request authentication
    socket.data = {
      connectionInfo: {
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        acceptLanguage: socket.handshake.headers['accept-language'],
        referrer: socket.handshake.headers.referer,
      },
    };
    next();
  });

  socketServer.on('connection', (socket: Socket) => {
    socket.on('disconnect', () => {
      handleLiveQueryDisconnect(socket);
    });

    socket.on(
      'joinChannel',
      async (payload: { channelName: string; authToken?: string | null }) => {
        const { channelName, authToken } = payload;

        // Authenticate with provided token
        let authContext;
        try {
          authContext = await authenticate(authToken ?? null);
        } catch (error) {
          console.error('Failed to authenticate on joinChannel:', error);
          socket.emit('joinError', { channel: channelName, error: 'Authentication failed' });
          return;
        }

        const [category] = channelName.split(':');
        let authorized = false;

        for (const channel of channels) {
          if (channel.category === category) {
            if (!channel.canAccessChannel || (await channel.canAccessChannel(authContext))) {
              socket.join(channelName);
              authorized = true;
              socket.emit('joinedChannel', channelName);
            }
            break; // Found matching channel - stop searching
          }
        }

        if (!authorized) {
          socket.emit('joinError', { channel: channelName, error: 'Access denied' });
        }
      }
    );

    socket.on('leaveChannel', (channelName: string) => {
      socket.leave(channelName);
      console.log(`User ${socket.id} left channel ${channelName}`);
      socket.emit('leftChannel', channelName);
    });

    socket.on('subscribeLiveQuery', (payload) => handleSubscribeLiveQuery(socket, payload));
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
