const mongoose = require('mongoose');

// Per-admin IP allowlist entries. When an admin has ZERO entries the allowlist
// is treated as open (bypass). When they have ≥1 entry, every incoming request
// must match at least one CIDR — enforced by middleware/ipAllowlist.js.
const adminAllowlistSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    cidr: { type: String, required: true, trim: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    addedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

module.exports = mongoose.model('AdminAllowlist', adminAllowlistSchema);
