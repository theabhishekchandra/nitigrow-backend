const mongoose = require('mongoose');
const crypto = require('crypto');

// A ChatSession is one continuous "tab open in the browser" interaction
// with the SDK widget. Multiple sessions can share the same Contact (an
// emailed-in visitor who returns days later); a session never spans
// tabs (sessionStorage scope, by design — see phase-5-sdk-plan.md).
const chatSessionSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApiKey' },

    // The Contact this session is bound to. May be created on first
    // message if the visitor didn't fill the pre-chat form. Either way,
    // every message references it so the existing inbox plumbing works.
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },

    // Opaque, high-entropy token the widget sends with every request and
    // socket event. Hashed before storage so a DB leak doesn't grant
    // session impersonation.
    sessionTokenHash: { type: String, required: true, unique: true },
    sessionTokenPreview: { type: String },

    visitor: {
      name: { type: String, maxlength: 120 },
      email: { type: String, maxlength: 200 },
      phone: { type: String, maxlength: 30 },
    },

    pageUrl: { type: String, maxlength: 500 },
    referrer: { type: String, maxlength: 500 },
    ua: { type: String, maxlength: 500 },
    ip: { type: String, maxlength: 60 },

    status: {
      type: String,
      enum: ['active', 'closed', 'handoff_to_whatsapp'],
      default: 'active',
      index: true,
    },
    keyType: { type: String, enum: ['live', 'test'], default: 'live' },

    messageCount: { type: Number, default: 0 },
    lastActivityAt: { type: Date, default: Date.now },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

chatSessionSchema.index({ tenantId: 1, createdAt: -1 });
chatSessionSchema.index({ tenantId: 1, status: 1, lastActivityAt: -1 });

// Generates an opaque session token. Returns the raw token (handed to
// the widget) and its SHA-256 hash (stored). Token is 32 random bytes —
// 256 bits of entropy, generous for a session credential.
chatSessionSchema.statics.generateToken = function () {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash, preview: raw.slice(0, 8) + '...' };
};

chatSessionSchema.statics.hashToken = function (raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
};

module.exports = mongoose.model('ChatSession', chatSessionSchema);
