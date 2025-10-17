import io, { Socket } from 'socket.io-client';
import { WebsocketClientProvider } from '../types';
import { ClientChannel } from '../clientChannel';
import { getLocalStorageSession } from '@/client/localStorage';

let socketClient: Socket;

function init(props: { channels?: ClientChannel<unknown>[] }) {
  socketClient = io('/', {
    auth: {
      token: getLocalStorageSession()?.authToken,
    },
  });

  props.channels?.forEach((channel) => channel.init());
}

function on<T = unknown>({
  category,
  listener,
}: {
  category: string;
  listener: (data: T) => void;
}) {
  socketClient.on(category, listener);
}

function once<T = unknown>({
  category,
  listener,
}: {
  category: string;
  listener: (data: T) => void;
}) {
  socketClient.once(category, listener);
}

function off<T = unknown>({
  category,
  listener,
}: {
  category: string;
  listener: (data: T) => void;
}) {
  socketClient.off(category, listener);
}

function emit({ eventName, category, id }: { eventName: string; category: string; id: string }) {
  socketClient.emit(eventName, `${category}:${id}`);
}

function joinChannel({ category, id }: { category: string; id: string }) {
  emit({
    eventName: 'joinChannel',
    category,
    id,
  });
}

function leaveChannel({ category, id }: { category: string; id: string }) {
  emit({
    eventName: 'leaveChannel',
    category,
    id,
  });
}

const websocketProvider: WebsocketClientProvider = {
  init,
  on,
  once,
  off,
  emit,
  joinChannel,
  leaveChannel,
};

export default websocketProvider;
