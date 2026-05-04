const express = require('express');
const router = express.Router();
const { getSettings, updateProfile, connectWhatsApp, disconnectWhatsApp, updateBusinessHours, updateAutoReplies } = require('../controllers/settingsController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');
const ApiKey = require('../models/ApiKey');
const crypto = require('crypto');
const WebhookEndpoint = require('../models/WebhookEndpoint');

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
      .select('-keyHash').sort({ createdAt: -1 });
    res.json({ data: keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/api-keys — generate new key (returns plaintext ONCE)
router.post('/api-keys', requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { raw, hash, preview } = ApiKey.generateKey();
    await ApiKey.create({ tenantId: req.tenantId, userId: req.user._id, name, keyHash: hash, keyPreview: preview });
    res.status(201).json({ key: raw, preview, name }); // plaintext shown ONCE
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/settings/api-keys/:id — revoke key
router.delete('/api-keys/:id', requireRole('owner', 'manager'), async (req, res) => {
  try {
    await ApiKey.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { isActive: false }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/webhooks
router.get('/webhooks', requireRole('owner', 'manager'), async (req, res) => {
  try {
    const hooks = await WebhookEndpoint.find({ tenantId: req.tenantId, isActive: true }).sort({ createdAt: -1 });
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
    const hook = await WebhookEndpoint.create({ tenantId: req.tenantId, url, events: events || [], secret });
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
      { isActive: false }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
