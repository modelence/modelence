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
    const token = socket.handshake.auth.token;

    try {
      socket.data = await authenticate(token);
    } finally {
      next();
    }
  });

  socketServer.on('connection', (socket: Socket) => {
    console.log(`Socket.IO client connected`);

    socket.on('disconnect', () => {
      console.log(`Socket.IO client disconnected`);
      handleLiveQueryDisconnect(socket);
    });

    socket.on('joinChannel', async (channelName: string) => {
      const [category, ...idParts] = channelName.split(':');
      const id = idParts.join(':'); // Handle IDs that might contain colons

      for (const channel of channels) {
        if (channel.category === category) {
          const canAccess =
            !channel.canAccessChannel ||
            (await channel.canAccessChannel({ id, ...socket.data }));

          if (canAccess) {
            socket.join(channelName);
            socket.emit('joinedChannel', channelName);
          } else {
            socket.emit('channelAccessDenied', channelName);
          }
          return;
        }
      }

      console.warn(`Unknown channel: ${category}`);
    });

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
