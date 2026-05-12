const mongoose = require('mongoose');

const adminAuditSchema = new mongoose.Schema({
  adminId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  action:     { type: String, required: true }, // e.g. 'tenant.suspend', 'admin.password.change'
  targetType: { type: String },
  targetId:   { type: mongoose.Schema.Types.Mixed },
  before:     { type: mongoose.Schema.Types.Mixed },
  after:      { type: mongoose.Schema.Types.Mixed },
  ip:         { type: String },
  ua:         { type: String },
  createdAt:  { type: Date, default: Date.now },
});

adminAuditSchema.index({ adminId: 1, createdAt: -1 });
adminAuditSchema.index({ targetId: 1, createdAt: -1 });

module.exports = mongoose.model('AdminAudit', adminAuditSchema);
