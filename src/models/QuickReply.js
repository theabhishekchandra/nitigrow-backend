const mongoose = require('mongoose');

const quickReplySchema = new mongoose.Schema({
  tenantId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  shortcut:  { type: String, required: true }, // e.g. "/hi", "/pricing"
  title:     { type: String, required: true }, // human readable label
  content:   { type: String, required: true }, // message text to send
  category:  { type: String, enum: ['greeting', 'support', 'sales', 'general'], default: 'general' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

quickReplySchema.index({ tenantId: 1, shortcut: 1 }, { unique: true });
quickReplySchema.index({ tenantId: 1, category: 1 });

module.exports = mongoose.model('QuickReply', quickReplySchema);
