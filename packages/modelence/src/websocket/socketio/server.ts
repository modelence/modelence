import { Server } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import { authenticate } from '@/auth';
import { getClient } from '@/db/client';
import { WebsocketServerProvider } from '../types';
import { ServerChannel } from '../serverChannel';

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

  if (!mongodbClient) {
    console.error('Socket.IO initialization failed: MongoDB client is not initialized');
    throw new Error('Mongodb Client is not initialized');
  }

  console.log('Initializing Socket.IO server...');

  const mongoCollection = mongodbClient.db().collection(COLLECTION);

  try {
    await mongoCollection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 3600, background: true }
    );
  } catch (error) {
    console.error('Failed to create index on MongoDB collection for Socket.IO:', error);
  }

  socketServer = new SocketServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    adapter: createAdapter(mongoCollection),
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
    });

    socket.on('joinChannel', async (channelName) => {
      const [category] = channelName.split(':');
      for (const channel of channels) {
        if (
          channel.category === category &&
          (!channel.canAccessChannel || (await channel.canAccessChannel(socket.data)))
        ) {
          socket.join(channelName);
        }
      }

      socket.join(channelName);
      console.log(`User ${socket.id} joined channel ${channelName}`);
      socket.emit('joinedChannel', channelName);
    });

    socket.on('leaveChannel', (channelName) => {
      socket.leave(channelName);
      console.log(`User ${socket.id} left channel ${channelName}`);
      socket.emit('leftChannel', channelName);
    });
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
