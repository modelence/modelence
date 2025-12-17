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
  redirect?: string;
  // contentType?: string;
  // filename?: string;
} | null;

export type RouteHandler<T = unknown> = (
  params: RouteParams,
  context: Pick<Context, 'session' | 'user'>
) => Promise<RouteResponse<T>> | RouteResponse<T>;

export type RouteHandlers = {
  [key in HttpMethod]?: RouteHandler;
};

export type BodyConfig = {
  json?: boolean | {
    limit?: string;
  };
  urlencoded?: boolean | {
    limit?: string;
    extended?: boolean;
  };
  raw?: boolean | {
    limit?: string;
    type?: string | string[];
  };
};

export type RouteDefinition = {
  path: string;
  handlers: RouteHandlers;
  errorHandler?: RouteHandler;
  body?: BodyConfig;
};

export type ExpressHandler = (req: Request, res: Response) => Promise<void> | void;
