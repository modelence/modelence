import googleAuthRouter from '@/auth/providers/google';
import githubAuthRouter from '@/auth/providers/github';
import { runMethod } from '@/methods';
import { getResponseTypeMap, sanitizeResult } from '@/methods/serialize';
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
import { isSetupRequired } from './setupStatus';
import { ConnectionInfo } from '@/methods/types';
import { ServerChannel } from '@/websocket/serverChannel';
import { getSecurityConfig } from './securityConfig';
import { getWebsocketConfig } from './websocketConfig';
import { getConfig } from '@/config/server';
import { getLocalSiteUrl } from '@/config/local';
import { issueLinkNonce } from '@/auth/session';

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

function registerModuleRoutes(
  app: express.Application,
  modules: Module[],
  cors: express.RequestHandler
) {
  for (const module of modules) {
    for (const route of module.routes) {
      const { path, handlers, body } = route;
      const middlewares = getBodyParserMiddleware(body);

      Object.entries(handlers).forEach(([method, handler]) => {
        // CORS first: it only sets response headers and always calls next(), so
        // it must not sit behind a body parser that could reject the request
        // before the headers are attached.
        app[method as HttpMethod](
          path,
          cors,
          ...middlewares,
          createRouteHandler(method, path, handler)
        );
      });
    }
  }
}

let globalProcessListenersRegistered = false;

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

  // CSP and X-Frame-Options belong on every response, SSR pages included, so
  // this one stays global.
  app.use(securityHeadersMiddleware());
  // Preflights only. The matching response headers are attached per-route below,
  // which keeps SSR pages and static assets out of CORS scope.
  app.use(corsPreflightMiddleware());

  const cors = corsRouteMiddleware();

  // Register module routes first (with per-route body parser config)
  registerModuleRoutes(app, combinedModules, cors);

  // Apply global body parsing for remaining routes
  app.use(express.json({ limit: '16mb' }));
  app.use(express.urlencoded({ extended: true, limit: '16mb' }));

  // Both OAuth routers register only under this prefix, so one mount covers
  // every route they add, including the callbacks.
  app.use('/api/_internal/auth', cors);
  app.use(googleAuthRouter());
  app.use(githubAuthRouter());

  // Browser OAuth linking: set httpOnly cookie so the authToken never travels in a URL.
  app.post('/api/_internal/auth/set-link-cookie', cors, async (req: Request, res: Response) => {
    const { session } = await getCallContext(req, res);

    if (!session?.userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    res.cookie('oauthLinkToken', session.authToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/_internal/auth/',
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    res.json({ ok: true });
  });

  // React Native OAuth linking: issues a single-use nonce the app puts in the OAuth URL.
  app.post('/api/_internal/auth/issue-link-nonce', cors, async (req: Request, res: Response) => {
    const { session } = await getCallContext(req, res);

    if (!session?.userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const nonce = await issueLinkNonce(String(session.userId));
    res.json({ nonce });
  });

  app.post('/api/_internal/method/:methodName(*)', cors, async (req: Request, res: Response) => {
    const methodName = req.params.methodName as string;
    const context = await getCallContext(req, res);

    try {
      const result = sanitizeResult(await runMethod(methodName, req.body.args, context));
      res.json({
        data: result,
        typeMap: getResponseTypeMap(result),
      });
    } catch (error) {
      handleMethodError(res, methodName, error);
    }
  });

  const httpServer = http.createServer(app);

  // Keep-alive must exceed the idle timeout of any load balancer in front of the
  // app, or Node destroys pooled sockets the LB still considers live and requests
  // dispatched onto them fail with intermittent 502s. Node's stock default is 5s,
  // below every common LB idle timeout (AWS ALB defaults to 60s). This is the
  // post-response idle timeout only; it never applies to an in-flight request.
  const keepAliveTimeoutMs = Number(process.env.MODELENCE_KEEP_ALIVE_TIMEOUT_MS) || 65000;
  httpServer.keepAliveTimeout = keepAliveTimeoutMs;
  // Must exceed keepAliveTimeout, or requests whose headers are still in flight
  // when keep-alive expires are dropped (nodejs/node#27363).
  httpServer.headersTimeout = keepAliveTimeoutMs + 5000;

  await server.init({ httpServer });

  if (server.middlewares) {
    app.use(server.middlewares());
  }

  app.all('*', (req: Request, res: Response, next) => {
    Promise.resolve(server.handler(req, res)).catch(next);
  });

  if (!globalProcessListenersRegistered) {
    globalProcessListenersRegistered = true;
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
  }

  const websocketProvider = getWebsocketConfig()?.provider;
  if (websocketProvider) {
    void websocketProvider.init({
      httpServer,
      channels,
    });
  }

  const port = process.env.MODELENCE_PORT || process.env.PORT || 3000;
  httpServer.listen(port, () => {
    logInfo(`Application started`, { source: 'app' });
    const siteUrl = getConfig('_system.site.url') || getLocalSiteUrl();
    console.log(`\nApplication started on ${siteUrl}\n`);

    // The browser shows the setup screen in this state (see
    // client/SetupScreen); say the same thing here for anyone who only sees
    // the terminal — a developer glancing at logs, or a coding agent running
    // the dev server.
    if (isSetupRequired()) {
      console.log(
        'This project is not connected to a backend yet, so the app serves setup instructions instead of its UI.\n' +
          'To connect it to Modelence Cloud, run `npx modelence setup` and restart the dev server.\n'
      );
    }
  });
}

export async function getCallContext(req: Request, res: Response | null = null) {
  const path = (req.path ?? req.url ?? '').split('?')[0];

  const isOAuthCallback = path.startsWith('/api/_internal/auth/') && path.endsWith('/callback');

  const body = (req.body ?? {}) as Record<string, unknown>;

  const authToken = z
    .string()
    .nullish()
    .transform((val) => val ?? null)
    .parse(
      req.cookies.authToken ||
        (isOAuthCallback ? req.cookies.oauthLinkToken : null) ||
        body.authToken
    );

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
    .parse(body.clientInfo) ?? {
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
    baseUrl: getRequestBaseUrl(req),
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
      req,
      res,
    };
  }

  return {
    clientInfo,
    connectionInfo,
    session: null,
    user: null,
    roles: getUnauthenticatedRoles(),
    req,
    res,
  };
}

function handleMethodError(res: Response, methodName: string, error: unknown) {
  // TODO: add an option to silence these error console logs, especially when Elastic logs are configured

  if (error instanceof ModelenceError) {
    if (error.status >= 500 && error.status < 600) {
      console.error(`Error calling ${methodName}:`, error);
    }
    // Surface a machine-readable code (when present) via a header so clients can
    // branch on the error kind without parsing the human-readable message. The
    // response body is left as the message text to preserve the existing format.
    if (error.code) {
      res.setHeader('X-Modelence-Error-Code', error.code);
    }
    res.status(error.status).send(error.message);
    return;
  }

  if (error instanceof Error && error?.constructor?.name === 'ZodError' && 'errors' in error) {
    let errorMessage = '';
    try {
      errorMessage = parseZodError(error as z.ZodError);
    } catch (parsingError) {
      console.error(`Error parsing Zod error in ${methodName}:`, parsingError);
      errorMessage = 'Validation failed';
    }
    res.status(400).send(errorMessage);
    return;
  }

  console.error(`Error calling ${methodName}:`, error);
  res.status(500).send(error instanceof Error ? error.message : String(error));
}

function parseZodError(zodError: z.ZodError): string {
  const flattened = zodError.flatten();
  const fieldMessages = Object.entries(flattened.fieldErrors).map(
    ([key, errors]) => `${key}: ${(errors ?? []).join(', ')}`
  );
  const formMessages = flattened.formErrors;
  const allMessages = [...fieldMessages, ...formMessages].filter(Boolean);
  return allMessages.join('; ');
}

function securityHeadersMiddleware(): express.RequestHandler {
  const { frameAncestors } = getSecurityConfig();
  const hasCustomAncestors = frameAncestors && frameAncestors.length > 0;
  const ancestors = hasCustomAncestors ? ["'self'", ...frameAncestors].join(' ') : "'self'";

  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', `frame-ancestors ${ancestors}`);
    // X-Frame-Options only supports DENY and SAMEORIGIN (ALLOW-FROM is deprecated).
    // When custom ancestors are configured, only CSP frame-ancestors can express that,
    // so we omit X-Frame-Options to avoid conflicting with the CSP directive.
    if (!hasCustomAncestors) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    next();
  };
}

/**
 * Applies the CORS response headers for a single request, returning whether the
 * request's Origin is allowed.
 *
 * Shared by the preflight and per-route middlewares so an allowed origin gets
 * exactly the same headers whether the browser is preflighting or making the
 * real call — a mismatch between the two is invisible in tests and shows up as
 * an intermittent browser-only failure.
 */
function applyCorsHeaders(
  req: express.Request,
  res: express.Response,
  allowed: Set<string>
): boolean {
  // Set before the match check, not inside it: a response sent to a
  // disallowed origin (or to a request with no Origin at all) still depends on
  // Origin, and without Vary a CDN or shared proxy may cache that
  // header-less response and later replay it to an allowed origin.
  // res.vary appends and dedupes, so a Vary set by static/compression
  // middleware further down the stack survives — setHeader would clobber it.
  res.vary('Origin');

  const origin = req.headers.origin;
  const isAllowed = typeof origin === 'string' && allowed.has(origin);
  if (!isAllowed) {
    return false;
  }

  // Echo the matched origin rather than '*': a wildcard is rejected by
  // browsers on credentialed requests, which the cookie-based web flows use.
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  // Reflect what the preflight asked for, falling back to the only header
  // method calls send. A custom route taking e.g. Authorization would
  // otherwise be blocked before its handler ever ran.
  const requestedHeaders = req.headers['access-control-request-headers'];
  res.setHeader(
    'Access-Control-Allow-Headers',
    typeof requestedHeaders === 'string' ? requestedHeaders : 'Content-Type'
  );
  // Covers every verb RouteDefinition's HttpMethod allows, so a custom
  // route is not silently blocked by a preflight the framework rejects.
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  // Browsers expose only a small safelist of response headers to JS. Without
  // this the error-code header is hidden cross-origin, so MethodError.code
  // silently becomes undefined and clients cannot branch on the error kind.
  res.setHeader('Access-Control-Expose-Headers', 'X-Modelence-Error-Code');
  return true;
}

/**
 * Answers CORS preflights. Mounted globally, unlike the per-route header
 * middleware: a preflight must be answered before route dispatch, and Express
 * does not reliably match `OPTIONS /todos` against a `.get('/todos')`
 * registration. Scoping this per-route would leave those preflights to fall
 * through to the SSR catch-all, which answers them with HTML.
 *
 * It only ever handles OPTIONS, so it never adds headers to a real response —
 * that stays the per-route middleware's job, which is what keeps SSR and static
 * responses out of scope.
 */
function corsPreflightMiddleware(): express.RequestHandler {
  const { allowedOrigins } = getSecurityConfig();
  const allowed = new Set(allowedOrigins ?? []);

  return (req, res, next) => {
    // Opt-in only. With no configured origins this is a no-op, so deployments
    // that add CORS at a proxy/router keep exactly one Access-Control-Allow-Origin
    // header — a duplicate is invalid and browsers reject the response outright.
    if (allowed.size === 0 || req.method !== 'OPTIONS') {
      next();
      return;
    }

    const isAllowed = applyCorsHeaders(req, res, allowed);
    // Allow-Headers is reflected from the request, so the preflight result
    // depends on this header too and must not be cached across requests that
    // ask for different ones.
    res.vary('Access-Control-Request-Headers');
    if (isAllowed) {
      // Every method call sends Content-Type: application/json, so every one
      // is preflighted. Without Max-Age browsers re-preflight constantly
      // (Chrome defaults to 5s), doubling the request count. 600s is under
      // Chrome's 7200s cap and Firefox's 86400s cap, so it applies as given.
      res.setHeader('Access-Control-Max-Age', '600');
    }
    res.sendStatus(isAllowed ? 204 : 403);
  };
}

/**
 * Adds CORS headers to a real (non-preflight) response.
 *
 * Attached to the app's route surface — module routes and the framework's own
 * API routes — rather than mounted globally, so an allowlisted origin can call
 * the API without also being able to read SSR pages and static assets with
 * credentials. The scope is derived from the routes actually registered rather
 * than matched by path pattern: module routes carry no framework-imposed prefix
 * (the docs' example mounts `/todos` at the root), so no pattern could express
 * "the API" without silently missing user-defined routes.
 */
function corsRouteMiddleware(): express.RequestHandler {
  const { allowedOrigins } = getSecurityConfig();
  const allowed = new Set(allowedOrigins ?? []);

  return (req, res, next) => {
    if (allowed.size > 0) {
      applyCorsHeaders(req, res, allowed);
    }
    next();
  };
}

function getRequestBaseUrl(req: Request): string {
  // Behind a reverse proxy the inbound Host header / connection protocol can
  // reflect the internal container address rather than the public URL. Honor
  // the X-Forwarded-Host / X-Forwarded-Proto headers when present (the first
  // value in each comma-separated list is the original client-facing value),
  // falling back to the direct request values otherwise.
  const forwardedHost = req.headers['x-forwarded-host'];
  const host =
    (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost?.split(',')[0])?.trim() ||
    req.get('host');

  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto?.split(',')[0])?.trim() ||
    req.protocol;

  return `${protocol}://${host}`;
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
