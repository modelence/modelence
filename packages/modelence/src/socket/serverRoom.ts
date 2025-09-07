import { Session, User } from "@/auth/types";
import { getSocketServer } from "./server";

type CanAccessRoom = (props: {
  user: User | null,
  session: Session | null,
  roles: string[],
}) => Promise<boolean>;

export class ServerRoom<T = any> {
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
    getSocketServer()?.to(`${this.roomCategory}:${roomId}`).emit(this.roomCategory, data);
  }
}
