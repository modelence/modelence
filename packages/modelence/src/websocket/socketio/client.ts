import io, { Socket } from 'socket.io-client';
import { WebsocketClientProvider } from '../types';
import { ClientChannel } from '../clientChannel';
import { getAuthToken, getClientInfo } from '@/auth/client';
import { reviveResponseTypes } from '@/methods/serialize';

let socketClient: Socket | null = null;

interface ActiveLiveSubscription {
  subscriptionId: string;
  method: string;
  args: Record<string, unknown>;
}
const activeLiveSubscriptions = new Map<string, ActiveLiveSubscription>();

function getSocket(): Socket {
  if (!socketClient) {
    throw new Error('WebSocket not initialized. Call startWebsockets() first.');
  }
  return socketClient;
}

function resubscribeAll() {
  const authToken = getAuthToken();
  const clientInfo = getClientInfo();
  for (const sub of activeLiveSubscriptions.values()) {
    socketClient?.emit('subscribeLiveQuery', {
      subscriptionId: sub.subscriptionId,
      method: sub.method,
      args: sub.args,
      authToken,
      clientInfo,
    });
  }
}

function init(props: { channels?: ClientChannel<unknown>[] }) {
  socketClient = io('/', {
    auth: {
      token: getAuthToken(),
    },
  });

  // Subscribe to all live queries on connect/reconnect
  socketClient.on('connect', () => {
    if (activeLiveSubscriptions.size > 0) {
      console.log(
        `[Modelence] WebSocket reconnected, re-subscribing to ${activeLiveSubscriptions.size} live queries`
      );
      resubscribeAll();
    }
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
  getSocket().on(category, listener);
}

function once<T = unknown>({
  category,
  listener,
}: {
  category: string;
  listener: (data: T) => void;
}) {
  getSocket().once(category, listener);
}

function off<T = unknown>({
  category,
  listener,
}: {
  category: string;
  listener: (data: T) => void;
}) {
  getSocket().off(category, listener);
}

function emit({ eventName, category, id }: { eventName: string; category: string; id: string }) {
  getSocket().emit(eventName, `${category}:${id}`);
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

let liveQueryCounter = 0;

export function subscribeLiveQuery<T = unknown>(
  method: string,
  args: Record<string, unknown>,
  onData: (data: T) => void,
  onError?: (error: string) => void
): () => void {
  const subscriptionId = `sub-${++liveQueryCounter}-${Date.now()}`;

  const handleData = ({
    subscriptionId: sid,
    data,
    typeMap,
  }: {
    subscriptionId: string;
    data: T;
    typeMap?: Record<string, unknown>;
  }) => {
    if (sid === subscriptionId) {
      onData(reviveResponseTypes(data, typeMap));
    }
  };

  const handleError = ({
    subscriptionId: sid,
    error,
  }: {
    subscriptionId: string;
    error: string;
  }) => {
    if (sid === subscriptionId) {
      console.error(`[Modelence] Live query error for ${method}:`, error);
      onError?.(error);
    }
  };

  const socket = getSocket();
  socket.on('liveQueryData', handleData);
  socket.on('liveQueryError', handleError);

  activeLiveSubscriptions.set(subscriptionId, { subscriptionId, method, args });

  // Only emit if already connected; otherwise the connect handler will handle it
  if (socket.connected) {
    socket.emit('subscribeLiveQuery', {
      subscriptionId,
      method,
      args,
      authToken: getAuthToken(),
      clientInfo: getClientInfo(),
    });
  }

  // Return unsubscribe function
  return () => {
    activeLiveSubscriptions.delete(subscriptionId);
    socket.emit('unsubscribeLiveQuery', { subscriptionId });
    socket.off('liveQueryData', handleData);
    socket.off('liveQueryError', handleError);
  };
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
