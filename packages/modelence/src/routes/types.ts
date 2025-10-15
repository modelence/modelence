import { Request, Response, NextFunction } from 'express';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head' | 'all' | 'use';

export type RouteParams = {
  query: Record<string, string>;
  body: any;
  params: Record<string, string>;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  req: Request;
  res: Response;
  next: NextFunction;
}

export type RouteResponse<T = any> = {
  data?: T;
  status?: number;
  headers?: Record<string, string>;
  redirect?: string;
  // contentType?: string;
  // filename?: string;
};

export type RouteHandler<T = any> = (params: RouteParams) => Promise<RouteResponse<T>> | RouteResponse<T> | null;

export type RouteHandlers = {
  [key in HttpMethod]?: RouteHandler;
}

export type RouteDefinition = {
  path: string;
  handlers: RouteHandlers;
  errorHandler?: RouteHandler;
}

export type ExpressHandler = (req: Request, res: Response) => Promise<void> | void;
