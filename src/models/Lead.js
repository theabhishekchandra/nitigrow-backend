const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  contactId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  name:       { type: String, required: true },
  phone:      { type: String },
  email:      { type: String },
  channel:    { type: String, enum: ['whatsapp', 'instagram', 'email', 'other'], default: 'whatsapp' },
  stage:      { type: String, enum: ['new', 'warm', 'hot', 'won', 'lost'], default: 'new' },
  value:      { type: Number, default: 0 },
  source:     { type: String, enum: ['inbox', 'import', 'website', 'api', 'other'], default: 'inbox' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  tags:       [{ type: String }],
  notes:      { type: String },
}, { timestamps: true });

leadSchema.index({ tenantId: 1, stage: 1 });
leadSchema.index({ tenantId: 1, assignedTo: 1 });

module.exports = mongoose.model('Lead', leadSchema);
