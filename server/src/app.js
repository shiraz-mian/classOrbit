import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { config } from './config/index.js';
import { authenticate, checkOrigin } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import { createRouter as authRouter } from './routes/auth.routes.js';
import { createRouter as catalogRouter } from './routes/catalog.routes.js';
import { createRouter as learningRouter } from './routes/learning.routes.js';
import { createRouter as certificatesRouter } from './routes/certificates.routes.js';
import { createRouter as studioRouter } from './routes/studio.routes.js';
import { createRouter as mediaRouter } from './routes/media.routes.js';
import { createRouter as liveRouter } from './routes/live.routes.js';
import { createRouter as revenueRouter } from './routes/revenue.routes.js';
import { createRouter as adminRouter } from './routes/admin.routes.js';
import { createRouter as webhookRouter } from './routes/webhook.routes.js';
import { createRouter as paymentRouter } from './routes/payment.routes.js';
import { createPaymentGateway } from './services/razorpay.gateway.js';
export async function createApp(db, { media = {}, payments = {} } = {}) {
  const gateway = createPaymentGateway(payments);
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: config.production
        ? {
            directives: {
              'script-src': ["'self'", 'https://checkout.razorpay.com'],
              'frame-src': ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
              'media-src': ["'self'", 'blob:', 'https:'],
              'connect-src': ["'self'", 'wss:', 'https:'],
            },
          }
        : false,
    }),
  );
  app.use(cors({ origin: config.appUrl, credentials: true }));
  app.use(webhookRouter(db, gateway));
  app.use(express.json({ limit: '1mb' }), cookieParser());
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use(checkOrigin, authenticate(db));
  app.get('/api/health', async (req, res) => {
    await db.all('course');
    res.json({ status: 'ok', mode: config.demo ? 'demo' : 'postgresql' });
  });
  app.use(paymentRouter(db, gateway));
  for (const createRouter of [
    authRouter,
    catalogRouter,
    learningRouter,
    certificatesRouter,
    studioRouter,
    mediaRouter,
    liveRouter,
    revenueRouter,
    adminRouter,
  ])
    app.use(
      createRouter === mediaRouter
        ? createRouter(db, media)
        : createRouter === catalogRouter
          ? createRouter(db, gateway)
          : createRouter(db),
    );
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
  const dist = path.join(config.root, 'client/dist');
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use(errorHandler);
  return app;
}
