import { Server } from "http";
import { ServerRoom } from "./serverRoom";
import { ClientRoom } from "./clientRoom";

export interface WebsocketServerProvider {
  init(props: {
    httpServer: Server,
    rooms: ServerRoom[],
  }): void;
  broadcast<T>(props: {
    roomCategory: string,
    roomId: string,
    data: T,
  }): void;
}

export interface WebsocketClientProvider {
  init(props: {
    rooms: ClientRoom[],
  }): void;
  on<T>(props: {
    roomCategory: string,
    listener: (data: T) => void;
  }): void;
  once<T>(props: {
    roomCategory: string,
    listener: (data: T) => void;
  }): void;
  off<T>(props: {
    roomCategory: string,
    listener: (data: T) => void;
  }): void;
  emit(props: {
    eventName: string,
    roomCategory: string,
    roomId: string,
  }): void;
  joinRoom(props: {
    roomCategory: string,
    roomId: string,
  }): void;
  leaveRoom(props: {
    roomCategory: string,
    roomId: string,
  }): void;
}
