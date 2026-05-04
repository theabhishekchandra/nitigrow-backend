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
  try {
    const tid = toOid(req.tenantId);
    const now = new Date();
    const start30  = new Date(now - 30 * 86400000);
    const start60  = new Date(now - 60 * 86400000);

    const [
      totalContacts, newContacts30, newContacts60,
      msgSent30, msgSent60,
      msgIn30,
      openConvos, resolvedConvos,
      recentCampaigns,
    ] = await Promise.all([
      Contact.countDocuments({ tenantId: tid }),
      Contact.countDocuments({ tenantId: tid, createdAt: { $gte: start30 } }),
      Contact.countDocuments({ tenantId: tid, createdAt: { $gte: start60, $lt: start30 } }),
      Message.countDocuments({ tenantId: tid, direction: 'outbound', createdAt: { $gte: start30 } }),
      Message.countDocuments({ tenantId: tid, direction: 'outbound', createdAt: { $gte: start60, $lt: start30 } }),
      Message.countDocuments({ tenantId: tid, direction: 'inbound',  createdAt: { $gte: start30 } }),
      Contact.countDocuments({ tenantId: tid, conversationStatus: 'open' }),
      Contact.countDocuments({ tenantId: tid, conversationStatus: 'resolved', updatedAt: { $gte: start30 } }),
      Campaign.find({ tenantId: tid, status: { $in: ['sent', 'completed'] } })
        .select('name stats sentAt').sort({ sentAt: -1 }).limit(5),
    ]);

    const delta = (curr, prev) => prev === 0 ? 0 : Math.round((curr - prev) / prev * 100 * 10) / 10;

    res.json({
      stats: {
        totalContacts,
        contactsDelta: delta(newContacts30, newContacts60),
        openConversations: openConvos,
        messagesSent30d: msgSent30,
        messagesDelta: delta(msgSent30, msgSent60),
        responseRate: msgSent30 > 0 ? Math.round(msgIn30 / msgSent30 * 100) : 0,
        resolved30d: resolvedConvos,
      },
      recentCampaigns,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/messages-per-day
router.get('/messages-per-day', async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = from ? new Date(from) : since14();
    const end   = to   ? new Date(to)   : new Date();
    const rows = await Message.aggregate([
      { $match: { tenantId: toOid(req.tenantId), createdAt: { $gte: start, $lte: end } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total:    { $sum: 1 },
        outbound: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
        inbound:  { $sum: { $cond: [{ $eq: ['$direction', 'inbound']  }, 1, 0] } },
      }},
      { $sort: { _id: 1 } },
    ]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// GET /api/analytics/channel-mix
router.get('/channel-mix', async (req, res) => {
  try {
    const tid = toOid(req.tenantId);
    const rows = await Contact.aggregate([
      { $match: { tenantId: tid } },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
    ]);
    const result = { whatsapp: 0, instagram: 0, email: 0 };
    rows.forEach(r => { if (r._id in result) result[r._id] = r.count; });
    const total = Object.values(result).reduce((a, b) => a + b, 0) || 1;
    const pct = {};
    Object.entries(result).forEach(([k, v]) => { pct[k] = Math.round(v / total * 100); });
    res.json(pct);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/heatmap — 30-day message volume by day-of-week × hour
router.get('/heatmap', async (req, res) => {
  try {
    const tid = toOid(req.tenantId);
    const since30 = new Date(Date.now() - 30 * 86400000);
    const rows = await Message.aggregate([
      { $match: { tenantId: tid, createdAt: { $gte: since30 } } },
      { $group: {
        _id: {
          day:  { $dayOfWeek: '$createdAt' },
          hour: { $hour: '$createdAt' },
        },
        value: { $sum: 1 },
      }},
    ]);
    // day: 1=Sun..7=Sat → convert to 0=Mon..6=Sun
    const data = rows.map(r => ({
      day:  (r._id.day + 5) % 7,
      hour: r._id.hour,
      value: r.value,
    }));
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/top-agents — agent performance for last 30d
router.get('/top-agents', async (req, res) => {
  try {
    const tid = toOid(req.tenantId);
    const since30 = new Date(Date.now() - 30 * 86400000);
    const User = require('../models/User');

    const agentStats = await Message.aggregate([
      { $match: { tenantId: tid, direction: 'outbound', sentBy: { $exists: true, $ne: null }, createdAt: { $gte: since30 } } },
      { $group: { _id: '$sentBy', replies: { $sum: 1 } } },
      { $sort: { replies: -1 } },
      { $limit: 10 },
    ]);

    const userIds = agentStats.map(a => a._id);
    const users = await User.find({ _id: { $in: userIds }, tenantId: tid }).select('name');
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u.name; });

    const data = agentStats.map(a => ({
      agentId: a._id,
      name: userMap[a._id?.toString()] || 'Unknown',
      replies: a.replies,
    }));

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
