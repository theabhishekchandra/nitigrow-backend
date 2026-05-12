require('dotenv').config();

// Sentry must initialise before anything that may throw — does nothing if SENTRY_DSN unset.
require('./lib/sentry').initSentry();

const logger = require('./lib/logger');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const { createApp } = require('./appFactory');
const { startCronJobs } = require('./jobs/cron');
const { installGracefulShutdown } = require('./lib/shutdown');

const { app, server, io } = createApp();

const PORT = process.env.PORT || 3000;

let workerHandle = null;

const start = async () => {
  await connectDB();
  await connectRedis();

  startCronJobs();

  if (process.env.RUN_WORKER === 'true') {
    workerHandle = require('./worker');
    if (typeof workerHandle.startWorkers === 'function') workerHandle.startWorkers();
  }

  server.listen(PORT, () => logger.info({ port: PORT }, 'NitiGrow API running'));

  installGracefulShutdown(server, {
    onClose: async () => {
      // Close in-band BullMQ workers if present (worker.js exposes stopWorkers when running).
      try {
        if (workerHandle && typeof workerHandle.stopWorkers === 'function') {
          await workerHandle.stopWorkers();
        }
      } catch (err) {
        logger.warn({ err }, 'stopWorkers failed');
      }
    },
  });
};

start().catch((err) => {
  logger.error({ err }, 'Failed to start API');
  process.exit(1);
});

// Last-resort safety nets — keep logs structured, let shutdown handler exit.
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));

module.exports = { app, server, io };
