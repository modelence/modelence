import googleAuthRouter from '@/auth/providers/google';
import githubAuthRouter from '@/auth/providers/github';
import { runMethod } from '@/methods';
import { getResponseTypeMap, sanitizeResult } from '@/methods/serialize';
import { createRouteHandler } from '@/routes/handler';
import { HttpMethod } from '@/server';
import { logInfo, reportError } from '@/telemetry';
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

  // Express's proxy-addr implementation walks X-Forwarded-For from the socket
  // toward the client and stops at the first untrusted hop.
  // This is important for IP rate limits: selecting the left-most value would
  // let a caller evade them by prepending an arbitrary address.
  const { trustedProxies } = getSecurityConfig();
  const envTrustedProxies = parseTrustedProxies(process.env.MODELENCE_TRUSTED_PROXIES);
  // Keep the historical trust-all behavior when neither setting is present so
  // upgrading does not collapse every client behind a reverse proxy into one
  // rate-limit identity. Modelence-hosted environments set the trusted proxy
  // ranges before rolling out this framework version.
  const trustProxy = envTrustedProxies ?? trustedProxies;
  app.set('trust proxy', trustProxy === undefined ? true : trustProxy);

  app.use(cookieParser());

  app.use(securityHeadersMiddleware());

  // Register module routes first (with per-route body parser config)
  registerModuleRoutes(app, combinedModules);

  // Apply global body parsing for remaining routes
  app.use(express.json({ limit: '16mb' }));
  app.use(express.urlencoded({ extended: true, limit: '16mb' }));

  app.use(googleAuthRouter());
  app.use(githubAuthRouter());

  // Browser OAuth linking: set httpOnly cookie so the authToken never travels in a URL.
  app.post('/api/_internal/auth/set-link-cookie', async (req: Request, res: Response) => {
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
  app.post('/api/_internal/auth/issue-link-nonce', async (req: Request, res: Response) => {
    const { session } = await getCallContext(req, res);

    if (!session?.userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const nonce = await issueLinkNonce(String(session.userId));
    res.json({ nonce });
  });

  app.post('/api/_internal/method/:methodName(*)', async (req: Request, res: Response) => {
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
  if (error instanceof ModelenceError) {
    if (error.status >= 500 && error.status < 600) {
      reportError(error, `Error calling ${methodName}`);
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
      reportError(parsingError, `Error parsing Zod error in ${methodName}`);
      errorMessage = 'Validation failed';
    }
    res.status(400).send(errorMessage);
    return;
  }

  reportError(error, `Error calling ${methodName}`);
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

  // Do not parse X-Forwarded-Proto directly: `req.protocol` already resolves it
  // through the `trust proxy` setting, so an untrusted caller cannot influence
  // the base URL used for auth callbacks and emails.
  return `${req.protocol}://${host}`;
}

/**
 * Parses the comma-separated `MODELENCE_TRUSTED_PROXIES` value into the array
 * form Express expects. Returns undefined when unset or empty so the caller can
 * fall back to the `startApp()` security config.
 */
function parseTrustedProxies(value: string | undefined): string[] | undefined {
  const entries = value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries?.length ? entries : undefined;
}

/**
 * Whether the immediate peer on the socket is one of the configured trusted
 * proxies. Only the socket address is consulted: it is the one value in the
 * request a caller cannot forge.
 */
function isPeerTrusted(req: Request): boolean {
  const peerIp = req.socket?.remoteAddress;
  if (!peerIp) {
    return false;
  }

  // Express compiles the `trust proxy` setting into this predicate. It is
  // absent when the app was never configured (older embeddings, tests), in
  // which case we fall back to the `trust proxy` value itself.
  const trust = req.app?.get?.('trust proxy fn');
  if (typeof trust !== 'function') {
    return req.app?.get?.('trust proxy') !== false;
  }

  return Boolean(trust(peerIp, 0));
}

function getClientIp(req: Request): string | undefined {
  // Cloudflare and similar proxies expose the originating client in a
  // single-value header. Prefer it over the X-Forwarded-For chain, which
  // Cloudflare appends to rather than overwrites, but only when the peer is a
  // trusted proxy - otherwise a direct caller could set it themselves.
  const { clientIpHeader } = getSecurityConfig();
  if (clientIpHeader && isPeerTrusted(req)) {
    const forwardedIp = req.headers[clientIpHeader.toLowerCase()];
    const clientIp = (Array.isArray(forwardedIp) ? forwardedIp[0] : forwardedIp)?.trim();
    if (clientIp) {
      return normalizeIp(clientIp);
    }
  }

  // `req.ip` only incorporates X-Forwarded-For according to the application's
  // `trust proxy` setting. Never parse the header directly: its left-most value
  // is controlled by the caller unless every ingress proxy overwrites it.
  const directIp = req.ip || req.socket?.remoteAddress;
  if (directIp) {
    return normalizeIp(directIp);
  }

  return undefined;
}

function normalizeIp(ip: string): string {
  // Remove IPv6-to-IPv4 mapping prefix
  return ip.startsWith('::ffff:') ? ip.substring(7) : ip;
}
