const { Queue, Worker, QueueEvents } = require('bullmq');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// BullMQ requires ioredis-style connection object, not a URL string directly
const parseRedisUrl = (url) => {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: parseInt(u.port) || 6379,
      password: u.password || undefined,
      db: parseInt(u.pathname?.slice(1)) || 0,
      lazyConnect: true,
    };
  } catch {
    return { host: 'localhost', port: 6379, lazyConnect: true };
  }
};

const connection = {
  ...parseRedisUrl(REDIS_URL),
  maxRetriesPerRequest: null,    // required by BullMQ
  enableOfflineQueue: false,     // don't queue commands when disconnected
  retryStrategy: (times) => {
    if (times > 3) return null;  // stop reconnecting after 3 attempts
    return Math.min(times * 500, 3000);
  },
};

// Queue definitions — lazy connect, won't crash if Redis unavailable
let campaignQueue, webhookQueue, notifQueue, campaignQueueEvents;
try {
  campaignQueue = new Queue('campaigns', { connection });
  webhookQueue  = new Queue('webhooks', { connection });
  notifQueue    = new Queue('notifications', { connection });
  campaignQueueEvents = new QueueEvents('campaigns', { connection });
} catch (err) {
  console.warn('⚠️  BullMQ queue init failed — campaign queuing disabled');
  campaignQueue = webhookQueue = notifQueue = campaignQueueEvents = null;
}

// Job types for campaign queue
const CAMPAIGN_JOB = 'send_campaign';
const WEBHOOK_JOB  = 'process_webhook';

/**
 * Add a campaign send job to queue
 * Returns the BullMQ job object
 */
const enqueueCampaign = (campaignId, tenantId, opts = {}) =>
  campaignQueue.add(CAMPAIGN_JOB, { campaignId, tenantId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    ...opts,
  });

/**
 * Add a scheduled campaign — delayed until scheduledAt
 */
const enqueueScheduledCampaign = (campaignId, tenantId, scheduledAt) => {
  const delay = Math.max(0, new Date(scheduledAt).getTime() - Date.now());
  return campaignQueue.add(CAMPAIGN_JOB, { campaignId, tenantId }, {
    delay,
    attempts: 2,
    backoff: { type: 'fixed', delay: 10000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
  });
};

/**
 * Add a webhook payload to queue for async processing
 */
const enqueueWebhook = (payload) =>
  webhookQueue.add(WEBHOOK_JOB, payload, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  });

/**
 * Send a notification job (in-app or push)
 */
const enqueueNotification = (tenantId, userId, data) =>
  notifQueue.add('send_notification', { tenantId, userId, ...data }, {
    attempts: 3,
    removeOnComplete: { count: 500 },
  });

/**
 * Get queue health stats
 */
const getQueueStats = async () => {
  const [cWaiting, cActive, cCompleted, cFailed, wWaiting, wActive, wFailed] = await Promise.all([
    campaignQueue.getWaitingCount(),
    campaignQueue.getActiveCount(),
    campaignQueue.getCompletedCount(),
    campaignQueue.getFailedCount(),
    webhookQueue.getWaitingCount(),
    webhookQueue.getActiveCount(),
    webhookQueue.getFailedCount(),
  ]);
  return {
    campaigns: { waiting: cWaiting, active: cActive, completed: cCompleted, failed: cFailed },
    webhooks:  { waiting: wWaiting, active: wActive, failed: wFailed },
  };
};

module.exports = {
  campaignQueue, webhookQueue, notifQueue, campaignQueueEvents,
  enqueueCampaign, enqueueScheduledCampaign, enqueueWebhook, enqueueNotification,
  getQueueStats, connection,
  CAMPAIGN_JOB, WEBHOOK_JOB,
};
