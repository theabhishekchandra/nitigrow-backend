require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const authRoutes      = require('./routes/auth');
const contactRoutes   = require('./routes/contacts');
const webhookRoutes   = require('./routes/webhook');
const templateRoutes  = require('./routes/templates');
const campaignRoutes  = require('./routes/campaigns');
const messageRoutes   = require('./routes/messages');
const adminRoutes     = require('./routes/admin');
const settingsRoutes  = require('./routes/settings');
const teamRoutes      = require('./routes/team');
const analyticsRoutes = require('./routes/analytics');
const quickWinsRoutes = require('./routes/quickWins');
const aiRoutes          = require('./routes/ai');
const billingRoutes     = require('./routes/billing');
const chatbotFlowRoutes = require('./routes/chatbotFlows');
const quickReplyRoutes  = require('./routes/quickReplies');
const notificationRoutes = require('./routes/notifications');
const sdkRoutes          = require('./routes/sdk');
const leadRoutes         = require('./routes/leads');

const app    = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  process.env.ADMIN_URL    || 'http://localhost:5174',
];

// ─── Socket.io — JWT-verified multi-tenant rooms ───────────────────────────
const io = new Server(server, {
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

// ─── Raw body capture for webhook signature verification ───────────────────
// Must be before express.json() — only applies to /api/webhook
app.use('/api/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
  req.rawBody = req.body;
  req.body = JSON.parse(req.body.toString('utf8') || '{}');
  next();
});

// ─── MongoDB operator injection sanitizer ─────────────────────────────────
const sanitizeMongo = (obj) => {
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.includes('.')) delete obj[key];
      else sanitizeMongo(obj[key]);
    }
  }
};

// ─── Security middleware ───────────────────────────────────────────────────
app.use(helmet());
app.use((req, _res, next) => { sanitizeMongo(req.body); sanitizeMongo(req.params); next(); });
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// ─── Rate limiting ─────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== 'production';
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: isDev ? 2000 : 300, message: { error: 'Too many requests' } }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: isDev ? 200 : 20, message: { error: 'Too many login attempts' } }));
app.use('/api/campaigns', rateLimit({ windowMs: 60 * 1000, max: isDev ? 200 : 30, message: { error: 'Campaign rate limit exceeded' } }));

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/contacts',  contactRoutes);
app.use('/api/webhook',   webhookRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/messages',  messageRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/settings',  settingsRoutes);
app.use('/api/team',      teamRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/q',         quickWinsRoutes);
app.use('/api/ai',             aiRoutes);
app.use('/api/billing',        billingRoutes);
app.use('/api/chatbot-flows',  chatbotFlowRoutes);
app.use('/api/quick-replies',  quickReplyRoutes);
app.use('/api/notifications',  notificationRoutes);
app.use('/api/sdk',            sdkRoutes);
app.use('/api/leads',          leadRoutes);

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'NitiGrow API', timestamp: new Date() }));

// ─── 404 ───────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ─── Global error handler ──────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── BullMQ Workers ────────────────────────────────────────────────────────
// Workers are moved to src/worker.js for standalone scalability.

const { startCronJobs } = require('./jobs/cron');

// ─── Boot ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const start = async () => {
  await connectDB();
  await connectRedis();
  
  startCronJobs();
  
  if (process.env.RUN_WORKER === 'true') {
    const { startWorkers } = require('./worker');
    startWorkers();
  }
  
  server.listen(PORT, () => console.log(`NitiGrow API running on port ${PORT}`));
};

start();
