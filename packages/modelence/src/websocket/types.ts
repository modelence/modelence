import { Server } from 'http';
import { ServerChannel } from './serverChannel';
import { ClientChannel } from './clientChannel';

export interface WebsocketServerProvider {
  init(props: { httpServer: Server; channels: ServerChannel[] }): Promise<void>;
  broadcast<T>(props: { category: string; id: string; data: T }): void;
  /**
   * Called after some or all of the user's sessions were revoked. Must close
   * the user's connections, on every instance, whose session no longer
   * resolves to that user. Without it, they stay open with the revoked session.
   */
  revalidateUser?(userId: string): Promise<void>;
}

export interface WebsocketClientProvider {
  init(props: { channels?: ClientChannel[] }): void;
  on<T>(props: { category: string; listener: (data: T) => void }): void;
  once<T>(props: { category: string; listener: (data: T) => void }): void;
  off<T>(props: { category: string; listener: (data: T) => void }): void;
  emit(props: { eventName: string; category: string; id: string }): void;
  joinChannel(props: { category: string; id: string }): void;
  leaveChannel(props: { category: string; id: string }): void;
  reconnect?(): void;
}
