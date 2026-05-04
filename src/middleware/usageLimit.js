const Tenant = require('../models/Tenant');

/**
 * requireLimit(resource)
 * Express middleware factory. Blocks the request if the tenant has exceeded
 * their monthly quota for the given resource.
 *
 * Usage:
 *   router.post('/reply-suggestions/:id', requireLimit('ai'), handler)
 *   router.post('/send',                  requireLimit('messages'), handler)
 *
 * @param {'messages'|'ai'|'contacts'} resource
 */
const requireLimit = (resource) => async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Not authorized' });

    // Load tenant — attach to req so downstream handlers can reuse it
    const tenant = await Tenant.findById(tenantId).lean(false);
    if (!tenant) return res.status(401).json({ error: 'Tenant not found' });

    // Check account-level suspension first
    if (tenant.status === 'suspended') {
      return res.status(403).json({
        error: 'account_suspended',
        message: 'Your account is suspended. Please update your payment to restore access.'
      });
    }

    // Check trial expiry
    if (tenant.subscription?.status === 'trial') {
      const trialEnd = new Date(tenant.subscription.trialEndsAt);
      if (trialEnd < new Date()) {
        return res.status(403).json({
          error: 'trial_expired',
          message: 'Your 14-day free trial has ended. Upgrade to continue.'
        });
      }
    }

    // Check monthly resource limit
    const { allowed, used, limit, pct, unlimited } = tenant.checkUsage(resource);

    if (!allowed) {
      console.warn(`[UsageLimit] Tenant ${tenantId} hit ${resource} limit: ${used}/${limit}`);
      return res.status(403).json({
        error: 'limit_reached',
        resource,
        used,
        limit,
        message: `You have used all ${limit} ${resource} operations this month. Upgrade your plan to continue.`
      });
    }

    // Warn at 80% usage (attach header for frontend to pick up)
    if (!unlimited && pct >= 80) {
      res.setHeader('X-Usage-Warning', JSON.stringify({ resource, used, limit, pct }));
    }

    // Attach tenant to request for downstream use (avoids second DB fetch)
    req.tenant = tenant;
    next();
  } catch (err) {
    console.error('[UsageLimit] Middleware error:', err.message);
    // Fail open in dev — fail closed in production
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Usage check failed' });
    }
    next();
  }
};

/**
 * trackUsage(resource)
 * Call AFTER a successful action to atomically increment the tenant's counter.
 * Designed to be called in controllers, not as middleware (to avoid premature counting).
 *
 * @param {Object} tenant     - The Mongoose Tenant document (from req.tenant)
 * @param {'messages'|'ai'|'contacts'} resource
 * @param {number} count
 */
const trackUsage = async (tenant, resource, count = 1) => {
  try {
    await tenant.incrementUsage(resource, count);
  } catch (err) {
    // Non-fatal — log and move on (don't fail the user's request over this)
    console.error(`[UsageLimit] Failed to track ${resource} usage for tenant ${tenant._id}:`, err.message);
  }
};

module.exports = { requireLimit, trackUsage };
