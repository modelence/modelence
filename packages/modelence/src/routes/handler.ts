import { Request, Response, NextFunction } from 'express';
import { RouteHandler } from './types';
import { ModelenceError } from '../error';
import { authenticate } from '../auth';
import { getMongodbUri } from '../db/client';
import type { Context } from '../methods/types';
import { startTransaction } from '../telemetry';

// TODO: Use cookies for authentication and automatically add session/user to context if accessing from browser
export function createRouteHandler(method: string, path: string, handler: RouteHandler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authToken = req.headers['x-modelence-auth-token'];
    let context: Pick<Context, 'session' | 'user'> = { session: null, user: null };

    if (typeof authToken === 'string' && getMongodbUri()) {
      try {
        const { session, user } = await authenticate(authToken);
        context = { session, user };
      } catch {
        // If authentication fails, context remains null
      }
    }

    const transaction = startTransaction('route', `route:${method.toLowerCase()}:${path}`, {
      method,
      path,
      query: req.query,
      body: req.body,
      params: req.params,
    });

    try {
      const response = await handler(
        {
          query: req.query as Record<string, string>,
          body: req.body,
          params: req.params,
          headers: req.headers as Record<string, string>,
          cookies: req.cookies,
          req,
          res,
          next,
        },
        context
      );

      transaction.end();

      // If the handler returns null, we expect it to handle the response itself
      if (response) {
        res.status(response.status || 200);

        if (response.redirect) {
          res.redirect(response.redirect);
        }

        if (response.headers) {
          Object.entries(response.headers).forEach(([key, value]) => {
            res.setHeader(key, value);
          });
        }

        res.send(response.data);
      }
    } catch (error) {
      transaction.end('error');

      if (error instanceof ModelenceError) {
        res.status(error.status).send(error.message);
      } else {
        console.error(`Error in route handler: ${req.path}`);
        console.error(error);
        res.status(500).send(String(error));
      }
    }
  };
}
