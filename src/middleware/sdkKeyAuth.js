const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');

// In-process cache keyed by SHA-256 of the raw key. Saves a Mongo
// round-trip on every SDK request — the hottest path in this codebase
// once SDK is live. Bounded at 1000 entries; oldest evicted.
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 1000;
const cache = new Map(); // hash -> { key: ApiKey doc, expires: number }

const cacheGet = (hash) => {
  const hit = cache.get(hash);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(hash);
    return null;
  }
  return hit.key;
};
const cacheSet = (hash, key) => {
  if (cache.size >= CACHE_MAX) {
    // delete the oldest insertion — Map preserves insertion order
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(hash, { key, expires: Date.now() + CACHE_TTL_MS });
};
const cacheInvalidate = (hash) => cache.delete(hash);

const extractKey = (req) =>
  req.headers['x-nitigrow-key'] ||
  req.headers['x-api-key'] ||
  (typeof req.query.key === 'string' ? req.query.key : null);

const extractOriginHost = (req) => {
  const raw = req.headers.origin || req.headers.referer || '';
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
};

// Express middleware: authenticate an SDK request.
// Populates `req.tenantId` and `req.sdkKey` on success.
const requireSdkKey = async (req, res, next) => {
  try {
    const raw = extractKey(req);
    if (!raw) return res.status(401).json({ error: 'API key required' });
    if (typeof raw !== 'string' || raw.length > 200) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    let key = cacheGet(hash);
    if (!key) {
      key = await ApiKey.findOne({ keyHash: hash }).lean();
      if (key) cacheSet(hash, key);
    }

    if (!key || !key.isActive) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }
    if (key.scope !== 'sdk') {
      return res.status(403).json({ error: 'This endpoint requires an SDK-scope key' });
    }

    // Origin enforcement. SDK keys must have at least one allowedDomain;
    // empty list means "not deployed yet, reject all". A wildcard `*` is
    // not supported on purpose — that would defeat the point.
    const host = extractOriginHost(req);
    const allowed = key.allowedDomains || [];
    if (allowed.length === 0) {
      return res.status(403).json({ error: 'No allowed domains configured for this key' });
    }
    if (!host) {
      return res.status(403).json({ error: 'Missing Origin/Referer header' });
    }
    if (!ApiKey.matchesDomain(host, allowed)) {
      return res.status(403).json({ error: 'Origin not allowed for this API key' });
    }

    // Fire-and-forget usage bump. We don't await — the request shouldn't
    // wait on a write that only matters for analytics.
    ApiKey.updateOne(
      { _id: key._id },
      { $set: { lastUsedAt: new Date() }, $inc: { usageCount: 1 } },
    ).catch(() => {});

    req.tenantId = key.tenantId;
    req.sdkKey = key;
    next();
  } catch (err) {
    console.error('[sdkKeyAuth] failure:', err.message);
    res.status(500).json({ error: 'Auth check failed' });
  }
};

module.exports = { requireSdkKey, cacheInvalidate };
