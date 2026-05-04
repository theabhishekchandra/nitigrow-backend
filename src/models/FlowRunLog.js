const mongoose = require('mongoose');

const flowRunLogSchema = new mongoose.Schema({
  tenantId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  flowId:         { type: mongoose.Schema.Types.ObjectId, ref: 'ChatbotFlow', required: true },
  flowName:       { type: String },
  contactId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  contactName:    { type: String },
  status:         { type: String, enum: ['completed','handed_off','failed'], default: 'completed' },
  stepsCompleted: { type: Number, default: 0 },
  totalSteps:     { type: Number, default: 0 },
  durationMs:     { type: Number, default: 0 },
  error:          { type: String },
}, { timestamps: true });

flowRunLogSchema.index({ tenantId: 1, flowId: 1, createdAt: -1 });
flowRunLogSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('FlowRunLog', flowRunLogSchema);
