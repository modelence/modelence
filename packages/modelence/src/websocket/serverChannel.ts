import { Session, User } from "@/auth/types";
import { getWebsocketConfig } from "@/app/websocketConfig";
import { logError } from "../telemetry";

type CanAccessRoom = (props: {
  user: User | null,
  session: Session | null,
  roles: string[],
}) => Promise<boolean>;

export class ServerChannel<T = any> {
  public readonly roomCategory: string;
  public readonly canAccessRoom: CanAccessRoom | null;

  constructor(
    roomCategory: string,
    canAccessRoom?: CanAccessRoom,
  ) {
    this.roomCategory = roomCategory;
    this.canAccessRoom = canAccessRoom || null;
  }

  broadcast(roomId: string, data: T) {
    const websocketProvider = getWebsocketConfig().provider;
    if (!websocketProvider) {
      logError("Websockets provider should be added to startApp", {});
      return;
    }

    websocketProvider.broadcast({
      roomCategory: this.roomCategory,
      roomId,
      data,
    });
  }
}
