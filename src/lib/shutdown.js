const mongoose = require('mongoose');
const logger = require('./logger');
const { flush: flushSentry } = require('./sentry');

/**
 * installGracefulShutdown(server, { onClose })
 *
 * Wires SIGTERM + SIGINT to drain the HTTP server, BullMQ workers, mongoose, and
 * Redis cleanly. Forcibly exits after 35s if any handler hangs.
 *
 * `onClose` is an optional async hook for callers to close their own resources
 * (e.g. BullMQ workers running in-band).
 *
 * Returns a function that also flushes Sentry; useful if you want to trigger
 * a manual shutdown.
 */
const installGracefulShutdown = (server, { onClose } = {}) => {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');

    // Hard kill timer — runs in parallel.
    const killTimer = setTimeout(() => {
      logger.error('Forced exit after 35s — handlers did not finish');
      process.exit(1);
    }, 35_000);
    if (killTimer.unref) killTimer.unref();

    try {
      // 1. Stop accepting new connections + wait up to 30s for in-flight.
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          logger.warn('HTTP server close timed out after 30s');
          resolve();
        }, 30_000);
        if (t.unref) t.unref();
        try {
          server.close((err) => {
            clearTimeout(t);
            if (err) logger.warn({ err }, 'server.close error');
            resolve();
          });
        } catch (err) {
          clearTimeout(t);
          logger.warn({ err }, 'server.close threw');
          resolve();
        }
      });

      // 2. Caller hook — close BullMQ workers if running in-band, etc.
      if (typeof onClose === 'function') {
        try {
          await onClose();
        } catch (err) {
          logger.warn({ err }, 'onClose hook failed');
        }
      }

      // 3. Mongoose
      try {
        if (mongoose.connection && mongoose.connection.readyState !== 0) {
          await mongoose.connection.close(false);
          logger.info('mongoose connection closed');
        }
      } catch (err) {
        logger.warn({ err }, 'mongoose close failed');
      }

      // 4. Redis (node-redis client)
      try {
        const { getRedisClient } = require('../config/redis');
        const redis = getRedisClient();
        if (redis && redis.isOpen) {
          await redis.quit();
          logger.info('redis client quit');
        }
      } catch (err) {
        logger.warn({ err }, 'redis close failed');
      }

      // 5. Flush Sentry events
      try {
        await flushSentry(2000);
      } catch {
        /* noop */
      }

      logger.info('Graceful shutdown complete');
      clearTimeout(killTimer);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Shutdown error');
      clearTimeout(killTimer);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Returns a manual trigger.
  return () => shutdown('manual');
};

module.exports = { installGracefulShutdown };
