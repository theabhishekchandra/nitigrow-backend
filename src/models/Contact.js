const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String },
    phone: { type: String, required: true },
    email: { type: String },
    tags: [{ type: String }],
    status: { type: String, enum: ['hot', 'warm', 'cold', 'customer'], default: 'warm' },
    conversationStatus: { type: String, enum: ['open', 'snoozed', 'resolved'], default: 'open' },
    customFields: { type: Map, of: String },
    optedIn: { type: Boolean, default: false },
    optInSource: { type: String },
    optInDate: { type: Date },
    optedOut: { type: Boolean, default: false },
    optOutDate: { type: Date },

    // `sdk_widget` is used for anonymous website-chat visitors landing through
    // our embeddable JavaScript SDK. Their `phone` is a synthetic `sdk:<token>`
    // identifier (since they may not have given one), and replies to them
    // travel back over a Socket.io room rather than the WhatsApp Cloud API.
    channel: {
      type: String,
      enum: ['whatsapp', 'instagram', 'email', 'sdk_widget'],
      default: 'whatsapp',
    },

    // WhatsApp 24h messaging window tracking
    windowExpiresAt: { type: Date },
    windowType: {
      type: String,
      enum: ['customer_initiated', 'business_initiated', 'template'],
      default: 'template',
    },

    // BSUID — Business-Subscriber Unique ID (mandatory from June 2026, India DPDP Act)
    bsuid: { type: String },

    lastContactedAt: { type: Date },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
    blocked: { type: Boolean, default: false },

    // Chatbot Flow persistence
    activeFlowId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatbotFlow' },
    activeNodeId: { type: String },
  },
  { timestamps: true },
);

contactSchema.virtual('isWindowOpen').get(function () {
  return this.windowExpiresAt && this.windowExpiresAt > new Date();
});

contactSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
contactSchema.index({ tenantId: 1, tags: 1 });
contactSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('Contact', contactSchema);
