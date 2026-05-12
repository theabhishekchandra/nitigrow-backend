const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { requireSdkKey } = require('../middleware/sdkKeyAuth');
const {
  startSession,
  sendMessage,
  getHistory,
  closeSession,
} = require('../controllers/sdkChatController');

// Per-key rate limiter. `max` comes from the key doc when available, else a
// conservative default. The key resolution happens in requireSdkKey, so by
// the time we hit this middleware req.sdkKey is populated.
const sdkRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => req.sdkKey?.rateLimit || 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.sdkKey ? String(req.sdkKey._id) : req.ip),
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Rate limit exceeded for this API key' },
});

// Burst limiter on chat/start specifically — opens new sessions, which is
// the resource-heavy path. Per-IP so a single attacker spinning up sessions
// is contained, separately from the per-key limit above.
const startBurst = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many sessions started from this IP' },
});

router.use(requireSdkKey);
router.use(sdkRateLimit);

router.post('/chat/start', startBurst, startSession);
router.post('/chat/message', sendMessage);
router.get('/chat/history', getHistory);
router.post('/chat/close', closeSession);

module.exports = router;
