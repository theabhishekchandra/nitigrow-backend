const express = require('express');
const router = express.Router();
const { getStatus, subscribe, cancel, getInvoices, razorpayWebhook } = require('../controllers/billingController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');

// Razorpay webhook — raw body needed for signature verification, NO auth
// Mounted before protect middleware intentionally
router.post(
  '/webhook/razorpay',
  express.raw({ type: 'application/json' }),
  (req, _res, next) => { req.rawBody = req.body; req.body = JSON.parse(req.body.toString('utf8') || '{}'); next(); },
  razorpayWebhook
);

// All other billing routes require authentication + owner/accountant role
router.use(protect, requireTenant);

router.get('/status',   requireRole('owner', 'accountant'), getStatus);
router.post('/subscribe', requireRole('owner'), subscribe);
router.post('/cancel',  requireRole('owner'), cancel);
router.get('/invoices', requireRole('owner', 'accountant'), getInvoices);

module.exports = router;
