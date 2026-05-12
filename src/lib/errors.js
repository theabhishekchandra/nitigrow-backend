/**
 * Centralized error primitives for NitiGrow backend.
 *
 * All errors thrown by application code (controllers, services, middleware)
 * should ideally derive from `AppError`. The global error handler
 * (`src/middleware/errorHandler.js`) serializes them to RFC 7807
 * problem-details JSON.
 *
 * This file has NO runtime dependencies — safe to require from anywhere.
 */

const DEFAULT_TYPE = 'about:blank';

/**
 * Base application error.
 *
 * @example
 *   throw new AppError('Tenant suspended', {
 *     status: 423,
 *     code: 'TENANT_SUSPENDED',
 *     details: { tenantId },
 *   });
 */
class AppError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, details?: object, cause?: Error }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = opts.status ?? 500;
    this.code = opts.code ?? 'INTERNAL';
    this.details = opts.details ?? {};
    if (opts.cause) this.cause = opts.cause;
    // Preserve stack starting from caller, not from this constructor.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize to an RFC 7807 problem-details object.
   * Callers may pass `instance` (typically the request URL) at response time.
   * @param {{ instance?: string, type?: string }} [ctx]
   */
  toProblem(ctx = {}) {
    const { instance, type } = ctx;
    return {
      type: type ?? DEFAULT_TYPE,
      title: this.code,
      status: this.status,
      detail: this.message,
      ...(instance ? { instance } : {}),
      ...this.details,
    };
  }
}

class BadRequest extends AppError {
  constructor(message = 'Bad request', opts = {}) {
    super(message, { status: 400, code: 'BAD_REQUEST', ...opts });
  }
}

class Unauthorized extends AppError {
  constructor(message = 'Unauthorized', opts = {}) {
    super(message, { status: 401, code: 'UNAUTHORIZED', ...opts });
  }
}

class Forbidden extends AppError {
  constructor(message = 'Forbidden', opts = {}) {
    super(message, { status: 403, code: 'FORBIDDEN', ...opts });
  }
}

class NotFound extends AppError {
  constructor(message = 'Not found', opts = {}) {
    super(message, { status: 404, code: 'NOT_FOUND', ...opts });
  }
}

class Conflict extends AppError {
  constructor(message = 'Conflict', opts = {}) {
    super(message, { status: 409, code: 'CONFLICT', ...opts });
  }
}

/**
 * Resource locked (423). Supports `retryAfter` (seconds) in details — the
 * error handler will surface it via the `Retry-After` response header.
 */
class Locked extends AppError {
  constructor(message = 'Locked', opts = {}) {
    super(message, { status: 423, code: 'LOCKED', ...opts });
  }
}

/**
 * Rate limit exceeded (429). Supports `retryAfter` (seconds) in details —
 * the error handler will surface it via the `Retry-After` response header.
 */
class RateLimited extends AppError {
  constructor(message = 'Rate limit exceeded', opts = {}) {
    super(message, { status: 429, code: 'RATE_LIMITED', ...opts });
  }
}

/**
 * Validation failure (422). Supports `issues` array in details — typically
 * an array of `{ path, message, code }` entries.
 */
class Validation extends AppError {
  constructor(message = 'Validation failed', opts = {}) {
    super(message, { status: 422, code: 'VALIDATION', ...opts });
  }
}

class Internal extends AppError {
  constructor(message = 'Internal server error', opts = {}) {
    super(message, { status: 500, code: 'INTERNAL', ...opts });
  }
}

module.exports = {
  AppError,
  BadRequest,
  Unauthorized,
  Forbidden,
  NotFound,
  Conflict,
  Locked,
  RateLimited,
  Validation,
  Internal,
};
