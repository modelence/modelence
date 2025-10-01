import { Server } from "http";
import { ServerChannel } from "./serverChannel";
import { ClientChannel } from "./clientChannel";

export interface WebsocketServerProvider {
  init(props: {
    httpServer: Server,
    channels: ServerChannel[],
  }): Promise<void>;
  broadcast<T>(props: {
    category: string,
    id: string,
    data: T,
  }): void;
}

export interface WebsocketClientProvider {
  init(props: {
    channels?: ClientChannel[],
  }): void;
  on<T>(props: {
    category: string,
    listener: (data: T) => void;
  }): void;
  once<T>(props: {
    category: string,
    listener: (data: T) => void;
  }): void;
  off<T>(props: {
    category: string,
    listener: (data: T) => void;
  }): void;
  emit(props: {
    eventName: string,
    category: string,
    id: string,
  }): void;
  joinChannel(props: {
    category: string,
    id: string,
  }): void;
  leaveChannel(props: {
    category: string,
    id: string,
  }): void;
}
