const client = require('prom-client');

const register = new client.Registry();
register.setDefaultLabels({ service: 'nitigrow-api' });
client.collectDefaultMetrics({ register });

// ─── Custom metrics ────────────────────────────────────────────────────────
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests handled by the API',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// NOTE: tenantId label can blow up cardinality on large fleets. Acceptable
// at current scale; revisit (hash / bucket / drop label) once tenant count > ~1k.
const whatsappMessagesSentTotal = new client.Counter({
  name: 'whatsapp_messages_sent_total',
  help: 'WhatsApp messages dispatched to Meta Cloud API',
  labelNames: ['tenantId'],
  registers: [register],
});

const aiOperationsTotal = new client.Counter({
  name: 'ai_operations_total',
  help: 'Anthropic / AI operations invoked',
  labelNames: ['model'],
  registers: [register],
});

const bullJobCompletedTotal = new client.Counter({
  name: 'bull_job_completed_total',
  help: 'BullMQ jobs completed (terminal state)',
  labelNames: ['queue', 'status'],
  registers: [register],
});

// ─── Express middleware ────────────────────────────────────────────────────
const SKIP_PATHS = ['/metrics'];
const SKIP_PREFIXES = ['/health'];

const metricsMiddleware = () => (req, res, next) => {
  if (SKIP_PATHS.includes(req.path)) return next();
  if (SKIP_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();

  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    // Prefer matched route pattern to keep label cardinality bounded.
    const route =
      (req.route && req.route.path) ||
      (req.baseUrl && req.route ? req.baseUrl + req.route.path : req.baseUrl) ||
      'unmatched';
    const labels = { method: req.method, route };
    end(labels);
    httpRequestsTotal.inc({ ...labels, status: String(res.statusCode) });
  });
  next();
};

module.exports = {
  register,
  metricsMiddleware,
  httpRequestsTotal,
  httpRequestDuration,
  whatsappMessagesSentTotal,
  aiOperationsTotal,
  bullJobCompletedTotal,
};
