const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const {
  login,
  getStats,
  getTenants,
  getTenant,
  updateTenantStatus,
  impersonate,
  getUsers,
  getBilling,
  seedAdmin,
  updateTenantLimits,
  getSystemHealth,
  changePassword,
  updateProfile,
  getPreferences,
  updatePreferences,
  listSessions,
  revokeSession,
  revokeAllOtherSessions,
  getAuditLog,
} = require('../controllers/adminController');
const twofa = require('../controllers/admin2faController');
const { adminProtect } = require('../middleware/adminAuth');
const { ipAllowlist } = require('../middleware/ipAllowlist');
const { auditLog } = require('../middleware/adminAudit');
const adminAllowlistRoutes = require('./adminAllowlist');

// Tighter rate-limit on admin login to slow credential stuffing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many login attempts. Try again later.' },
});

// Public — no auth needed
router.post('/login', loginLimiter, login);
router.post('/seed', seedAdmin); // one-time only, blocked after first admin exists

// All routes below require admin JWT, and (when configured) the request IP
// must match one of the admin's allowlist CIDRs.
router.use(adminProtect);
router.use(ipAllowlist);

// IP allowlist self-management — must be reachable so a locked-out admin can
// inspect/manage their entries. ipAllowlist bypasses when 0 entries exist;
// once entries exist the admin must be on one of them anyway, so no special case here.
router.use('/allowlist', adminAllowlistRoutes);

router.get('/stats', getStats);

router.get('/tenants', getTenants);
router.get('/tenants/:id', getTenant);
router.patch('/tenants/:id/status', auditLog('tenant.suspend'), updateTenantStatus);
router.patch('/tenants/:id/limits', auditLog('tenant.limits.update'), updateTenantLimits);
router.post('/tenants/:id/impersonate', auditLog('tenant.impersonate'), impersonate);

router.get('/users', getUsers);

router.get('/billing', getBilling);
router.get('/system', getSystemHealth);
router.get('/audit', getAuditLog);

// --- Self-service account routes ---
router.patch('/password', auditLog('admin.password.change'), changePassword);
router.patch('/profile', auditLog('admin.profile.update'), updateProfile);

router.get('/preferences', getPreferences);
router.put('/preferences', updatePreferences);

router.get('/sessions', listSessions);
router.delete('/sessions/:jti', auditLog('admin.session.revoke'), revokeSession);
router.post('/sessions/revoke-others', auditLog('admin.session.revoke'), revokeAllOtherSessions);

// --- 2FA routes ---
router.post('/2fa/setup', auditLog('admin.2fa.setup'), twofa.setup);
router.post('/2fa/verify', auditLog('admin.2fa.enable'), twofa.verify);
router.post('/2fa/disable', auditLog('admin.2fa.disable'), twofa.disable);
router.post('/2fa/recovery/use', auditLog('admin.2fa.recovery'), twofa.useRecoveryCode);

module.exports = router;
