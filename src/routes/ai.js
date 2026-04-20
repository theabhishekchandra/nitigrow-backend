const express = require('express');
const router = express.Router();
const { getReplySuggestions } = require('../controllers/aiController');
const { protect } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');
const { requireLimit } = require('../middleware/usageLimit');

router.use(protect, requireTenant);

// Rate-limit Claude API calls — 1 req/second per tenant is more than enough
router.post('/reply-suggestions/:contactId', requireLimit('ai'), getReplySuggestions);

module.exports = router;
