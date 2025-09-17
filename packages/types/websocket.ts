import type { Server } from 'http';

type CanAccessRoom = (props: {
  user: User | null,
  session: Session | null,
  roles: string[],
}) => Promise<boolean>;

export interface IServerRoom<T = any> {
  readonly roomCategory: string;
  readonly canAccessRoom: CanAccessRoom | null;
  broadcast(roomId: string, data: T): void;
}


