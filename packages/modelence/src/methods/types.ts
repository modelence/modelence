import type { Request, Response } from 'express';
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
  /**
   * The Express request. `null` for in-process invocations that don't have
   * an active HTTP request (e.g. background jobs).
   */
  req?: Request | null;
  /**
   * The Express response. Used by auth handlers to set/clear cookies so
   * server-rendered requests can read the auth token from the cookie jar.
   * `null` for in-process invocations that don't have an active response
   * (e.g. background jobs).
   */
  res: Response | null;
};

export type Args = Record<string, unknown>;

export type UpdateProfileProps = {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  handle?: string;
};

export type SignupProps = UpdateProfileProps & {
  email: string;
  password: string;
};

export type Handler<T = unknown> = (args: Args, context: Context) => Promise<T> | T;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMethodShape = ((...args: any[]) => any) | { handler: (...args: any[]) => any };

export type MethodType = 'query' | 'mutation';

export type MethodDefinition<T = unknown> =
  | {
      /** @internal */
      permissions?: Permission[];
      handler: Handler<T>;
    }
  | Handler<T>;

export type Method<T = unknown> = {
  type: MethodType;
  name: string;
  permissions: Permission[];
  handler: Handler<T>;
};
