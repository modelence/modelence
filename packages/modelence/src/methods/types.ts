import { Session, UserInfo, Permission } from '../auth/types';

export type ClientInfo = {
  screenWidth: number;
  screenHeight: number;
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
  orientation: string | null;
};

export type ConnectionInfo = {
  ip?: string;
  userAgent?: string;
  acceptLanguage?: string;
  referrer?: string;
  baseUrl?: string;
};

export type Context = {
  session: Session | null;
  user: UserInfo | null;
  roles: string[];
  clientInfo: ClientInfo;
  connectionInfo: ConnectionInfo;
};

export type AuthenticatedContext = {
  session: Session;
  user: UserInfo;
  roles: string[];
  clientInfo: ClientInfo;
  connectionInfo: ConnectionInfo;
};

export type Args = Record<string, unknown>;

export type Handler<T = unknown> = (args: Args, context: Context) => Promise<T> | T;
export type AuthenticatedHandler<T = unknown> = (args: Args, context: AuthenticatedContext) => Promise<T> | T;

export type MethodType = 'query' | 'mutation';

export type MethodDefinition<T = unknown> =
  | {
      permissions?: Permission[];
      requireAuth: true;
      handler: AuthenticatedHandler<T>;
    }
  | {
      permissions?: Permission[];
      requireAuth?: false;
      handler: Handler<T>;
    }
  | Handler<T>;

export type Method<T = unknown> = {
  type: MethodType;
  name: string;
  permissions: Permission[];
  requireAuth: boolean;
  handler: Handler<T> | AuthenticatedHandler<T>;
};
