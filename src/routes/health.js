const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { getRedisClient } = require('../config/redis');
const logger = require('../lib/logger');

// Lazy / defensive load — avoid bringing the whole whatsapp service into the
// require graph at startup if it has its own side effects.
let metaCircuitBreaker = null;
try {
  ({ metaCircuitBreaker } = require('../services/whatsapp'));
} catch (err) {
  logger.warn({ err }, 'health: could not load metaCircuitBreaker');
}

/**
 * GET /health  — backwards-compatible shape used by frontend PlatformStatus pill.
 * Always 200, lightweight.
 */
router.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'NitiGrow API', timestamp: new Date() });
});

/**
 * GET /health/live  — process is up. Used by orchestrator liveness probes.
 */
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'live', ts: new Date().toISOString() });
});

/**
 * GET /health/ready  — dependencies healthy enough to serve traffic.
 */
router.get('/ready', async (req, res) => {
  const checks = {};
  let ok = true;

  // Mongo
  const mongoState = mongoose.connection && mongoose.connection.readyState;
  checks.mongo = mongoState === 1 ? 'up' : 'down';
  if (mongoState !== 1) ok = false;

  // Redis — only ping if the client is open. A closed client is allowed (cache optional).
  try {
    const redis = getRedisClient();
    if (redis && redis.isOpen) {
      const pong = await redis.ping();
      checks.redis = pong === 'PONG' ? 'up' : 'degraded';
    } else {
      checks.redis = 'not_connected';
    }
  } catch (err) {
    checks.redis = 'down';
    logger.warn({ err }, 'health: redis ping failed');
  }

  // Meta WhatsApp circuit breaker — informational, not critical
  if (metaCircuitBreaker) {
    if (metaCircuitBreaker.opened) checks.meta = 'circuit_open';
    else if (metaCircuitBreaker.halfOpen) checks.meta = 'half_open';
    else checks.meta = 'closed';
  } else {
    checks.meta = 'unknown';
  }

  const status = ok ? 'ready' : 'not_ready';
  res.status(ok ? 200 : 503).json({ status, checks, ts: new Date().toISOString() });
});

module.exports = router;
