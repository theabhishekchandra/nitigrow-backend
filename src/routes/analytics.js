const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { protect, requireRole } = require('../middleware/auth');
const Message = require('../models/Message');
const Contact = require('../models/Contact');
const Campaign = require('../models/Campaign');

router.use(protect, requireRole('owner', 'manager', 'analyst'));

const toOid = (id) => new mongoose.Types.ObjectId(id.toString());
const since14 = () => new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

// GET /api/analytics/overview
router.get('/overview', async (req, res) => {
  const tid = req.tenantId;
  const [totalContacts, totalMessages, outbound, inbound, delivered, read, campaigns] = await Promise.all([
    Contact.countDocuments({ tenantId: tid }),
    Message.countDocuments({ tenantId: tid }),
    Message.countDocuments({ tenantId: tid, direction: 'outbound' }),
    Message.countDocuments({ tenantId: tid, direction: 'inbound' }),
    Message.countDocuments({ tenantId: tid, direction: 'outbound', status: { $in: ['delivered', 'read'] } }),
    Message.countDocuments({ tenantId: tid, direction: 'outbound', status: 'read' }),
    Campaign.find({ tenantId: tid, status: 'completed' }).select('name stats completedAt').sort({ completedAt: -1 }).limit(5),
  ]);
  res.json({ totalContacts, totalMessages, outbound, inbound, delivered, read, recentCampaigns: campaigns });
});

// GET /api/analytics/messages-per-day
router.get('/messages-per-day', async (req, res) => {
  const rows = await Message.aggregate([
    { $match: { tenantId: toOid(req.tenantId), createdAt: { $gte: since14() } } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      total: { $sum: 1 },
      outbound: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
      inbound:  { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } },
    }},
    { $sort: { _id: 1 } },
  ]);
  res.json(rows);
});

// GET /api/analytics/contacts-per-day
router.get('/contacts-per-day', async (req, res) => {
  const rows = await Contact.aggregate([
    { $match: { tenantId: toOid(req.tenantId), createdAt: { $gte: since14() } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  res.json(rows);
});

module.exports = router;
