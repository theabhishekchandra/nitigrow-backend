const mongoose = require('mongoose');

const segmentSchema = new mongoose.Schema({
  tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name:         { type: String, required: true },
  description:  { type: String },
  filters: [{
    field:    { type: String },  // e.g. 'tags', 'status', 'city', 'channel'
    operator: { type: String },  // 'includes', 'equals', 'gte', 'lte'
    value:    { type: mongoose.Schema.Types.Mixed },
  }],
  contactCount: { type: Number, default: 0 },
  isSystem:     { type: Boolean, default: false }, // built-in segments (All, Active, VIP)
}, { timestamps: true });

segmentSchema.index({ tenantId: 1 });

module.exports = mongoose.model('Segment', segmentSchema);
