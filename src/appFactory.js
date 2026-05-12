const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

// Observability middleware — registered before security/CORS so every request,
// including those rejected later, gets a request id, structured log, and metric.
const requestId = require('./middleware/requestId');
const httpLogger = require('./middleware/logging');
const { metricsMiddleware } = require('./lib/metrics');

const healthRoutes = require('./routes/health');
const metricsRoutes = require('./routes/metrics');
const bullBoardRouter = require('./lib/bullBoard');

const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contacts');
const webhookRoutes = require('./routes/webhook');
const templateRoutes = require('./routes/templates');
const campaignRoutes = require('./routes/campaigns');
const messageRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');
const settingsRoutes = require('./routes/settings');
const teamRoutes = require('./routes/team');
const analyticsRoutes = require('./routes/analytics');
const quickWinsRoutes = require('./routes/quickWins');
const aiRoutes = require('./routes/ai');
const billingRoutes = require('./routes/billing');
const chatbotFlowRoutes = require('./routes/chatbotFlows');
const quickReplyRoutes = require('./routes/quickReplies');
const notificationRoutes = require('./routes/notifications');
const sdkRoutes = require('./routes/sdk');
const leadRoutes = require('./routes/leads');
const onboardingRoutes = require('./routes/onboarding');
const marketingContactRoutes = require('./routes/contact');

// Builds the Express app + http server + socket.io. No side-effects — does not
// connect to Mongo/Redis or bind a port. Callers (production index.js, tests)
// own those concerns.
const createApp = ({ enableMorgan = true, enableSocketIo = true } = {}) => {
  const app = express();
  const server = http.createServer(app);

  const ALLOWED_ORIGINS = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    process.env.ADMIN_URL || 'http://localhost:5174',
    process.env.LANDING_URL || 'http://localhost:5180',
    'https://nitigrow.in',
    'https://www.nitigrow.in',
  ];

  let io = null;
  if (enableSocketIo) {
    io = new Server(server, {
      cors: { origin: ALLOWED_ORIGINS, credentials: true },
    });
    global.io = io;

    io.on('connection', (socket) => {
      socket.on('join_tenant', (token) => {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const tenantId = decoded.tenantId || decoded.id;
          if (tenantId) socket.join(`tenant-${tenantId}`);
        } catch {
          socket.disconnect();
        }
      });
    });
  }

  // Raw body capture for webhook signature verification — must precede express.json().
  // Only applies to POST/PUT/PATCH; GET requests (Meta verification handshake) have no body.
  app.use('/api/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
    if (Buffer.isBuffer(req.body) && req.body.length) {
      req.rawBody = req.body;
      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch {
        req.body = {};
      }
    } else {
      req.rawBody = Buffer.alloc(0);
      req.body = {};
    }
    next();
  });

  const sanitizeMongo = (obj) => {
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (key.startsWith('$') || key.includes('.')) delete obj[key];
        else sanitizeMongo(obj[key]);
      }
    }
  };

  // Observability MUST run before anything else so every request — including
  // those rejected by helmet/cors/rate-limit — gets a request id + log + metric.
  app.use(requestId);
  app.use(httpLogger);
  app.use(metricsMiddleware());

  app.use(helmet());
  app.use((req, _res, next) => {
    sanitizeMongo(req.body);
    sanitizeMongo(req.params);
    next();
  });
  app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  // Morgan is now superseded by pino-http; keep behind flag for dev-only verbose output.
  if (enableMorgan && process.env.MORGAN === '1') app.use(morgan('dev'));

  const isDev = process.env.NODE_ENV !== 'production';
  const isTest = process.env.NODE_ENV === 'test';
  if (!isTest) {
    app.use(
      '/api/',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: isDev ? 2000 : 300,
        message: { error: 'Too many requests' },
      }),
    );
    app.use(
      '/api/auth',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: isDev ? 200 : 20,
        message: { error: 'Too many login attempts' },
      }),
    );
    app.use(
      '/api/campaigns',
      rateLimit({
        windowMs: 60 * 1000,
        max: isDev ? 200 : 30,
        message: { error: 'Campaign rate limit exceeded' },
      }),
    );
  }

  app.use('/api/auth', authRoutes);
  app.use('/api/contacts', contactRoutes);
  app.use('/api/webhook', webhookRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/team', teamRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/q', quickWinsRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/chatbot-flows', chatbotFlowRoutes);
  app.use('/api/quick-replies', quickReplyRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/sdk', sdkRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/onboarding', onboardingRoutes);
  app.use('/api/contact', marketingContactRoutes); // public marketing form

  // Health (live/ready), Prometheus metrics, BullMQ dashboard (admin-JWT gated).
  app.use('/health', healthRoutes);
  app.use('/metrics', metricsRoutes);
  app.use('/admin-internal/queues', bullBoardRouter);

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

  app.use((err, req, res, _next) => {
    if (process.env.NODE_ENV !== 'test') console.error(err.stack);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  return { app, server, io };
};

module.exports = { createApp };
