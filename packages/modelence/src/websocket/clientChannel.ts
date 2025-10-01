import { getWebsocketClientProvider } from "./client";

export class ClientChannel<T = any> {
  public readonly category: string;
  private readonly onMessage: (data: T) => void;

  constructor(
    category: string,
    onMessage: (data: T) => void
  ) {
    this.category = category;
    this.onMessage = onMessage;
  }

  init() {
    getWebsocketClientProvider()?.on({
      category: this.category,
      listener: this.onMessage
    });
  }

  joinChannel(id: string) {
    getWebsocketClientProvider()?.joinChannel({
      category: this.category,
      id,
    });
  }

  leaveChannel(id: string) {
    getWebsocketClientProvider()?.leaveChannel({
      category: this.category,
      id,
    });
  }
}
