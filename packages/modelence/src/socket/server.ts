import { Server as SocketServer, Socket } from 'socket.io';
import { logInfo } from '../telemetry';
import { authenticate } from '@/auth';
import type { ServerRoom } from './serverRoom';
import type { Server } from 'http';

let socketServer: SocketServer | null = null;

export function initSocketServer(
  httpServer: Server,
  rooms: ServerRoom[],
) {
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
      next();
    } catch (err) {
      next(new Error("Not authorized"));
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

export function getSocketServer() {
  return socketServer;
}
