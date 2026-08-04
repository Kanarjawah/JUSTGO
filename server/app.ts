import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { doubleCsrf } from 'csrf-csrf';
import { loadUser } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import driverRoutes from './routes/driver.js';
import merchantRoutes from './routes/merchant.js';
import customerRoutes from './routes/customer.js';

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: clientOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser(process.env.CSRF_SECRET || 'csrf-dev-secret'));
  app.use(
    session({
      name: 'justgo.sid',
      secret: process.env.SESSION_SECRET || 'dev-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  const { generateToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => process.env.CSRF_SECRET || 'csrf-dev-secret',
    getSessionIdentifier: (req) => req.sessionID || 'anon',
    cookieName: 'justgo.x-csrf',
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
    },
    getTokenFromRequest: (req) =>
      (req.headers['x-csrf-token'] as string) || (req.body && req.body._csrf),
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'JUSTGO API' });
  });

  app.get('/api/csrf', (req, res) => {
    const token = generateToken(req, res);
    res.json({ csrfToken: token });
  });

  app.use(loadUser);

  // CSRF on mutating API routes (skip in test for deterministic unit tests when header absent)
  app.use('/api', (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    return doubleCsrfProtection(req, res, next);
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/driver', driverRoutes);
  app.use('/api/merchant', merchantRoutes);
  app.use('/api/customer', customerRoutes);

  app.use(
    (
      err: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = err.status || 500;
      res.status(status).json({ error: err.message || 'Server error' });
    },
  );

  return app;
}
