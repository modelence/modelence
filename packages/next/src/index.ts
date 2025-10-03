import next from 'next';
import type { AppServer } from 'modelence/types';
import { Request, Response } from 'express';

/**
 * Next.js server implementation for Modelence applications.
 * 
 * This class wraps Next.js to provide a compatible server interface
 * for the Modelence framework.
 */
export class NextServer implements AppServer {
  private nextHandler?: (req: Request, res: Response) => void;

  /**
   * Initialize the Next.js application and prepare the request handler.
   */
  async init() {
    const isDev = process.env.NODE_ENV !== 'production';
    const nextApp = next({ dev: isDev });
    this.nextHandler = nextApp.getRequestHandler();
    await nextApp.prepare();
  }

  /**
   * Handle incoming HTTP requests using Next.js.
   * 
   * @param req - Express request object
   * @param res - Express response object
   */
  handler(req: Request, res: Response) {
    if (!this.nextHandler) {
      throw new Error('Next.js server is not initialized');
    }

    return this.nextHandler(req, res);
  }
}

/**
 * Pre-configured Next.js server instance for Modelence applications.
 * 
 * Use this instance in your Modelence server configuration:
 * 
 * @example
 * ```typescript
 * import { startApp } from 'modelence/server';
 * import { nextServer } from '@modelence/next';
 * 
 * startApp({
 *   server: nextServer
 * });
 * ```
 */
export const nextServer = new NextServer();
