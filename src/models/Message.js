const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  contactId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  direction:  { type: String, enum: ['inbound', 'outbound'], required: true },
  type:       { type: String, enum: ['text', 'image', 'video', 'audio', 'document', 'location', 'template', 'interactive', 'sticker'], default: 'text' },
  content:    { type: mongoose.Schema.Types.Mixed },
  mediaUrl:   { type: String },
  mediaId:    { type: String },
  templateName: { type: String },
  status:     { type: String, enum: ['queued', 'sent', 'delivered', 'read', 'failed'], default: 'queued' },
  waMessageId: { type: String },
  failReason: { type: String },
  sentBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sentiment:  { type: String, enum: ['positive', 'neutral', 'frustrated', 'angry'] },
}, { timestamps: true });

messageSchema.index({ tenantId: 1, contactId: 1, createdAt: -1 });
messageSchema.index({ waMessageId: 1 });

module.exports = mongoose.model('Message', messageSchema);
