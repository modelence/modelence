import { Server } from "http";
import { WebsocketServerProvider } from 'modelence';
import { authenticate, ServerRoom } from 'modelence/server';
import { logInfo } from "modelence/telemetry";
import { Server as SocketServer, Socket } from 'socket.io';

let socketServer: SocketServer | null = null;

export function init({
  httpServer,
  rooms,
}: {
  httpServer: Server;
  rooms: ServerRoom[];
}) {
  socketServer = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
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
      const [roomCategory] = roomName.split(':');
      for (const room of rooms) {
        if (
          room.roomCategory === roomCategory &&
          (
            !room.canAccessRoom ||
            await room.canAccessRoom(socket.data)
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

  return socketServer;
}

function broadcast<T>({
  roomCategory,
  roomId,
  data,
}: {
  roomCategory: string,
  roomId: string,
  data: T,
}) {
  socketServer?.to(`${roomCategory}:${roomId}`).emit(roomCategory, data);
}

export default {
  init,
  broadcast,
} as WebsocketServerProvider;
