import googleAuthRouter from '@/auth/providers/google';
import { runMethod } from '@/methods';
import { getResponseTypeMap } from '@/methods/serialize';
import { createRouteHandler } from '@/routes/handler';
import { HttpMethod } from '@/server';
import { logInfo } from '@/telemetry';
import cookieParser from 'cookie-parser';
import express, { Request, Response } from 'express';
import http from 'http';
import passport from 'passport';
import z from 'zod';
import { AppServer } from '../../../types';
import { authenticate } from '../auth';
import { getUnauthenticatedRoles } from '../auth/role';
import { getMongodbUri } from '../db/client';
import { ModelenceError } from '../error';
import { Module } from './module';
import { ConnectionInfo } from '@/methods/types';

function registerModuleRoutes(app: express.Application, modules: Module[]) {
  for (const module of modules) {
    for (const route of module.routes) {
      const { path, handlers } = route;

      Object.entries(handlers).forEach(([method, handler]) => {
        app[method as HttpMethod](path, createRouteHandler(handler));
      });
    }
  }
}

export async function startServer(server: AppServer, { combinedModules }: { combinedModules: Module[] }) {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use(passport.initialize());

  app.use(googleAuthRouter());

  app.post('/api/_internal/method/:methodName(*)', async (req: Request, res: Response) => {
    const { methodName } = req.params;
    const context = await getCallContext(req);

    try {
      const result = await runMethod(methodName, req.body.args, context);
      res.json({
        data: result,
        typeMap: getResponseTypeMap(result),
      });
    } catch (error) {
      // TODO: introduce error codes and handle them differently
      // TODO: support multiple errors

      // TODO: add an option to silence these error console logs, especially when Elastic logs are configured
      console.error(`Error in method ${methodName}:`, error);

      if (error instanceof ModelenceError) {
        res.status(error.status).send(error.message);
      } else if (error instanceof Error && error?.constructor?.name === 'ZodError' && 'errors' in error) {
        const zodError = error as z.ZodError;
        const flattened = zodError.flatten();
        const fieldMessages = Object.entries(flattened.fieldErrors)
          .map(([key, errors]) => `${key}: ${(errors ?? []).join(', ')}`)
          .join('; ');
        const formMessages = flattened.formErrors.join('; ');
        const allMessages = [fieldMessages, formMessages].filter(Boolean).join('; ');
        res.status(400).send(allMessages);
      } else {
        res.status(500).send(error instanceof Error ? error.message : String(error));
      }
    }
  });

  registerModuleRoutes(app, combinedModules);

  await server.init();

  if (server.middlewares) {
    app.use(server.middlewares());
  }

  app.all('*', (req: Request, res: Response) => {
    return server.handler(req, res);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:');
    console.error(reason instanceof Error ? reason.stack : reason);
    console.error('Promise:', promise);
  });
  
  // Global uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:');
    console.error(error.stack);  // This gives you the full stack trace
    console.trace('Full application stack:');  // Additional context
  });

  const httpServer = http.createServer(app);
  const port = process.env.PORT || 3000;
  httpServer.listen(port, () => {
    logInfo(`Application started`, { source: 'app' });
    console.log(`\nApplication started on http://localhost:${port}\n`);
  });
}

export async function getCallContext(req: Request) {
  const authToken = z.string().nullish().transform(val => val ?? null).parse(req.cookies.authToken || req.body.authToken);

  const clientInfo = z.object({
    screenWidth: z.number(),
    screenHeight: z.number(),
    windowWidth: z.number(),
    windowHeight: z.number(),
    pixelRatio: z.number(),
    orientation: z.string().nullable(),
  }).parse(req.body.clientInfo);

  const connectionInfo: ConnectionInfo = {
    ip: getClientIp(req),
    userAgent: req.get('user-agent'),
    acceptLanguage: req.get('accept-language'),
    referrer: req.get('referrer'),
    baseUrl: req.protocol + '://' + req.get('host'),
  };

  const hasDatabase = Boolean(getMongodbUri());
  if (hasDatabase) {
    const { session, user, roles } = await authenticate(authToken);
    return {
      clientInfo,
      connectionInfo,
      session,
      user,
      roles,
    };
  }

  return {
    clientInfo,
    connectionInfo,
    session: null,
    user: null,
    roles: getUnauthenticatedRoles(),
  };
}

function getClientIp(req: Request): string | undefined {
  // On Heroku and other proxies, X-Forwarded-For contains the real client IP
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const firstIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
    return firstIp.trim();
  }

  const directIp = req.ip || req.socket?.remoteAddress;
  if (directIp) {
    // Remove IPv6-to-IPv4 mapping prefix
    return directIp.startsWith('::ffff:') ? directIp.substring(7) : directIp;
  }
  
  return undefined;
}
