const express = require('express');
const router = express.Router();
const {
  login, getStats, getTenants, getTenant, updateTenantStatus,
  impersonate, getUsers, getBilling, seedAdmin, updateTenantLimits,
  getSystemHealth,
} = require('../controllers/adminController');
const { adminProtect } = require('../middleware/adminAuth');

// Public — no auth needed
router.post('/login', login);
router.post('/seed', seedAdmin); // one-time only, blocked after first admin exists

// All routes below require admin JWT
router.use(adminProtect);

router.get('/stats', getStats);

router.get('/tenants', getTenants);
router.get('/tenants/:id', getTenant);
router.patch('/tenants/:id/status', updateTenantStatus);
router.patch('/tenants/:id/limits', updateTenantLimits);
router.post('/tenants/:id/impersonate', impersonate);

router.get('/users', getUsers);

router.get('/billing', getBilling);
router.get('/system',  getSystemHealth);

module.exports = router;
