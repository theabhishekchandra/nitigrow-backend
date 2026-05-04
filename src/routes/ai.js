const express = require('express');
const router = express.Router();
const { getReplySuggestions } = require('../controllers/aiController');
const { protect } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');
const { requireLimit } = require('../middleware/usageLimit');

router.use(protect, requireTenant);

// Rate-limit Claude API calls — 1 req/second per tenant is more than enough
router.post('/reply-suggestions/:contactId', requireLimit('ai'), getReplySuggestions);

// POST /api/ai/summarize/:contactId — summarize a conversation thread
router.post('/summarize/:contactId', requireLimit('ai'), async (req, res) => {
  try {
    const Message = require('../models/Message');
    const Contact = require('../models/Contact');

    const contact = await Contact.findOne({ _id: req.params.contactId, tenantId: req.tenantId });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const messages = await Message.find({ tenantId: req.tenantId, contactId: req.params.contactId })
      .sort({ createdAt: -1 }).limit(20);

    const thread = messages.reverse().map(m => {
      const text = m.content?.text || m.content?.caption || '[media]';
      return `${m.direction === 'inbound' ? contact.name || 'Customer' : 'Agent'}: ${text}`;
    }).join('\n');

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Summarize this WhatsApp conversation in 2-3 sentences. Focus on: what the customer wanted, what was resolved, any pending action. Be concise.\n\nConversation:\n${thread}`,
      }],
    });

    res.json({ summary: response.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/classify-intent — classify message intent
router.post('/classify-intent', requireLimit('ai'), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      messages: [{
        role: 'user',
        content: `Classify this WhatsApp message intent. Reply with ONLY a JSON object: {"intent": "...", "confidence": 0.0-1.0}. Intent must be one of: order_enquiry, order_tracking, complaint, return_request, product_enquiry, price_enquiry, greeting, opt_out, payment, other.\n\nMessage: "${text}"`,
      }],
    });

    try {
      const parsed = JSON.parse(response.content[0].text);
      res.json(parsed);
    } catch {
      res.json({ intent: 'other', confidence: 0.5 });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
