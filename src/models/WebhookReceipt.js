const mongoose = require('mongoose');

// Records every webhook messageId we've successfully ingested. The TTL index
// auto-expires receipts 48 hours after `receivedAt`, which is well beyond
// Meta's documented retry window — so a replayed message any time within that
// window will hit the unique-index conflict and be skipped.
const webhookReceiptSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true, unique: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// TTL — Mongo evicts the doc roughly `expireAfterSeconds` after receivedAt.
webhookReceiptSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 48 * 60 * 60 });

module.exports = mongoose.model('WebhookReceipt', webhookReceiptSchema);
