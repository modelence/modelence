import { Session, User } from "@/auth/types";
import { getWebsocketConfig } from "@/app/websocketConfig";
import { logError } from "../telemetry";

type canAccessChannel = (props: {
  user: User | null,
  session: Session | null,
  roles: string[],
}) => Promise<boolean>;

export class ServerChannel<T = any> {
  public readonly category: string;
  public readonly canAccessChannel: canAccessChannel | null;

  constructor(
    category: string,
    canAccessChannel?: canAccessChannel,
  ) {
    this.category = category;
    this.canAccessChannel = canAccessChannel || null;
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
