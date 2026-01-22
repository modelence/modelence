import googleAuthRouter from '@/auth/providers/google';
import githubAuthRouter from '@/auth/providers/github';
import { runMethod } from '@/methods';
import { getResponseTypeMap } from '@/methods/serialize';
import { createRouteHandler } from '@/routes/handler';
import { HttpMethod } from '@/server';
import { logInfo } from '@/telemetry';
import cookieParser from 'cookie-parser';
import express, { Request, Response } from 'express';
import http from 'http';
import z from 'zod';
import type { AppServer } from '../types';
import { authenticate } from '../auth';
import { getUnauthenticatedRoles } from '../auth/role';
import { getMongodbUri } from '../db/client';
import { ModelenceError } from '../error';
import { Module } from './module';
import { ConnectionInfo } from '@/methods/types';
import { ServerChannel } from '@/websocket/serverChannel';
import { getWebsocketConfig } from './websocketConfig';

function getBodyParserMiddleware(config?: {
  json?: boolean | { limit?: string };
  urlencoded?: boolean | { limit?: string; extended?: boolean };
  raw?: boolean | { limit?: string; type?: string | string[] };
}) {
  const middlewares: express.RequestHandler[] = [];

  if (!config) {
    // Default: apply JSON and urlencoded parsing
    middlewares.push(express.json({ limit: '16mb' }));
    middlewares.push(express.urlencoded({ extended: true, limit: '16mb' }));
    return middlewares;
  }

  // Handle JSON parsing
  if (config.json !== false) {
    const jsonOptions = typeof config.json === 'object' ? config.json : { limit: '16mb' };
    middlewares.push(express.json(jsonOptions));
  }

  // Handle URL-encoded parsing
  if (config.urlencoded !== false) {
    const urlencodedOptions =
      typeof config.urlencoded === 'object' ? config.urlencoded : { extended: true, limit: '16mb' };
    middlewares.push(express.urlencoded(urlencodedOptions));
  }

  // Handle raw body parsing
  if (config.raw) {
    const rawOptions = typeof config.raw === 'object' ? config.raw : {};
    const defaultRawOptions = {
      limit: rawOptions.limit || '16mb',
      type: rawOptions.type || '*/*',
    };
    middlewares.push(express.raw(defaultRawOptions));
  }

  return middlewares;
}

function registerModuleRoutes(app: express.Application, modules: Module[]) {
  for (const module of modules) {
    for (const route of module.routes) {
      const { path, handlers, body } = route;
      const middlewares = getBodyParserMiddleware(body);

      Object.entries(handlers).forEach(([method, handler]) => {
        app[method as HttpMethod](path, ...middlewares, createRouteHandler(method, path, handler));
      });
    }
  }
}

export async function startServer(
  server: AppServer,
  {
    combinedModules,
    channels,
  }: {
    combinedModules: Module[];
    channels: ServerChannel[];
  }
) {
  const app = express();

  app.use(cookieParser());

  // Register module routes first (with per-route body parser config)
  registerModuleRoutes(app, combinedModules);

  // Apply global body parsing for remaining routes
  app.use(express.json({ limit: '16mb' }));
  app.use(express.urlencoded({ extended: true, limit: '16mb' }));

  app.use(googleAuthRouter());
  app.use(githubAuthRouter());

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
      handleMethodError(res, methodName, error);
    }
  });

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
    console.error(error.stack); // This gives you the full stack trace
    console.trace('Full application stack:'); // Additional context
  });

  const httpServer = http.createServer(app);

  const websocketProvider = getWebsocketConfig()?.provider;
  if (websocketProvider) {
    websocketProvider.init({
      httpServer,
      channels,
    });
  }

  const port = process.env.MODELENCE_PORT || process.env.PORT || 3000;
  httpServer.listen(port, () => {
    logInfo(`Application started`, { source: 'app' });
    const siteUrl = process.env.MODELENCE_SITE_URL || `http://localhost:${port}`;
    console.log(`\nApplication started on ${siteUrl}\n`);
  });
}

export async function getCallContext(req: Request) {
  const authToken = z
    .string()
    .nullish()
    .transform((val) => val ?? null)
    .parse(req.cookies.authToken || req.body.authToken);

  const clientInfo = z
    .object({
      screenWidth: z.number(),
      screenHeight: z.number(),
      windowWidth: z.number(),
      windowHeight: z.number(),
      pixelRatio: z.number(),
      orientation: z.string().nullable(),
    })
    .nullish()
    .parse(req.body.clientInfo) ?? {
    screenWidth: 0,
    screenHeight: 0,
    windowWidth: 0,
    windowHeight: 0,
    pixelRatio: 1,
    orientation: null,
  };

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

function handleMethodError(res: Response, methodName: string, error: unknown) {
  // TODO: introduce error codes and handle them differently
  // TODO: add an option to silence these error console logs, especially when Elastic logs are configured

  // Safely log the error to avoid serialization issues with complex error objects
  try {
    if (error instanceof Error && error?.constructor?.name === 'ZodError' && 'errors' in error) {
      const zodError = error as z.ZodError;
      const flattened = zodError.flatten();
      const fieldMessages = Object.entries(flattened.fieldErrors)
        .map(([key, errors]) => `${key}: ${(errors ?? []).join(', ')}`)
        .join('; ');
      const formMessages = flattened.formErrors.join('; ');
      const allMessages = [fieldMessages, formMessages].filter(Boolean).join('; ');
      console.error(`Error in method ${methodName}: ZodError - ${allMessages}`);
    } else if (error instanceof Error) {
      console.error(`Error in method ${methodName}:`, error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error(`Error in method ${methodName}:`, String(error));
    }
  } catch {
    // Fallback if error logging itself fails (prevents infinite error loops)
    console.error(`Error in method ${methodName}: [Failed to log error details]`);
  }

  if (error instanceof ModelenceError) {
    res.status(error.status).send(error.message);
  } else if (
    error instanceof Error &&
    error?.constructor?.name === 'ZodError' &&
    'errors' in error
  ) {
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
