import { getLocalStorageSession, setWebsocketClientProvider } from 'modelence/client';
import { WebsocketClientProvider } from 'modelence';
import io, { Socket } from 'socket.io-client';
import { ClientRoom } from 'modelence/client';

let socketClient: Socket;

function init(rooms: ClientRoom<unknown>[]) {
  socketClient = io('/', {
    auth: {
      token: getLocalStorageSession()?.authToken,
    },
  });

  setWebsocketClientProvider(websocketProvider);

  rooms.forEach(room => room.init());
}

function on<T = any>({
  roomCategory,
  listener,
}: {
  roomCategory: string,
  listener: (data: T) => void,
}) {
  socketClient.on(roomCategory, listener);
}

function once<T = any>({
  roomCategory,
  listener,
}: {
  roomCategory: string,
  listener: (data: T) => void,
}) {
  socketClient.once(roomCategory, listener);
}

function off<T = any>({
  roomCategory,
  listener,
}: {
  roomCategory: string,
  listener: (data: T) => void,
}) {
  socketClient.off(roomCategory, listener);
}

function emit({
  eventName,
  roomCategory,
  roomId,
}: {
  eventName: string,
  roomCategory: string,
  roomId: string,
}) {
  socketClient.emit(eventName, `${roomCategory}:${roomId}`)
}

function joinRoom({
  roomCategory,
  roomId,
}: {
  roomCategory: string,
  roomId: string,
}) {
  emit({
    eventName: 'joinRoom',
    roomCategory,
    roomId,
  });
}

function leaveRoom({
  roomCategory,
  roomId,
}: {
  roomCategory: string,
  roomId: string,
}) {
  emit({
    eventName: 'leaveRoom',
    roomCategory,
    roomId,
  });
}

const websocketProvider: WebsocketClientProvider = {
  init,
  on,
  once,
  off,
  emit,
  joinRoom,
  leaveRoom,
};

export default websocketProvider;
