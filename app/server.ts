import http from 'http';
import express, { Request, Response } from 'express';
// import next from 'next';
import z from 'zod';
import { runMethod } from '../methods';
import { authenticate } from '../auth';
import { logInfo } from './logs';
import { initViteServer } from '../viteServer';

const useNextJs = false;

export async function startServer() {
  const app = express();
  const isDev = process.env.NODE_ENV !== 'production';

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.post('/api/_internal/method/:methodName', async (req: Request, res: Response) => {
    const { methodName } = req.params;
    const context = await getCallContext(req);

    try {
      const result = await runMethod(methodName, req.body.args, context);
      res.json(result);
    } catch (error) {
      // TODO: introduce error codes and handle them differently
      // TODO: support multiple errors
      // console.error(`Error in method ${methodName}:`, error);
      // res.status(500).json({ error: 'Internal server error' });

      if (error instanceof z.ZodError) {
        res.status(400).send(error.errors.map(e => e.message).join('; '));
      } else {
        res.status(500).send(String(error));
      }
    }
  });

  if (useNextJs) {
    await initNextjsServer(app, isDev);
  } else {
    await initViteServer(app, isDev);
  }

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

  const server = http.createServer(app);
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    logInfo(`Application started`, { source: 'app' });
    console.log(`Application started on port ${port}`);
  });
}

async function initNextjsServer(app: express.Application, isDev: boolean) {
  // const nextApp = next({ dev: isDev });
  // const nextHandler = nextApp.getRequestHandler();
  // await nextApp.prepare();
  
  // app.all('*', (req: Request, res: Response) => {
  //   return nextHandler(req, res);
  // });
}

async function getCallContext(req: Request) {
  const authToken = z.string().nullable().parse(req.body.authToken);

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

  const { session, user } = await authenticate(authToken);

  return { clientInfo, connectionInfo, session, user };
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


