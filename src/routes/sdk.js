const express = require('express');
const router = express.Router();
const Tenant = require('../models/Tenant');

/**
 * GET /api/sdk/init
 * Loads the widget configuration for a specific API key.
 * Used by the embeddable script to customize colors, business name, etc.
 */
router.get('/init', async (req, res) => {
  try {
    const { apiKey } = req.query;
    if (!apiKey) return res.status(400).json({ error: 'apikey_required' });

    // TODO: Implement actual API Key lookup on Tenant model
    // For now, find by businessName (simulating key lookup)
    const tenant = await Tenant.findOne({ status: 'active' }); 
    
    if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

    res.json({
      businessName: tenant.businessName,
      themeColor: '#25D366', // Default NitiGrow green
      welcomeMessage: 'Hi! How can we help you?',
      features: {
        voice: true,
        media: true
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
