import { getSocketClient } from "./client";

export class ClientRoom<T> {
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
    getSocketClient()?.on(this.roomCategory, this.onMessage);
  }

  joinRoom(roomId: string) {
    getSocketClient()?.emit('joinRoom', `${this.roomCategory}:${roomId}`);
  }

  leaveRoom(roomId: string) {
    getSocketClient()?.emit('leaveRoom', `${this.roomCategory}:${roomId}`);
  }
}
