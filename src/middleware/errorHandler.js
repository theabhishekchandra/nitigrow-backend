/**
 * Global Express error handler.
 *
 * Serializes known error shapes to RFC 7807 problem-details JSON:
 *   - AppError (and subclasses)         → as-is
 *   - Mongoose ValidationError          → Validation 422
 *   - MongoServerError duplicate key    → Conflict 409
 *   - ZodError                          → Validation 422
 *   - Anything else                     → Internal 500 (message redacted)
 *
 * NOTE: Not yet wired into `src/index.js`. A future PR should register this
 * at the BOTTOM of the middleware chain (after all routes, replacing the
 * inline handler currently in index.js):
 *
 *   const errorHandler = require('./middleware/errorHandler');
 *   app.use(errorHandler);
 */

const { AppError, Validation, Conflict, Internal } = require('../lib/errors');

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// Lazy-load Sentry capture to avoid pulling @sentry/node into modules that
// don't need it and to break any potential require cycles.
function safeCaptureException(err, ctx) {
  try {
    const sentry = require('../lib/sentry');
    if (sentry && typeof sentry.captureException === 'function') {
      sentry.captureException(err, ctx);
    }
  } catch {
    // Sentry module not available or threw — observability must never crash
    // the request pipeline.
  }
}

// Lazy require ZodError to dodge any require cycles and to keep this module
// loadable in environments where `zod` is not installed.
function isZodError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.name === 'ZodError' && Array.isArray(err.issues)) return true;
  try {
    const { ZodError } = require('zod');
    return err instanceof ZodError;
  } catch {
    return false;
  }
}

function normalizeMongooseValidation(err) {
  const issues = Object.entries(err.errors || {}).map(([path, e]) => ({
    path: path.split('.'),
    message: e && e.message ? e.message : 'Invalid value',
    code: (e && e.kind) || 'invalid',
  }));
  return new Validation('Validation failed', { details: { issues } });
}

function normalizeMongoDuplicateKey(err) {
  const keyValue = err.keyValue || {};
  return new Conflict('Duplicate key', {
    details: {
      keyPattern: err.keyPattern,
      keyValue,
    },
  });
}

function normalizeZod(err) {
  return new Validation('Validation failed', {
    details: { issues: err.issues },
  });
}

/**
 * 4-arg Express error middleware.
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
function errorHandler(err, req, res, _next) {
  // If headers already flushed, defer to Express default handler.
  if (res.headersSent) {
    return _next(err);
  }

  const log = (req && req.log) || console;
  const logErr =
    typeof log.error === 'function' ? log.error.bind(log) : console.error.bind(console);

  let appErr;
  let isUnknown = false;

  if (err instanceof AppError) {
    appErr = err;
  } else if (err && err.name === 'ValidationError' && err.errors) {
    // Mongoose validation error
    appErr = normalizeMongooseValidation(err);
  } else if (err && err.name === 'MongoServerError' && err.code === 11000) {
    appErr = normalizeMongoDuplicateKey(err);
  } else if (isZodError(err)) {
    appErr = normalizeZod(err);
  } else {
    isUnknown = true;
    // Do NOT leak err.message to the client for unknown errors.
    appErr = new Internal('Internal server error');
  }

  // Log: full stack for unknown/5xx, lighter log for known 4xx.
  if (isUnknown || appErr.status >= 500) {
    try {
      logErr({ err, status: appErr.status, code: appErr.code }, 'unhandled_error');
    } catch {
      // Pino-style call signature may not be supported on console; fall back.
      console.error(err && err.stack ? err.stack : err);
    }
    safeCaptureException(err, {
      tenantId: req && req.user && req.user.tenantId,
      userId: req && req.user && (req.user._id || req.user.id),
      requestId: req && (req.id || req.requestId),
    });
  } else {
    try {
      logErr({ status: appErr.status, code: appErr.code, msg: appErr.message }, 'handled_error');
    } catch {
      // ignore — logging must not break responses
    }
  }

  // Retry-After header for Locked/RateLimited when retryAfter is provided
  // (in seconds, per RFC 7231).
  const retryAfter = appErr.details && appErr.details.retryAfter;
  if ((appErr.status === 423 || appErr.status === 429) && retryAfter != null) {
    res.set('Retry-After', String(retryAfter));
  }

  const problem = appErr.toProblem({ instance: req && req.originalUrl });
  res.status(appErr.status);
  res.type(PROBLEM_CONTENT_TYPE);
  res.json(problem);
}

module.exports = errorHandler;
module.exports.errorHandler = errorHandler;
