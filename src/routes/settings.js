const express = require('express');
const router = express.Router();
const {
  getSettings,
  updateProfile,
  connectWhatsApp,
  disconnectWhatsApp,
  updateBusinessHours,
  updateAutoReplies,
} = require('../controllers/settingsController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');
const ApiKey = require('../models/ApiKey');
const crypto = require('crypto');
const WebhookEndpoint = require('../models/WebhookEndpoint');
const { cacheInvalidate: invalidateSdkKeyCache } = require('../middleware/sdkKeyAuth');

router.use(protect, requireTenant);

router.get('/', requireRole('owner', 'manager'), getSettings);
router.patch('/profile', requireRole('owner', 'manager'), updateProfile);
router.post('/whatsapp/connect', requireRole('owner', 'manager'), connectWhatsApp);
router.delete('/whatsapp/disconnect', requireRole('owner', 'manager'), disconnectWhatsApp);
router.put('/business-hours', requireRole('owner', 'manager'), updateBusinessHours);
router.put('/auto-replies', requireRole('owner', 'manager'), updateAutoReplies);

// GET /api/settings/api-keys — list keys (masked)
router.get('/api-keys', requireRole('owner', 'manager'), async (req, res) => {
  try {
    const keys = await ApiKey.find({ tenantId: req.tenantId, isActive: true })
      .select('-keyHash')
      .sort({ createdAt: -1 });
    res.json({ data: keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/api-keys — generate new key (returns plaintext ONCE).
// Body:
//   name            string (required)
//   scope           'server' | 'sdk'    (default 'server' — back-compat)
//   keyType         'live' | 'test'     (sdk only, default 'live')
//   allowedDomains  string[]            (sdk only; e.g. ['acme.in', '*.acme.in'])
//   rateLimit       number              (sdk only; default 100/min)
router.post('/api-keys', requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { name, scope = 'server', keyType = 'live', allowedDomains = [], rateLimit } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!['server', 'sdk'].includes(scope)) {
      return res.status(400).json({ error: 'scope must be "server" or "sdk"' });
    }
    if (scope === 'sdk') {
      if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) {
        return res.status(400).json({ error: 'SDK keys require at least one allowedDomain' });
      }
      if (!['live', 'test'].includes(keyType)) {
        return res.status(400).json({ error: 'keyType must be "live" or "test"' });
      }
    }

    const { raw, hash, preview } = ApiKey.generateKey({ scope, keyType });
    const doc = await ApiKey.create({
      tenantId: req.tenantId,
      userId: req.user._id,
      name,
      keyHash: hash,
      keyPreview: preview,
      scope,
      keyType: scope === 'sdk' ? keyType : 'live',
      allowedDomains:
        scope === 'sdk' ? allowedDomains.map((d) => String(d).trim()).filter(Boolean) : [],
      rateLimit: scope === 'sdk' && Number.isFinite(rateLimit) ? rateLimit : undefined,
    });

    res.status(201).json({
      key: raw, // plaintext returned ONCE — caller must persist it themselves
      preview,
      name,
      scope: doc.scope,
      keyType: doc.keyType,
      allowedDomains: doc.allowedDomains,
      rateLimit: doc.rateLimit,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/settings/api-keys/:id — revoke key
router.delete('/api-keys/:id', requireRole('owner', 'manager'), async (req, res) => {
  try {
    const doc = await ApiKey.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { isActive: false },
      { new: true },
    );
    // Drop the cached entry so a revoked key stops working immediately
    // rather than at the next TTL refresh.
    if (doc?.keyHash) invalidateSdkKeyCache(doc.keyHash);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/webhooks
router.get('/webhooks', requireRole('owner', 'manager'), async (req, res) => {
  try {
    const hooks = await WebhookEndpoint.find({ tenantId: req.tenantId, isActive: true }).sort({
      createdAt: -1,
    });
    res.json({ data: hooks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/webhooks
router.post('/webhooks', requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { url, events } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const secret = crypto.randomBytes(20).toString('hex');
    const hook = await WebhookEndpoint.create({
      tenantId: req.tenantId,
      url,
      events: events || [],
      secret,
    });
    res.status(201).json({ data: hook });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/settings/webhooks/:id
router.delete('/webhooks/:id', requireRole('owner', 'manager'), async (req, res) => {
  try {
    await WebhookEndpoint.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { isActive: false },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
