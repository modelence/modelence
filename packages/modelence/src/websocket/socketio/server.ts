import { Server } from "http";
import { Server as SocketServer, Socket } from 'socket.io';
import { authenticate } from "@/auth";
import { WebsocketServerProvider } from "../types";
import { createAdapter } from "@socket.io/mongo-adapter";
import { getClient } from "@/db/client";
import { logInfo } from "@/telemetry";
import { ServerChannel } from "../serverChannel";

let socketServer: SocketServer | null = null;

const COLLECTION = '_system.socketio';

export async function init({
  httpServer,
  channels,
}: {
  httpServer: Server;
  channels: ServerChannel[];
}) {

  const mongodbClient = getClient();
  if (!mongodbClient) {
    throw new Error('');
  }

  const mongoCollection = mongodbClient.db().collection(COLLECTION);

  await mongoCollection.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 3600, background: true }
  );

  socketServer = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    adapter: createAdapter(mongoCollection),
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
    logInfo(`Socket.IO client connected`, { source: 'websocket', socketId: socket.id });
    
    socket.on('disconnect', () => {
      logInfo(`Socket.IO client disconnected`, { source: 'websocket', socketId: socket.id });
    });

    socket.on('joinRoom', async (roomName) => {
      const [category] = roomName.split(':');
      for (const channel of channels) {
        if (
          channel.category === category &&
          (
            !channel.canAccessRoom ||
            await channel.canAccessRoom(socket.data)
          )
        ) {
          socket.join(roomName);
        }
      }

      socket.join(roomName);
      console.log(`User ${socket.id} joined room ${roomName}`);
      socket.emit('joinedRoom', roomName);
    });

    socket.on('leaveRoom', (roomName) => {
      socket.leave(roomName);
      console.log(`User ${socket.id} left room ${roomName}`);
      socket.emit('leftRoom', roomName);
    });
  });

  logInfo(`Socket.IO server initialized`, { source: 'websocket' });
}

function broadcast<T>({
  category,
  id,
  data,
}: {
  category: string,
  id: string,
  data: T,
}) {
  socketServer?.to(`${category}:${id}`).emit(category, data);
}

export default {
  init,
  broadcast,
} as WebsocketServerProvider;
