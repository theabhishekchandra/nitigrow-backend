/**
 * Zod-based request validation middleware.
 *
 * Usage:
 *   const { validate } = require('../middleware/zodValidate');
 *   const { loginSchema } = require('../schemas/auth');
 *
 *   router.post('/login', validate({ body: loginSchema }), loginHandler);
 *
 * On success, the parsed (and possibly transformed) value REPLACES the
 * corresponding `req.body` / `req.params` / `req.query` / `req.headers`.
 * On failure, a `Validation` error is forwarded to `next(err)`; the global
 * error handler turns it into an RFC 7807 422 response with `issues`.
 *
 * Designed for plain Zod schemas (z.object, z.string, etc.). Uses
 * `safeParse` so we never throw internally.
 */

const { Validation } = require('../lib/errors');

const SOURCES = ['body', 'params', 'query', 'headers'];

/**
 * Build a request-validation middleware.
 *
 * @param {{ body?: object, params?: object, query?: object, headers?: object }} schemas
 *        A map of request part → Zod schema. Only provided keys are validated.
 * @returns {import('express').RequestHandler}
 */
function validate(schemas = {}) {
  // Pre-compute which sources we actually need to validate so we don't pay
  // the cost on every request.
  const active = SOURCES.filter((s) => schemas[s] != null);

  return function zodValidateMiddleware(req, _res, next) {
    const issues = [];

    for (const source of active) {
      const schema = schemas[source];
      if (!schema || typeof schema.safeParse !== 'function') {
        // Not a Zod schema — skip rather than crash. Validation middleware
        // should never be the cause of a 500.
        continue;
      }

      const input = req[source];
      const result = schema.safeParse(input);

      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            source,
            path: issue.path,
            message: issue.message,
            code: issue.code,
          });
        }
        continue;
      }

      // Replace with parsed value so downstream handlers see the coerced
      // / transformed shape. `req.query` can be a getter-only property in
      // Express 5 — use defineProperty as a fallback.
      try {
        req[source] = result.data;
      } catch {
        try {
          Object.defineProperty(req, source, {
            value: result.data,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        } catch {
          // If we still can't write, surface as a Validation error so the
          // caller knows their schema cannot be applied here.
          issues.push({
            source,
            path: [],
            message: `Unable to assign parsed ${source}`,
            code: 'assign_failed',
          });
        }
      }
    }

    if (issues.length > 0) {
      return next(new Validation('Validation failed', { details: { issues } }));
    }
    return next();
  };
}

module.exports = { validate };
