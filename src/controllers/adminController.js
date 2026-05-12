const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Contact = require('../models/Contact');
const Message = require('../models/Message');
const Template = require('../models/Template');
const Campaign = require('../models/Campaign');
const { decrypt } = require('../services/encryption');
const { verifyTotp } = require('./admin2faController');

const LOCK_THRESHOLD = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

const getClientIp = (req) => req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection?.remoteAddress;

// POST /api/admin/login
const login = async (req, res) => {
  try {
    const { email, password, code } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    // Locked? Reject before bcrypt compare to avoid timing-amplified brute force.
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      const retryAfter = Math.ceil((admin.lockedUntil - Date.now()) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(423).json({ error: 'Account temporarily locked. Try again later.', retryAfter });
    }

    const passwordOk = await admin.matchPassword(password);
    if (!passwordOk) {
      admin.failedLoginCount = (admin.failedLoginCount || 0) + 1;
      if (admin.failedLoginCount >= LOCK_THRESHOLD) {
        admin.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
        admin.failedLoginCount = 0;
      }
      await admin.save();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!admin.isActive) return res.status(403).json({ error: 'Account inactive' });

    // 2FA gate — if enabled and no code provided, hand back a short-lived partial token.
    if (admin.twoFactorEnabled) {
      if (!code) {
        const partial = jwt.sign(
          { id: admin._id, type: 'admin-2fa', stage: 'pending' },
          process.env.JWT_SECRET,
          { expiresIn: '5m' }
        );
        return res.json({ twoFactorRequired: true, partial });
      }

      let codeOk = false;
      if (admin.totpSecret) {
        try { codeOk = verifyTotp(decrypt(admin.totpSecret), code); } catch { codeOk = false; }
      }
      if (!codeOk && admin.recoveryCodes?.length) {
        for (let i = 0; i < admin.recoveryCodes.length; i++) {
          if (await bcrypt.compare(code, admin.recoveryCodes[i])) {
            admin.recoveryCodes.splice(i, 1);
            codeOk = true;
            break;
          }
        }
      }
      if (!codeOk) return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    // Success — issue session.
    admin.failedLoginCount = 0;
    admin.lockedUntil = null;
    admin.lastLoginAt = new Date();
    admin.lastLoginIp = getClientIp(req);

    const jti = crypto.randomBytes(16).toString('hex');
    admin.sessions.push({
      jti,
      ip: admin.lastLoginIp,
      ua: req.headers['user-agent'],
      createdAt: new Date(),
      lastSeenAt: new Date(),
    });
    await admin.save();

    const accessToken = jwt.sign(
      { id: admin._id, type: 'admin', role: admin.role, jti },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      accessToken,
      user: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        twoFactorEnabled: admin.twoFactorEnabled,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/stats
const getStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = new Date().toISOString().slice(0, 7);

    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { PLAN_PRICES } = require('../services/billingService');

    const [
      tenants, activeTenants, trialTenants, messagesToday,
      platformUsage, recentTenants,
      newSignupsToday, trialsExpiring, failedPayments,
      msgStatusToday, planCounts,
    ] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.countDocuments({ status: 'active' }),
      // `trial` is a plan, not a top-level status; subscription.status is also 'trial'.
      Tenant.countDocuments({ plan: 'trial' }),
      Message.countDocuments({ createdAt: { $gte: today } }),
      Tenant.aggregate([
        { $match: { 'usage.month': thisMonth } },
        { $group: { _id: null, totalMessages: { $sum: '$usage.messagesSent' }, totalAiOps: { $sum: '$usage.aiOperations' } } }
      ]),
      Tenant.find().sort({ createdAt: -1 }).limit(10).select('businessName email plan status createdAt usage qualityRating'),
      Tenant.countDocuments({ createdAt: { $gte: today } }),
      Tenant.countDocuments({ plan: 'trial', 'subscription.trialEndsAt': { $gte: today, $lte: in3Days } }),
      Tenant.countDocuments({ 'subscription.status': 'past_due' }),
      Message.aggregate([
        { $match: { createdAt: { $gte: today }, direction: 'outbound' } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      Tenant.aggregate([
        { $match: { status: 'active', plan: { $ne: 'trial' } } },
        { $group: { _id: '$plan', count: { $sum: 1 } } },
      ]),
    ]);

    const stats = platformUsage[0] || { totalMessages: 0, totalAiOps: 0 };
    const sentToday = msgStatusToday.reduce((s, x) => s + x.n, 0) || 1;
    const deliveredOrRead = msgStatusToday.filter(x => x._id === 'delivered' || x._id === 'read').reduce((s, x) => s + x.n, 0);
    const deliveryRate = Math.round((deliveredOrRead / sentToday) * 1000) / 10;
    const mrr = planCounts.reduce((sum, { _id, count }) => sum + (PLAN_PRICES[_id] || 0) * count, 0);

    res.json({
      tenants,
      activeTenants,
      activeClients: activeTenants,
      trialTenants,
      messagesToday,
      deliveryRate,
      newSignups: newSignupsToday,
      trialsExpiring,
      failedPayments,
      openTickets: 0,
      apiErrorRate: 0.8,
      mrr,
      totalMessagesMonth: stats.totalMessages,
      totalAiOpsMonth: stats.totalAiOps,
      recentTenants,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/tenants
const getTenants = async (req, res) => {
  try {
    const { search, plan, status, page = 1, limit = 50 } = req.query;
    const query = {};
    if (plan) query.plan = plan;
    if (status) query.status = status;
    if (search) query.$or = [
      { businessName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];

    const tenants = await Tenant.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select('-accessToken');

    res.json(tenants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/tenants/:id
const getTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id).select('-accessToken');
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const [contacts, messages, templates, campaigns] = await Promise.all([
      Contact.countDocuments({ tenantId: tenant._id }),
      Message.countDocuments({ tenantId: tenant._id }),
      Template.countDocuments({ tenantId: tenant._id }),
      Campaign.countDocuments({ tenantId: tenant._id }),
    ]);

    res.json({ tenant, stats: { contacts, messages, templates, campaigns } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/admin/tenants/:id/status
const updateTenantStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['active', 'suspended', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const tenant = await Tenant.findByIdAndUpdate(req.params.id, { status }, { new: true }).select('-accessToken');
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    console.log(`[ADMIN] ${req.admin.email} changed tenant ${tenant.businessName} status → ${status}`);
    res.json(tenant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/admin/tenants/:id/impersonate
const impersonate = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const ownerUser = await User.findOne({ tenantId: tenant._id, role: 'owner' });
    if (!ownerUser) return res.status(404).json({ error: 'Tenant owner not found' });

    // Short-lived impersonation token (15 minutes)
    const accessToken = jwt.sign(
      { id: ownerUser._id, tenantId: tenant._id, impersonatedBy: req.admin._id },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    console.log(`[ADMIN] ${req.admin.email} impersonating tenant ${tenant.businessName} (${tenant._id})`);
    res.json({ accessToken, tenant: tenant.businessName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/users
const getUsers = async (req, res) => {
  try {
    const { search, tenantId, page = 1, limit = 50 } = req.query;
    const query = {};
    if (tenantId) query.tenantId = tenantId;
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];

    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select('-password')
      .populate('tenantId', 'businessName');

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/billing
const getBilling = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { PLAN_PRICES } = require('../services/billingService');

    const [activeSubscriptions, trialConversions, churned] = await Promise.all([
      Tenant.countDocuments({ status: 'active', plan: { $ne: 'trial' } }),
      Tenant.countDocuments({ status: 'active', 'subscription.startedAt': { $gte: thirtyDaysAgo } }),
      Tenant.countDocuments({ status: 'cancelled', updatedAt: { $gte: thirtyDaysAgo } }),
    ]);

    const planCounts = await Tenant.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]);
    const mrr = planCounts.reduce((sum, { _id, count }) => sum + (PLAN_PRICES[_id] || 0) * count, 0);

    res.json({ mrr, activeSubscriptions, trialConversions, churned, transactions: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/admin/tenants/:id/limits
const updateTenantLimits = async (req, res) => {
  try {
    const { messages, ai, contacts } = req.body;
    const update = {};
    if (messages !== undefined) update['customLimits.messages'] = Number(messages);
    if (ai !== undefined)       update['customLimits.ai'] = Number(ai);
    if (contacts !== undefined) update['customLimits.contacts'] = Number(contacts);

    const tenant = await Tenant.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).select('-accessToken');
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    console.log(`[ADMIN] ${req.admin.email} updated tenant ${tenant.businessName} limits:`, update);
    res.json(tenant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/system — platform health (Redis, MongoDB, queue, Meta circuit state)
const getSystemHealth = async (req, res) => {
  try {
    const { getRedisClient } = require('../config/redis');
    const { metaCircuitBreaker } = require('../services/whatsapp');
    const { getQueueStats } = require('../services/queue');

    // MongoDB: check with a lightweight ping
    let mongoStatus = 'green', mongoLatency = 0;
    try {
      const start = Date.now();
      await Tenant.findOne({}).select('_id').lean();
      mongoLatency = Date.now() - start;
    } catch { mongoStatus = 'red'; }

    // Redis ping
    let redisStatus = 'green', redisMemory = 'N/A';
    try {
      const redis = getRedisClient();
      await redis.ping();
    } catch { redisStatus = 'red'; }

    // BullMQ queue stats
    let queueStats = { campaigns: { waiting: 0, active: 0, failed: 0 }, webhooks: { waiting: 0, active: 0, failed: 0 } };
    try {
      const qs = await getQueueStats();
      if (qs) queueStats = qs;
    } catch {}

    // Meta circuit breaker state
    const cbState = metaCircuitBreaker?.stats?.state || 'closed';

    res.json({
      timestamp: new Date(),
      mongodb: { status: mongoStatus, latency: mongoLatency },
      redis: { status: redisStatus, memory: redisMemory },
      jobQueue: queueStats,
      metaCircuitBreaker: { state: cbState },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/admin/seed — creates first superadmin (only works if no admin exists)
const seedAdmin = async (req, res) => {
  try {
    const exists = await Admin.countDocuments();
    if (exists > 0) return res.status(403).json({ error: 'Admin already seeded' });

    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });

    const admin = await Admin.create({ name, email, password, role: 'superadmin' });
    res.status(201).json({ message: 'Superadmin created', email: admin.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/admin/password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const admin = await Admin.findById(req.admin._id);
    if (!admin || !(await admin.matchPassword(currentPassword))) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }

    admin.password = newPassword; // pre-save hook hashes + sets passwordChangedAt
    await admin.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/admin/profile  — email is intentionally read-only (prevents ownership swap).
const updateProfile = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const admin = await Admin.findByIdAndUpdate(
      req.admin._id,
      { $set: { name: name.trim() } },
      { new: true }
    ).select('-password -totpSecret -recoveryCodes -sessions');

    res.json({
      _id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      twoFactorEnabled: admin.twoFactorEnabled,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/preferences
const getPreferences = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id).select('preferences');
    res.json(admin?.preferences || { notifications: {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/admin/preferences  — full replace of preferences.notifications
const ALLOWED_NOTIF_KEYS = ['newTicketUrgent', 'paymentFailed', 'qualityDropped', 'newSignup', 'weeklyDigest'];
const updatePreferences = async (req, res) => {
  try {
    const { notifications } = req.body || {};
    if (!notifications || typeof notifications !== 'object') {
      return res.status(400).json({ error: 'notifications object required' });
    }

    const next = {};
    for (const key of ALLOWED_NOTIF_KEYS) {
      if (key in notifications) next[key] = Boolean(notifications[key]);
    }

    const admin = await Admin.findByIdAndUpdate(
      req.admin._id,
      { $set: { 'preferences.notifications': next } },
      { new: true }
    ).select('preferences');

    res.json(admin.preferences);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/sessions
const listSessions = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id).select('sessions');
    const currentJti = req.user?.jti;
    const sessions = (admin?.sessions || []).map((s) => ({
      jti: s.jti,
      ip: s.ip,
      ua: s.ua,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      current: s.jti === currentJti,
    }));
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/admin/sessions/:jti
const revokeSession = async (req, res) => {
  try {
    const { jti } = req.params;
    if (!jti) return res.status(400).json({ error: 'jti required' });

    await Admin.updateOne(
      { _id: req.admin._id },
      { $pull: { sessions: { jti } } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/admin/sessions/revoke-others — keep only current session
const revokeAllOtherSessions = async (req, res) => {
  try {
    const currentJti = req.user?.jti;
    const admin = await Admin.findById(req.admin._id);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    admin.sessions = currentJti ? admin.sessions.filter((s) => s.jti === currentJti) : [];
    await admin.save();
    res.json({ success: true, remaining: admin.sessions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/audit — paginated audit feed for the admin Audit Log page
const getAuditLog = async (req, res) => {
  try {
    const AdminAudit = require('../models/AdminAudit');
    const Admin = require('../models/Admin');
    const Tenant = require('../models/Tenant');

    const limit  = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const skip   = parseInt(req.query.skip,  10) || 0;
    const filter = {};
    if (req.query.action)  filter.action   = req.query.action;
    if (req.query.adminId) filter.adminId  = req.query.adminId;
    if (req.query.targetId) filter.targetId = req.query.targetId;
    if (req.query.since)   filter.createdAt = { $gte: new Date(req.query.since) };

    const [entries, total, adminDocs] = await Promise.all([
      AdminAudit.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AdminAudit.countDocuments(filter),
      Admin.find().select('_id name email').lean(),
    ]);

    const adminMap = Object.fromEntries(adminDocs.map(a => [String(a._id), a]));
    const targetIds = [...new Set(
      entries
        .filter(e => e.targetType === 'tenant' && e.targetId)
        .map(e => String(e.targetId))
        .filter(id => /^[a-f0-9]{24}$/i.test(id))
    )];
    const tenantDocs = targetIds.length
      ? await Tenant.find({ _id: { $in: targetIds } }).select('_id businessName').lean()
      : [];
    const tenantMap = Object.fromEntries(tenantDocs.map(t => [String(t._id), t]));

    const data = entries.map(e => ({
      _id: e._id,
      action: e.action,
      admin: adminMap[String(e.adminId)] || null,
      target: (e.targetType === 'tenant' && e.targetId) ? (tenantMap[String(e.targetId)] || { _id: e.targetId, businessName: '(deleted)' }) : null,
      targetType: e.targetType,
      targetId: e.targetId,
      before: e.before,
      after: e.after,
      ip: e.ip,
      ua: e.ua,
      createdAt: e.createdAt,
    }));

    res.json({ data, total, limit, skip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  login, getStats, getTenants, getTenant, updateTenantStatus,
  impersonate, getUsers, getBilling, seedAdmin, updateTenantLimits,
  getSystemHealth,
  changePassword, updateProfile,
  getPreferences, updatePreferences,
  listSessions, revokeSession, revokeAllOtherSessions,
  getAuditLog,
};
