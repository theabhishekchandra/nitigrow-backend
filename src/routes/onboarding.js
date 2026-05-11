const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');
const {
  exchangeCode,
  linkExistingWaba,
  verifyConnection,
  disconnect,
} = require('../controllers/onboardingController');

router.use(protect, requireTenant);

router.post('/exchange-code',       exchangeCode);
router.post('/link-existing-waba',  linkExistingWaba);
router.post('/verify-connection',   verifyConnection);
router.post('/disconnect',          requireRole('owner'), disconnect);

module.exports = router;
