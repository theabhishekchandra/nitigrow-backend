const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  tenantId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name:      { type: String, required: true },
  category:  { type: String, enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'], required: true },
  language:  { type: String, default: 'en' },
  status:    { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'PAUSED'], default: 'PENDING' },
  components: [{
    type:    { type: String, enum: ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'] },
    format:  { type: String }, // TEXT, IMAGE, VIDEO, DOCUMENT
    text:    { type: String },
    buttons: [{ type: { type: String }, text: String, url: String, phone_number: String }],
    example: { type: mongoose.Schema.Types.Mixed },
  }],
  rejectionReason: { type: String },
  metaTemplateId:  { type: String },
  lastUsedAt:      { type: Date },
}, { timestamps: true });

templateSchema.index({ tenantId: 1, name: 1 });
templateSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('Template', templateSchema);
