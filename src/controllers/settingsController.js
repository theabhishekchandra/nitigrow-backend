const Tenant = require('../models/Tenant');
const { encrypt, decrypt } = require('../services/encryption');

const getSettings = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('-accessToken');
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    res.json({
      businessName: tenant.businessName,
      email: tenant.email,
      phone: tenant.phone,
      plan: tenant.plan,
      status: tenant.status,
      subscription: tenant.subscription,
      whatsapp: {
        connected: !!(tenant.wabaId && tenant.phoneNumberId && tenant.accessToken),
        wabaId: tenant.wabaId || null,
        phoneNumberId: tenant.phoneNumberId || null,
        displayPhoneNumber: tenant.displayPhoneNumber || null,
        qualityRating: tenant.qualityRating || 'UNKNOWN',
        messagingTier: tenant.messagingTier || 'TIER_1K',
        dailyLimit: tenant.dailyLimit || 250,
        dailyMsgCount: tenant.dailyMsgCount || 0,
      },
      usage: tenant.usage,
      settings: tenant.settings || {},
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { businessName, phone } = req.body;
    const updates = {};
    if (businessName) updates.businessName = businessName;
    if (phone) updates.phone = phone;

    const tenant = await Tenant.findByIdAndUpdate(req.tenantId, updates, { new: true }).select('-accessToken');
    res.json({ businessName: tenant.businessName, phone: tenant.phone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const connectWhatsApp = async (req, res) => {
  try {
    const { wabaId, phoneNumberId, accessToken } = req.body;
    if (!wabaId || !phoneNumberId || !accessToken) {
      return res.status(400).json({ error: 'wabaId, phoneNumberId and accessToken are required' });
    }

    // Verify token works before saving
    const axios = require('axios');
    try {
      await axios.get(`https://graph.facebook.com/v19.0/${phoneNumberId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      return res.status(400).json({ error: 'Invalid WhatsApp credentials — token verification failed' });
    }

    const encryptedToken = encrypt(accessToken);
    await Tenant.findByIdAndUpdate(req.tenantId, { wabaId, phoneNumberId, accessToken: encryptedToken });

    res.json({ message: 'WhatsApp connected successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const disconnectWhatsApp = async (req, res) => {
  try {
    await Tenant.findByIdAndUpdate(req.tenantId, {
      $unset: { wabaId: '', phoneNumberId: '', accessToken: '' },
    });
    res.json({ message: 'WhatsApp disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Business Hours ──────────────────────────────────────────────────────────
const updateBusinessHours = async (req, res) => {
  try {
    const { enabled, timezone, schedule } = req.body;
    const update = {};
    if (typeof enabled === 'boolean') update['settings.businessHours.enabled'] = enabled;
    if (timezone) update['settings.businessHours.timezone'] = timezone;
    if (schedule) {
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      for (const day of days) {
        if (schedule[day]) {
          if (schedule[day].open)  update[`settings.businessHours.schedule.${day}.open`]  = schedule[day].open;
          if (schedule[day].close) update[`settings.businessHours.schedule.${day}.close`] = schedule[day].close;
          if (typeof schedule[day].enabled === 'boolean') update[`settings.businessHours.schedule.${day}.enabled`] = schedule[day].enabled;
        }
      }
    }

    const tenant = await Tenant.findByIdAndUpdate(req.tenantId, { $set: update }, { new: true }).select('settings.businessHours');
    res.json({ businessHours: tenant.settings.businessHours });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Auto-Reply Messages ────────────────────────────────────────────────────
const updateAutoReplies = async (req, res) => {
  try {
    const { welcome, away, outOfHours } = req.body;
    const update = {};

    if (welcome) {
      if (typeof welcome.enabled === 'boolean') update['settings.autoReplies.welcome.enabled'] = welcome.enabled;
      if (welcome.message) update['settings.autoReplies.welcome.message'] = welcome.message;
    }
    if (away) {
      if (typeof away.enabled === 'boolean') update['settings.autoReplies.away.enabled'] = away.enabled;
      if (away.message) update['settings.autoReplies.away.message'] = away.message;
    }
    if (outOfHours) {
      if (typeof outOfHours.enabled === 'boolean') update['settings.autoReplies.outOfHours.enabled'] = outOfHours.enabled;
      if (outOfHours.message) update['settings.autoReplies.outOfHours.message'] = outOfHours.message;
    }

    const tenant = await Tenant.findByIdAndUpdate(req.tenantId, { $set: update }, { new: true }).select('settings.autoReplies');
    res.json({ autoReplies: tenant.settings.autoReplies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getSettings, updateProfile, connectWhatsApp, disconnectWhatsApp, updateBusinessHours, updateAutoReplies };
