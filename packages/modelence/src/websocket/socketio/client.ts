import io, { Socket } from 'socket.io-client';
import { WebsocketClientProvider } from '../types';
import { ClientChannel } from '../clientChannel';
import { getAuthToken, getClientInfo } from '@/auth/client';
import { getClientConfig } from '@/client/clientConfig';
import { reviveResponseTypes } from '@/methods/serialize';

let socketClient: Socket | null = null;

interface ActiveLiveSubscription {
  subscriptionId: string;
  method: string;
  args: Record<string, unknown>;
  // Whether the subscription was sent on an earlier connection.
  sent: boolean;
}
const activeLiveSubscriptions = new Map<string, ActiveLiveSubscription>();

// Subscriptions sent again after a reconnect that the server has not answered yet.
const pendingResubscribes = new Set<string>();

// Socket.IO rooms belong to the server-side socket, and a reconnect gets a new one that is
// in no rooms, so joined channels are tracked here and re-joined on every connect.
const joinedChannels = new Set<string>();

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
    // A subscription made before the first connect is sent here for the first time.
    if (sub.sent) {
      pendingResubscribes.add(sub.subscriptionId);
    } else {
      activeLiveSubscriptions.set(sub.subscriptionId, { ...sub, sent: true });
    }
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
  const baseUrl = getClientConfig()?.baseUrl ?? '/';
  socketClient = io(baseUrl, {
    transports: ['websocket'],
    auth: (cb) => {
      cb({
        token: getAuthToken(),
      });
    },
  });

  // Join all channels and subscribe to all live queries on connect/reconnect
  socketClient.on('connect', () => {
    for (const channelName of joinedChannels) {
      socketClient?.emit('joinChannel', channelName);
    }

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
  const socket = getSocket();
  const channelName = `${category}:${id}`;
  joinedChannels.add(channelName);
  // Only emit if already connected; otherwise the connect handler will handle it
  if (socket.connected) {
    socket.emit('joinChannel', channelName);
  }
}

function leaveChannel({ category, id }: { category: string; id: string }) {
  const socket = getSocket();
  const channelName = `${category}:${id}`;
  joinedChannels.delete(channelName);
  // A disconnected socket is in no rooms, and the connect handler won't re-join this one
  if (socket.connected) {
    socket.emit('leaveChannel', channelName);
  }
}

let liveQueryCounter = 0;

export function subscribeLiveQuery<T = unknown>(
  method: string,
  args: Record<string, unknown>,
  onData: (data: T) => void,
  onError?: (error: string, details: { isResubscribe: boolean }) => void
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
      pendingResubscribes.delete(subscriptionId);
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
      // Whether the server refused to resume the subscription after a reconnect.
      onError?.(error, { isResubscribe: pendingResubscribes.delete(subscriptionId) });
    }
  };

  const socket = getSocket();
  socket.on('liveQueryData', handleData);
  socket.on('liveQueryError', handleError);

  activeLiveSubscriptions.set(subscriptionId, {
    subscriptionId,
    method,
    args,
    sent: socket.connected,
  });

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
    pendingResubscribes.delete(subscriptionId);
    socket.emit('unsubscribeLiveQuery', { subscriptionId });
    socket.off('liveQueryData', handleData);
    socket.off('liveQueryError', handleError);
  };
}

function reconnect() {
  if (!socketClient) {
    return;
  }
  socketClient.disconnect();
  socketClient.connect();
}

const websocketProvider: WebsocketClientProvider = {
  init,
  on,
  once,
  off,
  emit,
  joinChannel,
  leaveChannel,
  reconnect,
};

export default websocketProvider;
