const mongoose = require('mongoose');

// Public marketing-site contact form submissions. Separate from User / Admin
// so privacy/retention rules can be applied independently.
const contactSubmissionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 30 },
    businessName: { type: String, trim: true, maxlength: 200 },
    topic: {
      type: String,
      enum: [
        'trial',
        'demo',
        'pricing',
        'migration',
        'enterprise',
        'partnership',
        'support',
        'other',
      ],
      default: 'other',
    },
    message: { type: String, trim: true, maxlength: 4000 },
    source: { type: String, default: 'landing' }, // landing / app / admin / api
    ua: { type: String, maxlength: 500 },
    ip: { type: String, maxlength: 60 },
    status: { type: String, enum: ['new', 'replied', 'closed'], default: 'new' },
    notes: { type: String, maxlength: 4000 },
  },
  { timestamps: true },
);

contactSubmissionSchema.index({ createdAt: -1 });
contactSubmissionSchema.index({ email: 1, createdAt: -1 });
contactSubmissionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ContactSubmission', contactSubmissionSchema);
