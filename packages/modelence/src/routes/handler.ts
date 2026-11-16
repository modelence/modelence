import { Request, Response, NextFunction } from 'express';
import { RouteHandler } from './types';
import { ModelenceError } from '../error';
import { authenticate } from '../auth';
import { getMongodbUri } from '../db/client';
import type { Context } from '../methods/types';
import { startTransaction, redactSensitive, captureError, logError } from '../telemetry';

// TODO: Use cookies for authentication and automatically add session/user to context if accessing from browser
export function createRouteHandler(method: string, path: string, handler: RouteHandler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authToken = req.headers['x-modelence-auth-token'];
    let context: Pick<Context, 'session' | 'user'> = { session: null, user: null };

    if (typeof authToken === 'string' && getMongodbUri()) {
      try {
        // Custom routes never return a session token, so do not save a new one.
        const { session, user } = await authenticate(authToken, { persistNewSession: false });
        context = { session, user };
      } catch {
        // If authentication fails, context remains null
      }
    }

    const transaction = startTransaction('route', `route:${method.toLowerCase()}:${path}`, {
      method,
      path,
      // Redact secrets (e.g. tokens in the URL) before they reach the APM sink.
      query: redactSensitive(req.query),
      body: redactSensitive(req.body),
      params: redactSensitive(req.params),
    });

    try {
      const response = await handler(
        {
          query: req.query as Record<string, string>,
          body: req.body,
          params: req.params as Record<string, string>,
          headers: req.headers as Record<string, string>,
          cookies: req.cookies,
          rawBody: Buffer.isBuffer(req.body) ? req.body : undefined,
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

        // Apply response headers before sending the body/redirect, otherwise
        // res.redirect()/res.send() flush the response and the headers are lost.
        if (response.contentType) {
          res.setHeader('Content-Type', response.contentType);
        }

        // Custom headers are applied after contentType so callers can override
        // it with headers['Content-Type'] when needed.
        if (response.headers) {
          Object.entries(response.headers).forEach(([key, value]) => {
            res.setHeader(key, value);
          });
        }

        if (response.redirect) {
          // res.redirect(url) always sends 302 and overwrites the res.status() above,
          // so pass the code explicitly to keep 301/303/307/308.
          const redirectStatus =
            response.status && response.status >= 300 && response.status < 400
              ? response.status
              : 302;
          res.redirect(redirectStatus, response.redirect);
        } else {
          res.send(response.data);
        }
      }
    } catch (error) {
      captureError(error instanceof Error ? error : new Error(String(error)));
      transaction.end('error');

      if (error instanceof ModelenceError) {
        res.status(error.status).send(error.message);
      } else {
        logError('Error in route handler:', { error, path: req.path });
        res.status(500).send(String(error));
      }
    }
  };
}
