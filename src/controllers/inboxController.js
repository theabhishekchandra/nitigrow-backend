const Message = require('../models/Message');
const Contact = require('../models/Contact');
const Tenant = require('../models/Tenant');
const { sendText, sendImage, sendDocument, sendTemplate, sendButtons, saveAndEmit } = require('../services/whatsapp');
const { trackUsage } = require('../middleware/usageLimit');

// Get conversation thread for a contact
const getMessages = async (req, res) => {
  try {
    const { contactId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const contact = await Contact.findOne({ _id: contactId, tenantId: req.tenantId });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const messages = await Message.find({ tenantId: req.tenantId, contactId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ messages: messages.reverse(), contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all conversations (one per contact, latest message)
const getConversations = async (req, res) => {
  try {
    const { search, status } = req.query;

    const contactQuery = { tenantId: req.tenantId };
    if (status) contactQuery.status = status;
    if (search) contactQuery.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];

    const contacts = await Contact.find(contactQuery).sort({ updatedAt: -1 }).limit(100);
    const contactIds = contacts.map(c => c._id);

    const latestMessages = await Message.aggregate([
      { $match: { tenantId: req.tenantId, contactId: { $in: contactIds } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$contactId', message: { $first: '$$ROOT' }, unreadCount: { $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'inbound'] }, { $ne: ['$status', 'read'] }] }, 1, 0] } } } },
    ]);

    const messageMap = {};
    const unreadMap = {};
    latestMessages.forEach(({ _id, message, unreadCount }) => {
      messageMap[_id.toString()] = message;
      unreadMap[_id.toString()] = unreadCount;
    });

    const conversations = contacts.map(c => ({
      contactId: c,
      lastMessage: messageMap[c._id.toString()] || null,
      unreadCount: unreadMap[c._id.toString()] || 0,
    }));

    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Send a message from inbox — route: POST /api/messages/send
const sendMessage = async (req, res) => {
  try {
    const { contactId, type = 'text', text, imageUrl, caption, docUrl, filename, templateName, language, components, buttons, content } = req.body;

    if (!contactId) return res.status(400).json({ error: 'contactId is required' });

    const contact = await Contact.findOne({ _id: contactId, tenantId: req.tenantId });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // req.tenant available from requireLimit middleware
    const tenant = req.tenant || await Tenant.findById(req.tenantId);

    let waResponse;
    let msgContent = {};

    // Support quick text shorthand from frontend: { contactId, content }
    const resolvedText = text || content;

    switch (type) {
      case 'text':
        waResponse = await sendText(req.tenantId, contact.phone, resolvedText);
        msgContent = { text: resolvedText };
        break;
      case 'image':
        waResponse = await sendImage(req.tenantId, contact.phone, imageUrl, caption);
        msgContent = { imageUrl, caption };
        break;
      case 'document':
        waResponse = await sendDocument(req.tenantId, contact.phone, docUrl, filename);
        msgContent = { docUrl, filename };
        break;
      case 'template':
        waResponse = await sendTemplate(req.tenantId, contact.phone, templateName, language, components);
        msgContent = { templateName, language, components };
        break;
      case 'buttons':
        waResponse = await sendButtons(req.tenantId, contact.phone, resolvedText, buttons);
        msgContent = { text: resolvedText, buttons };
        break;
      default:
        return res.status(400).json({ error: 'Unsupported message type' });
    }

    const waMessageId = waResponse?.messages?.[0]?.id;
    const message = await saveAndEmit(req.tenantId, contactId, type, msgContent, waMessageId, req.user._id);

    // Track monthly message usage (non-blocking)
    if (tenant) trackUsage(tenant, 'messages', 1).catch(() => {});

    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Assign conversation to a user
const assignConversation = async (req, res) => {
  try {
    const { contactId } = req.params;
    const { assignedTo } = req.body;

    const contact = await Contact.findOneAndUpdate(
      { _id: contactId, tenantId: req.tenantId },
      { assignedTo },
      { new: true }
    );
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    res.json(contact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getMessages, getConversations, sendMessage, assignConversation };
