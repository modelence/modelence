import { getLocalStorageSession } from '@/client/localStorage';
import io, { Socket } from 'socket.io-client';
import { ClientRoom } from './clientRoom';

let socketClient: Socket;

export function initSocketClient(rooms: ClientRoom<unknown>[]) {
  socketClient = io('/', {
    auth: {
      token: getLocalStorageSession()?.authToken,
    },
  });

  rooms.forEach(room => room.init());
}

export function getSocketClient() {
  return socketClient;
}
