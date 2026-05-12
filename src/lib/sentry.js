const Sentry = require('@sentry/node');
const logger = require('./logger');

let initialized = false;

const initSentry = () => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info({ component: 'sentry' }, 'SENTRY_DSN not set — Sentry disabled');
    return null;
  }
  try {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV || 'development',
    });
    initialized = true;
    logger.info({ component: 'sentry' }, 'Sentry initialized');
  } catch (err) {
    logger.error({ component: 'sentry', err }, 'Sentry init failed');
  }
  return Sentry;
};

const captureException = (err, ctx = {}) => {
  if (!initialized) return;
  try {
    Sentry.withScope((scope) => {
      if (ctx.tenantId) scope.setTag('tenantId', String(ctx.tenantId));
      if (ctx.userId) scope.setTag('userId', String(ctx.userId));
      if (ctx.requestId) scope.setTag('requestId', String(ctx.requestId));
      if (ctx.extra) scope.setExtras(ctx.extra);
      Sentry.captureException(err);
    });
  } catch {
    // never let observability blow up the caller
  }
};

const flush = (timeoutMs = 2000) => {
  if (!initialized) return Promise.resolve(true);
  try {
    return Sentry.flush(timeoutMs);
  } catch {
    return Promise.resolve(true);
  }
};

module.exports = { initSentry, captureException, flush, Sentry };
