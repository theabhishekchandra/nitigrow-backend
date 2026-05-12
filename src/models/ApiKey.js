const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },

    // SHA-256 hash of the raw key — never store plaintext. Plaintext is
    // returned to the caller exactly once at creation time.
    keyHash: { type: String, required: true },
    // First ~12 chars of the raw key (`niti_sdk_live_abcd...`) so the UI
    // can show a recognisable preview without exposing the secret.
    keyPreview: { type: String },

    // `server` keys go in backend-to-backend requests with full permissions.
    // `sdk` keys are embedded in customer-facing HTML, so they have a
    // narrow surface (chat session start/message only) and require an
    // origin allow-list.
    scope: { type: String, enum: ['server', 'sdk'], default: 'server', index: true },
    keyType: { type: String, enum: ['live', 'test'], default: 'live' },

    // SDK keys only: list of origins (without scheme) that may use this key.
    // Wildcard one level of subdomain: `*.example.com` matches
    // `foo.example.com` but not `bar.foo.example.com`. Empty array means
    // "no domains allowed" — explicit opt-in.
    allowedDomains: { type: [String], default: [] },

    // SDK keys: per-key rate limit, requests per minute. Server keys
    // currently ignore this (handled by global limiters).
    rateLimit: { type: Number, default: 100 },

    lastUsedAt: { type: Date },
    usageCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

apiKeySchema.index({ tenantId: 1 });
apiKeySchema.index({ keyHash: 1 }, { unique: true });

// `generateKey({ scope, keyType })` — produces a prefixed raw key, its
// hash, and a UI-friendly preview. Format:
//   niti_<scope>_<keyType>_<48 hex chars>     for sdk
//   niti_<48 hex chars>                       for server (backward compat)
apiKeySchema.statics.generateKey = function ({ scope = 'server', keyType = 'live' } = {}) {
  const tail = crypto.randomBytes(24).toString('hex');
  const raw = scope === 'sdk' ? `niti_sdk_${keyType}_${tail}` : `niti_${tail}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  // Preview keeps the scope/type visible (so the UI can label sdk vs
  // server) plus a short ID-ish tail so the user can tell two keys apart.
  const preview =
    scope === 'sdk' ? `niti_sdk_${keyType}_${tail.slice(0, 4)}...` : `${raw.slice(0, 10)}...`;
  return { raw, hash, preview };
};

// Domain matcher honouring our one-level wildcard rule. Hostnames are
// compared case-insensitively. `requestHost` is just the hostname (no
// scheme, no port, no path).
apiKeySchema.statics.matchesDomain = function (requestHost, allowed) {
  if (!requestHost) return false;
  const host = requestHost.toLowerCase();
  return allowed.some((entry) => {
    const e = String(entry).toLowerCase().trim();
    if (!e) return false;
    if (e === host) return true;
    if (e.startsWith('*.')) {
      const suffix = e.slice(2);
      // *.example.com matches one and only one subdomain segment.
      if (!host.endsWith('.' + suffix)) return false;
      const sub = host.slice(0, -1 * (suffix.length + 1));
      return sub.length > 0 && !sub.includes('.');
    }
    return false;
  });
};

module.exports = mongoose.model('ApiKey', apiKeySchema);
