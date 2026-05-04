const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Contact = require('../models/Contact');
const Message = require('../models/Message');
const Template = require('../models/Template');
const Campaign = require('../models/Campaign');

// POST /api/admin/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const admin = await Admin.findOne({ email });
    if (!admin || !(await admin.matchPassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!admin.isActive) return res.status(403).json({ error: 'Account inactive' });

    admin.lastLoginAt = new Date();
    await admin.save();

    const accessToken = jwt.sign(
      { id: admin._id, type: 'admin', role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ accessToken, user: { _id: admin._id, name: admin.name, email: admin.email, role: admin.role } });
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

    const [tenants, activeTenants, trialTenants, messagesToday, platformUsage, recentTenants] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.countDocuments({ status: 'active' }),
      Tenant.countDocuments({ status: 'trial' }),
      Message.countDocuments({ createdAt: { $gte: today } }),
      Tenant.aggregate([
        { $match: { 'usage.month': thisMonth } },
        { $group: { 
            _id: null, 
            totalMessages: { $sum: '$usage.messagesSent' }, 
            totalAiOps: { $sum: '$usage.aiOperations' } 
        } }
      ]),
      Tenant.find().sort({ createdAt: -1 }).limit(10).select('businessName email plan status createdAt usage'),
    ]);

    const stats = platformUsage[0] || { totalMessages: 0, totalAiOps: 0 };

    res.json({ 
      tenants, 
      activeTenants, 
      trialTenants, 
      messagesToday, 
      totalMessagesMonth: stats.totalMessages,
      totalAiOpsMonth: stats.totalAiOps,
      recentTenants 
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

module.exports = {
  login, getStats, getTenants, getTenant, updateTenantStatus,
  impersonate, getUsers, getBilling, seedAdmin, updateTenantLimits,
  getSystemHealth,
};
