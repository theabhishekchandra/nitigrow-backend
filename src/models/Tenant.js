const mongoose = require('mongoose');

const DAILY_LIMITS = { trial: 250, starter: 1000, growth: 5000, pro: 20000, enterprise: 100000 };

// Monthly plan limits — authoritative source of truth for usage enforcement
const PLAN_LIMITS = {
  trial:      { messages: 1000,   contacts: 200,   ai: 100,    users: 1 },
  starter:    { messages: 5000,   contacts: 2000,  ai: 1000,   users: 1 },
  growth:     { messages: 25000,  contacts: 10000, ai: 5000,   users: 3 },
  pro:        { messages: 100000, contacts: -1,    ai: -1,     users: 10 },
  enterprise: { messages: -1,     contacts: -1,    ai: -1,     users: -1 },
};

const tenantSchema = new mongoose.Schema({
  businessName:  { type: String, required: true },
  email:         { type: String, required: true, unique: true },
  phone:         { type: String },
  plan:          { type: String, enum: ['trial', 'starter', 'growth', 'pro', 'enterprise'], default: 'trial' },
  status:        { type: String, enum: ['active', 'suspended', 'cancelled'], default: 'active' },
  wabaId:        { type: String },
  phoneNumberId: { type: String },
  accessToken:   { type: String }, // AES-256-GCM encrypted — never plain text
  displayPhoneNumber: { type: String },
  industry:      { type: String },

  // WhatsApp quality + messaging tier
  qualityRating:  { type: String, enum: ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'], default: 'UNKNOWN' },
  messagingTier:  { type: String, enum: ['TIER_1K', 'TIER_10K', 'TIER_100K', 'TIER_UNLIMITED'], default: 'TIER_1K' },
  dailyLimit:     { type: Number, default: 250 },
  dailyMsgCount:  { type: Number, default: 0 },
  dailyCountResetAt: { type: Date, default: Date.now },

  // ─── Monthly usage counters (reset on billing cycle) ─────────────────────
  usage: {
    month:          { type: String, default: () => new Date().toISOString().slice(0, 7) }, // "2026-04"
    messagesSent:   { type: Number, default: 0 },
    aiOperations:   { type: Number, default: 0 },
    contactsCount:  { type: Number, default: 0 },
  },

  // ─── Custom limit overrides (e.g. admin gifts extra quota) ───────────────
  customLimits: {
    messages: { type: Number, default: 0 }, // bonus on top of plan
    ai:       { type: Number, default: 0 },
    contacts: { type: Number, default: 0 },
  },

  subscription: {
    status:               { type: String, enum: ['trial', 'active', 'past_due', 'cancelled', 'expired'], default: 'trial' },
    trialEndsAt:          { type: Date, default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
    currentPeriodStart:   { type: Date },
    currentPeriodEnd:     { type: Date },
    razorpaySubscriptionId: { type: String },
    cancelAtPeriodEnd:    { type: Boolean, default: false },
  },

  settings: {
    timezone: { type: String, default: 'Asia/Kolkata' },
    language: { type: String, default: 'en' },

    // Business hours (per day: { open: "09:00", close: "18:00", enabled: true })
    businessHours: {
      enabled: { type: Boolean, default: false },
      timezone: { type: String, default: 'Asia/Kolkata' },
      schedule: {
        monday:    { open: { type: String, default: '09:00' }, close: { type: String, default: '18:00' }, enabled: { type: Boolean, default: true } },
        tuesday:   { open: { type: String, default: '09:00' }, close: { type: String, default: '18:00' }, enabled: { type: Boolean, default: true } },
        wednesday: { open: { type: String, default: '09:00' }, close: { type: String, default: '18:00' }, enabled: { type: Boolean, default: true } },
        thursday:  { open: { type: String, default: '09:00' }, close: { type: String, default: '18:00' }, enabled: { type: Boolean, default: true } },
        friday:    { open: { type: String, default: '09:00' }, close: { type: String, default: '18:00' }, enabled: { type: Boolean, default: true } },
        saturday:  { open: { type: String, default: '10:00' }, close: { type: String, default: '14:00' }, enabled: { type: Boolean, default: true } },
        sunday:    { open: { type: String, default: '00:00' }, close: { type: String, default: '00:00' }, enabled: { type: Boolean, default: false } },
      },
    },

    // Auto-reply messages
    autoReplies: {
      welcome: {
        enabled: { type: Boolean, default: false },
        message: { type: String, default: 'Hi {{name}}! Welcome to {{business}}. How can we help you today?' },
      },
      away: {
        enabled: { type: Boolean, default: false },
        message: { type: String, default: 'Thanks for reaching out! All our agents are currently busy. We\'ll get back to you shortly.' },
      },
      outOfHours: {
        enabled: { type: Boolean, default: false },
        message: { type: String, default: 'Hi! We\'re currently outside business hours. We\'ll respond when we\'re back online.' },
      },
    },
  },
}, { timestamps: true });

// ─── Indexes for fast usage lookups ──────────────────────────────────────────
tenantSchema.index({ 'usage.month': 1 });

// ─── Existing daily send check ────────────────────────────────────────────────
tenantSchema.methods.canSendMessages = function (count = 1) {
  const now = new Date();
  const resetAt = this.dailyCountResetAt || new Date(0);
  const isNewDay = now.getDate() !== resetAt.getDate() || now.getMonth() !== resetAt.getMonth();
  if (isNewDay) return true;
  return (this.dailyMsgCount + count) <= this.dailyLimit;
};

tenantSchema.methods.incrementMessageCount = async function (count = 1) {
  const now = new Date();
  const resetAt = this.dailyCountResetAt || new Date(0);
  const isNewDay = now.getDate() !== resetAt.getDate() || now.getMonth() !== resetAt.getMonth();
  if (isNewDay) {
    this.dailyMsgCount = count;
    this.dailyCountResetAt = now;
  } else {
    this.dailyMsgCount += count;
  }
  await this.save();
};

// ─── Monthly usage check ──────────────────────────────────────────────────────
// resource: 'messages' | 'ai' | 'contacts'
// Returns { allowed: bool, used: number, limit: number, pct: number }
tenantSchema.methods.checkUsage = function (resource) {
  const plan = this.plan || 'trial';
  const planLimit = PLAN_LIMITS[plan]?.[resource] ?? 0;
  const bonus = this.customLimits?.[resource] || 0;
  const limit = planLimit === -1 ? -1 : planLimit + bonus; // -1 = unlimited

  // Auto-reset if month changed
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (this.usage.month !== currentMonth) {
    // month rolled — treat as 0 used (caller will reset on next increment)
    return { allowed: true, used: 0, limit, pct: 0, unlimited: limit === -1 };
  }

  const used = this.usage[resource === 'messages' ? 'messagesSent' : resource === 'ai' ? 'aiOperations' : 'contactsCount'] || 0;
  if (limit === -1) return { allowed: true, used, limit: -1, pct: 0, unlimited: true };

  return { allowed: used < limit, used, limit, pct: Math.round((used / limit) * 100), unlimited: false };
};

// ─── Atomic monthly usage increment ──────────────────────────────────────────
tenantSchema.methods.incrementUsage = async function (resource, count = 1) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const fieldMap = { messages: 'usage.messagesSent', ai: 'usage.aiOperations', contacts: 'usage.contactsCount' };
  const field = fieldMap[resource];
  if (!field) return;

  const update = this.usage.month !== currentMonth
    ? { $set: { 'usage.month': currentMonth, 'usage.messagesSent': 0, 'usage.aiOperations': 0, 'usage.contactsCount': 0 }, $inc: { [field]: count } }
    : { $inc: { [field]: count } };

  await this.model('Tenant').updateOne({ _id: this._id }, update);
};

tenantSchema.statics.DAILY_LIMITS = DAILY_LIMITS;
tenantSchema.statics.PLAN_LIMITS  = PLAN_LIMITS;

module.exports = mongoose.model('Tenant', tenantSchema);
