const express = require('express');
const router = express.Router();
const { getMessages, getConversations, sendMessage, assignConversation, addNote, updateConversationStatus, markConversationRead, getConversationContext } = require('../controllers/inboxController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');
const { requireLimit } = require('../middleware/usageLimit');

router.use(protect, requireTenant, requireRole('owner', 'manager', 'sales_agent', 'support_agent'));

router.get('/conversations', getConversations);
router.get('/conversation/:contactId', getMessages);
router.get('/conversation/:contactId/context', getConversationContext);
router.post('/send', requireLimit('messages'), sendMessage);
router.post('/note/:contactId', addNote);
router.patch('/:contactId/assign', requireRole('owner', 'manager'), assignConversation);
router.patch('/:contactId/status', updateConversationStatus);
router.patch('/:contactId/read', markConversationRead);

module.exports = router;

