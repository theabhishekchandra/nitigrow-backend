const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  status: { type: String, enum: ['requested', 'submitted'], default: 'requested' },
}, { timestamps: true });

module.exports = mongoose.model('Review', reviewSchema);
