import { NextFunction, Request, Response } from 'express';

export type ExpressMiddleware = (
  req: Request, 
  res: Response, 
  next: NextFunction
) => void | Promise<void>;

// Base interface for different server options like NextServer and others
export interface AppServer {
  init: () => Promise<void>;
  handler: (req: Request, res: Response) => void;
  middlewares?: () => ExpressMiddleware[];
}

export * from './email';
