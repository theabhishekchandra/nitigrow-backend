const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema({
  tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:       { type: String, required: true },
  keyHash:    { type: String, required: true },  // SHA-256 of key — never store plaintext
  keyPreview: { type: String },                  // first 8 chars: 'niti_abc...'
  lastUsedAt: { type: Date },
  isActive:   { type: Boolean, default: true },
}, { timestamps: true });

apiKeySchema.index({ tenantId: 1 });
apiKeySchema.index({ keyHash: 1 }, { unique: true });

apiKeySchema.statics.generateKey = function () {
  const raw = 'niti_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash, preview: raw.slice(0, 12) + '...' };
};

module.exports = mongoose.model('ApiKey', apiKeySchema);
