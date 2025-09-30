import { Session, User } from "@/auth/types";
import { getWebsocketConfig } from "@/app/websocketConfig";
import { logError } from "../telemetry";

type CanAccessRoom = (props: {
  user: User | null,
  session: Session | null,
  roles: string[],
}) => Promise<boolean>;

export class ServerChannel<T = any> {
  public readonly category: string;
  public readonly canAccessRoom: CanAccessRoom | null;

  constructor(
    category: string,
    canAccessRoom?: CanAccessRoom,
  ) {
    this.category = category;
    this.canAccessRoom = canAccessRoom || null;
  }

  broadcast(id: string, data: T) {
    const websocketProvider = getWebsocketConfig().provider;
    if (!websocketProvider) {
      logError("Websockets provider should be added to startApp", {});
      return;
    }

    websocketProvider.broadcast({
      category: this.category,
      id,
      data,
    });
  }
}
