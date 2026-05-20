import { NextFunction, Request, Response } from 'express';
import type { Server as HttpServer } from 'http';

export interface ModelenceConfig {
  serverDir: string;
  serverEntry: string;
  postBuildCommand?: string;
  /** Enable server-side rendering of the user's React tree. */
  ssr?: boolean;
}

export type ExpressMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

export interface AppServerInitOptions {
  httpServer: HttpServer;
}

export interface AppServer {
  init: (options: AppServerInitOptions) => Promise<void>;
  handler: (req: Request, res: Response) => void | Promise<void>;
  middlewares?: () => ExpressMiddleware[];
}

export type * from './email';
