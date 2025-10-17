import { Request, Response, NextFunction } from 'express';
import { RouteHandler, ExpressHandler } from './types';
import { ModelenceError } from '../error';

// TODO: Use cookies for authentication and automatically add session/user to context if accessing from browser

export function createRouteHandler(handler: RouteHandler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await handler({
        query: req.query as Record<string, string>,
        body: req.body,
        params: req.params,
        headers: req.headers as Record<string, string>,
        cookies: req.cookies,
        req,
        res,
        next,
      });

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
