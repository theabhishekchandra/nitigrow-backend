const express = require('express');
const router = express.Router();
const { getSettings, updateProfile, connectWhatsApp, disconnectWhatsApp, updateBusinessHours, updateAutoReplies } = require('../controllers/settingsController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');

router.use(protect, requireTenant);

router.get('/', requireRole('owner', 'manager'), getSettings);
router.patch('/profile', requireRole('owner', 'manager'), updateProfile);
router.post('/whatsapp/connect', requireRole('owner', 'manager'), connectWhatsApp);
router.delete('/whatsapp/disconnect', requireRole('owner', 'manager'), disconnectWhatsApp);
router.put('/business-hours', requireRole('owner', 'manager'), updateBusinessHours);
router.put('/auto-replies', requireRole('owner', 'manager'), updateAutoReplies);

module.exports = router;
