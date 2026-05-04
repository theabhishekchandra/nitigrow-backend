const mongoose = require('mongoose');
const crypto = require('crypto');

const webhookEndpointSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  url:      { type: String, required: true },
  events:   [{ type: String }],  // ['new_message', 'campaign_sent', 'contact_created']
  secret:   { type: String },    // HMAC secret for signature verification
  isActive: { type: Boolean, default: true },
  lastPingAt:   { type: Date },
  lastPingStatus: { type: Number },
}, { timestamps: true });

webhookEndpointSchema.index({ tenantId: 1 });

module.exports = mongoose.model('WebhookEndpoint', webhookEndpointSchema);
