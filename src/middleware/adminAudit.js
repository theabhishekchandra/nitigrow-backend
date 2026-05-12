const AdminAudit = require('../models/AdminAudit');

// Strip well-known sensitive keys before storing diffs.
const SENSITIVE_KEYS = new Set(['password', 'currentPassword', 'newPassword', 'code', 'totpSecret', 'recoveryCodes']);
const sanitize = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    if (SENSITIVE_KEYS.has(k)) out[k] = '***REDACTED***';
    else out[k] = obj[k];
  }
  return out;
};

const writeAudit = (req, action) => {
  // Fire-and-forget on next tick so a slow DB or write failure never blocks the response.
  setImmediate(() => {
    AdminAudit.create({
      adminId:    req.admin?._id,
      action,
      targetType: req.params?.id ? 'tenant' : undefined,
      targetId:   req.params?.id,
      before:     req._auditBefore,
      after:      sanitize(req.body),
      ip:         req.ip,
      ua:         req.headers['user-agent'],
    }).catch((err) => {
      console.error('[AUDIT] failed to write audit log:', err.message);
    });
  });
};

// Express middleware factory — writes an audit row on 2xx responses.
const auditLog = (action) => (req, res, next) => {
  const originalEnd = res.end;
  res.end = function (...args) {
    if (res.statusCode >= 200 && res.statusCode < 300 && req.admin) {
      writeAudit(req, action);
    }
    return originalEnd.apply(this, args);
  };
  next();
};

// Handler wrapper for the case where the action label is dynamic / computed inside the handler.
const withAudit = (actionResolver, handler) => async (req, res, next) => {
  const originalEnd = res.end;
  res.end = function (...args) {
    if (res.statusCode >= 200 && res.statusCode < 300 && req.admin) {
      const action = typeof actionResolver === 'function' ? actionResolver(req, res) : actionResolver;
      if (action) writeAudit(req, action);
    }
    return originalEnd.apply(this, args);
  };
  return handler(req, res, next);
};

module.exports = { auditLog, withAudit };
