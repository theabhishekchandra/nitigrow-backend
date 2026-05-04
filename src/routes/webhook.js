const express = require('express');
const router = express.Router();
const { verifyWebhook, receiveWebhook } = require('../controllers/webhookController');

// Meta webhook verification (GET) + message receiving (POST)
router.get('/whatsapp', verifyWebhook);
router.post('/whatsapp', receiveWebhook);

module.exports = router;
