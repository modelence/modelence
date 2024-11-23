import http from 'http';
import next from 'next';
import express, { Request, Response } from 'express';
import z from 'zod';
import { runMethod } from '../methods';
import { logInfo } from './logs';

export async function startServer() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // app.use('/img', express.static('public/img'));

  const isDev = process.env.NODE_ENV !== 'production';
  const nextApp = next({ dev: isDev });
  const handler = nextApp.getRequestHandler();

  try {
    await nextApp.prepare();

    app.post('/api/_internal/method/:methodName', async (req: Request, res: Response) => {
      const { methodName } = req.params;
      const context = getCallContext(req);

      try {
        const result = await runMethod(methodName, req.body.args, context);
        res.json(result);
      } catch (error) {
        console.error(`Error in method ${methodName}:`, error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Handle all other requests with Next.js
    app.all('*', (req: Request, res: Response) => {
      return handler(req, res);
    });

    console.log('Next.js app prepared successfully');
  } catch (error) {
    console.error('Error preparing Next.js app:', error);
    process.exit(1);
  }

  const server = http.createServer(app);
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    logInfo(`Application started`, { source: 'app' });
    console.log(`Application started on port ${port}`);
  });
}

function getCallContext(req: Request) {
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

  // TODO: fetch user from authToken
  const user = null;

  return { authToken, clientInfo, connectionInfo, user };
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
//   res.sendFile('dist/client/bundle.js', { root: '.' });
// });


// // Update your catch-all route
// app.get('/', function (req: Request, res: Response) {
//   res.sendFile(path.join('client', 'index.html'), { root: path.join(__dirname, '..') });
// });

