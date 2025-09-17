import { getWebsocketClientProvider } from "./client";

export class ClientRoom<T = any> {
  public readonly roomCategory: string;
  private readonly onMessage: (data: T) => void;

  constructor(
    roomCategory: string,
    onMessage: (data: T) => void
  ) {
    this.roomCategory = roomCategory;
    this.onMessage = onMessage;
  }

  init() {
    getWebsocketClientProvider()?.on({
      roomCategory: this.roomCategory,
      listener: this.onMessage
    });
  }

  joinRoom(roomId: string) {
    getWebsocketClientProvider()?.joinRoom({
      roomCategory: this.roomCategory,
      roomId,
    });
  }

  leaveRoom(roomId: string) {
    getWebsocketClientProvider()?.leaveRoom({
      roomCategory: this.roomCategory,
      roomId,
    });
  }
}
