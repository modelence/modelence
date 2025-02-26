import next from 'next';
import { AppServer } from '../../types';
import { Request, Response } from 'express';

class NextServer implements AppServer {
  private nextHandler?: (req: Request, res: Response) => void;

  async init() {
    const isDev = process.env.NODE_ENV !== 'production';
    const nextApp = next({ dev: isDev });
    this.nextHandler = nextApp.getRequestHandler();
    await nextApp.prepare();
  }

  handler(req: Request, res: Response) {
    if (!this.nextHandler) {
      throw new Error('Next.js server is not initialized');
    }

    return this.nextHandler(req, res);
  }
}

export const nextServer = new NextServer();
