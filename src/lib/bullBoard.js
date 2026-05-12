const express = require('express');
const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');

const logger = require('./logger');
const { adminProtect } = require('../middleware/adminAuth');

/**
 * Mounts BullMQ dashboard at /admin-internal/queues — admin-JWT gated.
 *
 * Queues are discovered from src/services/queue.js: campaigns, webhooks,
 * notifications. We only register queues that initialised successfully (the
 * queue module lazy-connects to Redis and may set these to null if Redis was
 * unavailable at boot — board mount must not crash in that case).
 */
const router = express.Router();

let mounted = false;

try {
  const queues = require('../services/queue');
  const candidates = [
    { name: 'campaigns', q: queues.campaignQueue },
    { name: 'webhooks', q: queues.webhookQueue },
    { name: 'notifications', q: queues.notifQueue },
  ].filter((c) => c.q);

  if (candidates.length === 0) {
    logger.warn({ component: 'bullBoard' }, 'No BullMQ queues available — dashboard will be empty');
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin-internal/queues');

  createBullBoard({
    queues: candidates.map((c) => new BullMQAdapter(c.q)),
    serverAdapter,
  });

  // Admin JWT gate first, then bull-board's router.
  router.use(adminProtect, serverAdapter.getRouter());
  mounted = true;
  logger.info(
    { component: 'bullBoard', queues: candidates.map((c) => c.name) },
    'BullBoard mounted',
  );
} catch (err) {
  logger.warn({ err, component: 'bullBoard' }, 'BullBoard mount failed — dashboard disabled');
  router.use((req, res) => res.status(503).json({ error: 'Queue dashboard unavailable' }));
}

module.exports = router;
module.exports.mounted = mounted;
