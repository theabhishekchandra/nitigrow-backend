const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name:         { type: String, required: true },
  templateId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Template', required: true },
  templateName: { type: String, required: true },
  language:     { type: String, default: 'en' },
  audience:     {
    type:        { type: String, enum: ['all', 'tag', 'segment', 'manual'], default: 'all' },
    tags:        [String],
    contactIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Contact' }],
  },
  components:   [mongoose.Schema.Types.Mixed], // static variable values for template
  // Maps template variable position → contact field name
  // e.g. { "1": "name", "2": "phone", "3": "customField:budget" }
  variableMap:  { type: Map, of: String },
  failReason:   { type: String },
  status:       { type: String, enum: ['draft', 'scheduled', 'running', 'completed', 'failed', 'cancelled'], default: 'draft' },
  scheduledAt:  { type: Date },
  startedAt:    { type: Date },
  completedAt:  { type: Date },
  stats: {
    total:     { type: Number, default: 0 },
    sent:      { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read:      { type: Number, default: 0 },
    replied:   { type: Number, default: 0 },
    failed:    { type: Number, default: 0 },
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

campaignSchema.index({ tenantId: 1, status: 1 });
campaignSchema.index({ tenantId: 1, scheduledAt: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
