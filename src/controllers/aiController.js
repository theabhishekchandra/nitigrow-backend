const Message = require('../models/Message');
const Contact = require('../models/Contact');
const Tenant = require('../models/Tenant');
const { generateReplySuggestions } = require('../services/aiService');
const { trackUsage } = require('../middleware/usageLimit');

const getReplySuggestions = async (req, res) => {
  try {
    const { contactId } = req.params;
    const tenantId = req.tenantId;

    // req.tenant is attached by requireLimit middleware (avoids double DB fetch)
    const tenant = req.tenant || await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const contact = await Contact.findOne({ _id: contactId, tenantId });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const messages = await Message.find({ tenantId, contactId })
      .sort({ createdAt: -1 })
      .limit(10);

    const contextMessages = messages.reverse();
    const suggestions = await generateReplySuggestions(contextMessages, tenant);

    // Track usage AFTER successful generation
    if (suggestions.length > 0) {
      await trackUsage(tenant, 'ai', 1);
    }

    res.status(200).json({ suggestions });
  } catch (err) {
    console.error('[AI Controller] Error in suggestions:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getReplySuggestions };
