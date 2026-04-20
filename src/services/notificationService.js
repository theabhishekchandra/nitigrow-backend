const Notification = require('../models/Notification');
const User = require('../models/User');

// ─── Event metadata registry ──────────────────────────────────────────────────
// Maps event names → human-readable defaults. Callers can override title/message.
const EVENT_META = {
  new_message:          { title: 'New Message',             icon: '💬', route: '/inbox' },
  campaign_completed:   { title: 'Campaign Completed',     icon: '📣', route: '/campaigns' },
  template_approved:    { title: 'Template Approved',      icon: '✅', route: '/templates' },
  template_rejected:    { title: 'Template Rejected',      icon: '❌', route: '/templates' },
  trial_expiring:       { title: 'Trial Expiring Soon',    icon: '⏰', route: '/billing' },
  usage_80:             { title: 'Usage Warning',           icon: '⚠️', route: '/billing' },
  usage_limit:          { title: 'Limit Reached',           icon: '🚫', route: '/billing' },
  payment_received:     { title: 'Payment Received',       icon: '💰', route: '/billing' },
  quality_dropped:      { title: 'Quality Rating Dropped', icon: '🔴', route: '/settings' },
  window_expiring:      { title: 'Chat Window Expiring',   icon: '🟡', route: '/inbox' },
  agent_assigned:       { title: 'Chat Assigned',          icon: '👤', route: '/inbox' },
  team_invite:          { title: 'Team Invitation',        icon: '🤝', route: '/team' },
  system_alert:         { title: 'System Alert',           icon: '🔔', route: '/settings' },
};

/**
 * Dispatch a notification to appropriate channels based on user preferences.
 *
 * @param {string} userId       Target user _id
 * @param {string} tenantId     Tenant _id for data isolation
 * @param {string} event        Event key (e.g. 'campaign_completed')
 * @param {Object} data         Payload for rendering — { title?, message?, ...extra }
 * @param {Array<string>|null} requestedChannels  Override default channels
 * @returns {Object|null}       Created Notification document
 */
const sendNotification = async (userId, tenantId, event, data = {}, requestedChannels = null) => {
  try {
    // Merge event metadata with caller-provided data
    const meta = EVENT_META[event] || { title: 'Notification', icon: '🔔', route: '/' };
    const enrichedData = {
      title: data.title || meta.title,
      message: data.message || '',
      icon: data.icon || meta.icon,
      route: data.route || meta.route,
      ...data,
    };

    // Determine active channels from user preferences or defaults
    const user = await User.findById(userId).select('notificationPreferences').lean();
    const defaultChannels = ['in-app'];
    const activeChannels = requestedChannels || (user?.notificationPreferences?.[event] || defaultChannels);

    // Create the persistent notification record
    const notification = await Notification.create({
      userId,
      tenantId,
      event,
      data: enrichedData,
      channels: activeChannels,
    });

    // ─── In-App: real-time via Socket.io ────────────────────────────────────
    if (activeChannels.includes('in-app') && global.io) {
      // Emit to the tenant room — all connected users in this tenant
      global.io.to(`tenant-${tenantId}`).emit('notification', {
        _id: notification._id,
        userId,
        event,
        data: enrichedData,
        readAt: null,
        createdAt: notification.createdAt,
      });
    }

    // ─── Email channel (stub — wire real transporter later) ─────────────────
    if (activeChannels.includes('email')) {
      // TODO: Connect real email transporter (nodemailer / SES)
      // await sendEmailTemplate(user.email, event, enrichedData);
      console.info(`[NotificationService] Email dispatch queued for user=${userId} event=${event}`);
    }

    // ─── WhatsApp channel (stub) ────────────────────────────────────────────
    if (activeChannels.includes('whatsapp')) {
      // TODO: Send WhatsApp notification to agent's own phone number
      console.info(`[NotificationService] WhatsApp dispatch queued for user=${userId} event=${event}`);
    }

    // ─── Mobile push (stub — FCM / APNs) ────────────────────────────────────
    if (activeChannels.includes('mobile')) {
      // TODO: Connect Firebase Cloud Messaging for push notifications
      console.info(`[NotificationService] Mobile push queued for user=${userId} event=${event}`);
    }

    return notification;
  } catch (error) {
    console.error('[NotificationService] Error:', error.message);
    return null;
  }
};

/**
 * Broadcast a notification to ALL users of a tenant (e.g. system alerts).
 */
const broadcastToTenant = async (tenantId, event, data = {}, requestedChannels = null) => {
  try {
    const users = await User.find({ tenantId, isActive: true }).select('_id').lean();
    const results = await Promise.allSettled(
      users.map(u => sendNotification(u._id, tenantId, event, data, requestedChannels))
    );
    const sent = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.info(`[NotificationService] Broadcast ${event} → ${sent}/${users.length} users in tenant=${tenantId}`);
    return sent;
  } catch (error) {
    console.error('[NotificationService] Broadcast error:', error.message);
    return 0;
  }
};

module.exports = {
  sendNotification,
  broadcastToTenant,
  EVENT_META,
};
