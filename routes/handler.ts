import { Request, Response } from 'express';
import { RouteHandler, ExpressHandler } from './types';

// TODO: Use cookies for authentication and automatically add session/user to context if accessing from browser

export function createRouteHandler(handler: RouteHandler): ExpressHandler {
  return async (req: Request, res: Response) => {
    try {
      const response = await handler({
        query: req.query as Record<string, string>,
        body: req.body,
        params: req.params,
        headers: req.headers as Record<string, string>,
        cookies: req.cookies,
        req,
      });

      res.status(response.status || 200);

      if (response.headers) {
        Object.entries(response.headers).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
      }

      res.send(response.data);
    } catch (error) {
      res.status(500).send(String(error));
    }
  };
}
