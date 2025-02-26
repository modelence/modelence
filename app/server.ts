import http from 'http';
import express, { Request, Response } from 'express';
import z from 'zod';
import { runMethod } from '../methods';
import { getResponseTypeMap } from '../methods/serialize';
import { authenticate } from '../auth';
import { logInfo } from './logs';
import { Module } from './module';
import { HttpMethod } from '../routes/types';
import { createRouteHandler } from '../routes/handler';
import { getUnauthenticatedRoles } from '../auth/role';
import { getMongodbUri } from 'db/client';
import { AppServer } from '../packages/types';

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

      // res.status(500).json({ error: 'Internal server error' });

      if (error instanceof Error && error?.constructor?.name === 'ZodError' && 'errors' in error) {
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
    console.log(`Application started on port ${port}`);
  });
}

async function getCallContext(req: Request) {
  const authToken = z.string().nullish().transform(val => val ?? null).parse(req.body.authToken);

  const clientInfo = z.object({
    screenWidth: z.number(),
    screenHeight: z.number(),
    windowWidth: z.number(),
    windowHeight: z.number(),
    pixelRatio: z.number(),
    orientation: z.string().nullable(),
  }).parse(req.body.clientInfo);

  const connectionInfo = {
    ip: req.ip || req.socket.remoteAddress, // TODO: handle cases with Proxy
    userAgent: req.get('user-agent'),
    acceptLanguage: req.get('accept-language'),
    referrer: req.get('referrer'),
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

// import passport from 'passport';
// import session from 'express-session';
// import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

// Session middleware
// app.use(session({
//   secret: process.env.SESSION_SECRET || 'default_secret',
//   resave: false,
//   saveUninitialized: false
// }));

// Passport middleware
// app.use(passport.initialize());
// app.use(passport.session());

// // Passport Google strategy setup
// passport.use(new GoogleStrategy({
//   clientID: process.env.GOOGLE_CLIENT_ID || '',
//   clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
//   callbackURL: "/auth/google/callback"
// },
// function(accessToken: string, refreshToken: string, profile: any, cb: (error: any, user?: any) => void) {
//   // Here you would typically find or create a user in your database
//   // For now, we'll just pass the profile info
//   return cb(null, profile);
// }));

// passport.serializeUser((user: Express.User, done: (err: any, id?: unknown) => void) => {
//   done(null, user);
// });

// passport.deserializeUser((user: Express.User, done: (err: any, user?: Express.User | false | null) => void) => {
//   done(null, user);
// });

// // Google Auth routes
// app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }),
//   function(req: Request, res: Response) {
//     // Successful authentication, redirect home.
//     res.redirect('/');
//   }
// );

// // Logout route
// app.get('/logout', (req: Request, res: Response, next: NextFunction) => {
//   req.logout(function(err) {
//     if (err) { return next(err); }
//     res.redirect('/');
//   });
// });

// // Middleware to check if user is authenticated
// function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
//   if (req.isAuthenticated()) {
//     return next();
//   }
//   res.redirect('/login');
// }


// app.get('/bundle.js', function (req: Request, res: Response) {
//   res.sendFile('.modelence/client/bundle.js', { root: '.' });
// });


// // Update your catch-all route
// app.get('/', function (req: Request, res: Response) {
//   res.sendFile(path.join('client', 'index.html'), { root: path.join(__dirname, '..') });
// });


