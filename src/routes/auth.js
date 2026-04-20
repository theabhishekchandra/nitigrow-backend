const express = require('express');
const router = express.Router();
const { register, login, refreshToken, logout } = require('../controllers/authController');
const { validate, schemas } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { getPermissionsForRole, getSidebarForRole } = require('../config/permissions');

router.post('/register', validate(schemas.register), register);
router.post('/login',    validate(schemas.login), login);
router.post('/refresh',  refreshToken);
router.post('/logout',   logout);

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
