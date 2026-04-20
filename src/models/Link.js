const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  originalUrl: { type: String, required: true },
  shortCode: { type: String, required: true, unique: true },
  totalClicks: { type: Number, default: 0 },
  uniqueClicks: { type: Number, default: 0 },
}, { timestamps: true });

linkSchema.index({ shortCode: 1 }, { unique: true });
linkSchema.index({ tenantId: 1 });

module.exports = mongoose.model('Link', linkSchema);
