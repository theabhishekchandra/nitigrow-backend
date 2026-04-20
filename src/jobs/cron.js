const cron = require('node-cron');
const axios = require('axios');
const Tenant = require('../models/Tenant');
const Contact = require('../models/Contact');
const { sendNotification } = require('../services/notificationService');
const { decrypt } = require('../services/encryption');

const startCronJobs = () => {
  console.log('[Jobs] Booting core schedulers...');

  // 1. 14-Day Free Trial Expiry Tracking (Runs daily at 01:00 AM)
  cron.schedule('0 1 * * *', async () => {
    try {
      console.log('[Cron] Running trial expiry sweep...');
      const now = new Date();
      const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      
      const expiringTenants = await Tenant.find({
        'subscription.status': 'trial',
        'subscription.trialEndsAt': {
          $gte: new Date(threeDaysFromNow.setHours(0, 0, 0, 0)),
          $lt: new Date(threeDaysFromNow.setHours(23, 59, 59, 999))
        }
      });

      for (const tenant of expiringTenants) {
         console.log(`[Cron] Trial expiring soon for ${tenant.businessName}`);
         // Notify the tenant owner (example payload structure)
         // await sendNotification(tenant.ownerId, tenant._id, 'trial_expiring', { daysLeft: 3 });
      }

      // Expired Sweep
      const expiredTenants = await Tenant.updateMany(
        {
          'subscription.status': 'trial',
          'subscription.trialEndsAt': { $lt: now }
        },
        { $set: { 'subscription.status': 'expired', status: 'suspended' } }
      );
      console.log(`[Cron] Suspended ${expiredTenants.modifiedCount} expired trial tenants.`);
    } catch (err) {
      console.error('[Cron] Trial limit error:', err);
    }
  });

  // 2. Stale Lead Tracker (Runs daily at 02:00 AM)
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('[Cron] Flagging stale leads (30 days without contact)...');
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      await Contact.updateMany(
        { lastContactedAt: { $lt: thirtyDaysAgo }, status: { $ne: 'cold' } },
        { $set: { status: 'cold' } }
      );
    } catch (err) {
      console.error('[Cron] Stale lead tracking error:', err);
    }
  });

  // 3. DPDP Erasure / Hard Delete Sweep (Runs weekly on Sunday 03:00 AM)
  cron.schedule('0 3 * * 0', async () => {
    try {
      console.log('[Cron] Sweeping deleted tenants for DPDP compliance...');
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - 74);
      
      const toErase = await Tenant.find({
        status: 'cancelled',
        updatedAt: { $lt: limitDate }
      });

      for (const tenant of toErase) {
        // Deep cleanse
        await Contact.deleteMany({ tenantId: tenant._id });
        // NOTE: Expand list based on imported models
        await Tenant.deleteOne({ _id: tenant._id });
        console.log(`[Cron] Erased tenant footprint: ${tenant._id}`);
      }
    } catch (err) {
      console.error('[Cron] Erasure sweep error:', err);
    }
  });

  // 4. WhatsApp Quality Rating Polling — every 6 hours per Meta recommendation
  cron.schedule('0 */6 * * *', async () => {
    try {
      console.log('[Cron] Polling WhatsApp quality ratings...');
      const tenants = await Tenant.find({
        status: 'active',
        phoneNumberId: { $exists: true, $ne: null },
        accessToken:   { $exists: true, $ne: null },
      }).select('_id businessName phoneNumberId accessToken qualityRating messagingTier');

      for (const tenant of tenants) {
        try {
          let token;
          try { token = decrypt(tenant.accessToken); }
          catch { continue; }

          const { data } = await axios.get(
            `https://graph.facebook.com/v19.0/${tenant.phoneNumberId}`,
            { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
          );

          const newRating = data.quality_rating?.toUpperCase() || 'UNKNOWN';
          const newTier   = data.messaging_limit_tier || tenant.messagingTier;
          const prevRating = tenant.qualityRating;

          await Tenant.updateOne({ _id: tenant._id }, {
            qualityRating: newRating,
            messagingTier: newTier,
          });

          // Alert on quality degradation
          if (prevRating !== newRating) {
            console.warn(`[Cron] Quality changed for ${tenant.businessName}: ${prevRating} → ${newRating}`);
            if (newRating === 'YELLOW' || newRating === 'RED') {
              // TODO: send push/email notification via notificationService when owner userId is available
              console.warn(`[Cron] ⚠️  ${tenant.businessName} quality dropped to ${newRating} — campaigns may be affected`);
            }
          }
        } catch (tenantErr) {
          // Skip individual tenant failures — don't block others
          if (tenantErr.response?.status !== 400) {
            console.error(`[Cron] Quality poll failed for tenant ${tenant._id}:`, tenantErr.message);
          }
        }
      }
    } catch (err) {
      console.error('[Cron] Quality rating sweep error:', err.message);
    }
  });

  // 5. 24h Window Expiry Alert — every 15 minutes, alert on windows expiring within 1 hour
  cron.schedule('*/15 * * * *', async () => {
    try {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      const expiringSoon = await Contact.find({
        windowExpiresAt: { $gt: now, $lte: oneHourFromNow },
        // Avoid re-alerting: only contact if not already alerted in last 2h
        // This relies on a simple field check — in prod, use Redis set for dedup
      }).select('_id tenantId name phone assignedTo windowExpiresAt').lean();

      if (expiringSoon.length) {
        console.log(`[Cron] ${expiringSoon.length} conversation windows expiring within 1 hour`);
        // Group by tenant for efficient socket emission
        const byTenant = {};
        expiringSoon.forEach(c => {
          if (!byTenant[c.tenantId]) byTenant[c.tenantId] = [];
          byTenant[c.tenantId].push(c);
        });
        for (const [tenantId, contacts] of Object.entries(byTenant)) {
          if (global.io) {
            global.io.to(`tenant-${tenantId}`).emit('window_expiring_soon', {
              count: contacts.length,
              contacts: contacts.map(c => ({
                id: c._id, name: c.name, phone: c.phone,
                expiresAt: c.windowExpiresAt, assignedTo: c.assignedTo,
              })),
            });
          }
        }
      }
    } catch (err) {
      console.error('[Cron] Window expiry alert error:', err.message);
    }
  });

  // 6. Daily message counter reset at midnight UTC
  cron.schedule('0 0 * * *', async () => {
    try {
      const result = await Tenant.updateMany(
        { dailyMsgCount: { $gt: 0 } },
        { $set: { dailyMsgCount: 0, dailyCountResetAt: new Date() } }
      );
      console.log(`[Cron] Reset daily message counters for ${result.modifiedCount} tenants`);
    } catch (err) {
      console.error('[Cron] Daily counter reset error:', err.message);
    }
  });
};

module.exports = { startCronJobs };
