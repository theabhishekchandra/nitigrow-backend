const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { submitContact } = require('../controllers/marketingContactController');

// Public marketing-site contact form. Tighter than the global limiter:
// 10 requests / 10 min per IP. Combined with the in-controller bucket
// (3 successful POSTs / 10 min), abuse is bounded.
const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
});

router.post('/', contactLimiter, submitContact);

module.exports = router;
