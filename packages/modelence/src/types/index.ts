import { NextFunction, Request, Response } from 'express';

export interface ModelenceConfig {
  serverDir: string;
  serverEntry: string;
  postBuildCommand?: string;
}

export type ExpressMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

export interface AppServer {
  init: () => Promise<void>;
  handler: (req: Request, res: Response) => void;
  middlewares?: () => ExpressMiddleware[];
}

export type * from './email';
