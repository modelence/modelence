import { Request, Response, NextFunction } from 'express';
import type { Context } from '../methods/types';

export type HttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'delete'
  | 'patch'
  | 'options'
  | 'head'
  | 'all'
  | 'use';

export type RouteParams<T = unknown> = {
  query: Record<string, string>;
  body: T;
  params: Record<string, string>;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  rawBody?: Buffer;
  req: Request;
  res: Response;
  next: NextFunction;
};

export type RouteResponse<T = unknown> = {
  data?: T;
  status?: number;
  headers?: Record<string, string>;
  /**
   * Sets the response Content-Type before sending `data`. A Content-Type supplied
   * through `headers` takes precedence when both options are provided.
   */
  contentType?: string;
  redirect?: string;
} | null;

/**
 * Custom route handler function.
 *
 * `context.user` and `context.session` are populated when authentication succeeds:
 * - The `x-modelence-auth-token` header is checked first.
 * - If absent, the `authToken` cookie is checked. For unsafe HTTP methods (POST, PUT,
 *   PATCH, DELETE, etc.), cookie-based authentication is only accepted when the
 *   request passes `isRequestFromAllowedOrigin`. If origin validation fails, the
 *   request is treated as anonymous (`context.user` and `context.session` are null)
 *   rather than rejected.
 *
 * Note: GET routes should have no side effects, because Lax cookies are sent on
 * cross-site top-level navigations.
 */
export type RouteHandler<T = unknown> = (
  params: RouteParams,
  context: Pick<Context, 'session' | 'user'>
) => Promise<RouteResponse<T>> | RouteResponse<T>;

export type RouteHandlers = {
  [key in HttpMethod]?: RouteHandler;
};

export type BodyConfig = {
  json?:
    | boolean
    | {
        limit?: string;
      };
  urlencoded?:
    | boolean
    | {
        limit?: string;
        extended?: boolean;
      };
  raw?:
    | boolean
    | {
        limit?: string;
        type?: string | string[];
      };
};

/**
 * Definition for custom HTTP routes registered on a Module.
 *
 * Token sources that populate `context.user`:
 * 1. `x-modelence-auth-token` request header (evaluated first).
 * 2. `authToken` cookie (evaluated second). For unsafe HTTP methods (POST, PUT, DELETE,
 *    PATCH, etc.), cookie auth is only used when the request passes
 *    `isRequestFromAllowedOrigin`. If origin checks fail, the request proceeds with
 *    `context.user === null`.
 *
 * Note: GET routes should have no side effects, because Lax cookies are sent on
 * cross-site top-level navigations.
 */
export type RouteDefinition = {
  path: string;
  handlers: RouteHandlers;
  errorHandler?: RouteHandler;
  body?: BodyConfig;
};

export type ExpressHandler = (req: Request, res: Response) => Promise<void> | void;
