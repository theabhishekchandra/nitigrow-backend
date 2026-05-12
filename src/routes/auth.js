const express = require('express');
const router = express.Router();
const { register, login, refreshToken, logout } = require('../controllers/authController');
const { validate, schemas } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { getPermissionsForRole, getSidebarForRole } = require('../config/permissions');
const { csrfMiddleware, getCsrfToken } = require('../lib/csrf');
const User = require('../models/User');
const Tenant = require('../models/Tenant');

// Hands the frontend a fresh CSRF token + sets the matching cookie.
router.get('/csrf', getCsrfToken);

router.post('/register', validate(schemas.register), register);
router.post('/login', validate(schemas.login), login);
// /refresh and /logout are cookie-authenticated → CSRF-protected.
router.post('/refresh', csrfMiddleware, refreshToken);
router.post('/logout', csrfMiddleware, logout);

// Hydrates the current session — used by web/mobile on launch to verify the JWT
// is still valid and to pull the latest user + tenant snapshot.
router.get('/me', protect, async (req, res) => {
  try {
    const [user, tenant] = await Promise.all([
      User.findById(req.user._id).select('-password'),
      Tenant.findById(req.tenantId).select('-accessToken'),
    ]);
    if (!user || !tenant) return res.status(404).json({ error: 'Session no longer valid' });
    res.json({ user, tenant });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Returns effective permissions for the authenticated user's role
router.get('/permissions', protect, (req, res) => {
  const role = req.user?.role || 'sales_agent';
  res.json({
    role,
    permissions: getPermissionsForRole(role),
    sidebar: getSidebarForRole(role),
  });
});

module.exports = router;
