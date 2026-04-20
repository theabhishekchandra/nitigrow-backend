require('dotenv').config();
const { Worker } = require('bullmq');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const { connection: bullConnection } = require('./services/queue');
const { processWebhookPayload } = require('./controllers/webhookController');
const { processCampaignJob } = require('./controllers/campaignController');

// Define worker startup function
const startWorkers = () => {
  console.log('[Workers] Starting standalone worker process...');

  // Campaign worker — sends WhatsApp messages for campaigns
  const campaignWorker = new Worker('campaigns', processCampaignJob, {
    connection: bullConnection,
    concurrency: 2, // max 2 campaigns sending simultaneously
    limiter: { max: 100, duration: 1000 }, // 100 jobs/second max
  });

  campaignWorker.on('completed', (job) =>
    console.log(`[Worker] Campaign job ${job.id} completed`)
  );
  campaignWorker.on('failed', (job, err) =>
    console.error(`[Worker] Campaign job ${job?.id} failed:`, err.message)
  );

  // Webhook worker — processes incoming WhatsApp events
  const webhookWorker = new Worker('webhooks', async (job) => {
    await processWebhookPayload(job.data);
  }, {
    connection: bullConnection,
    concurrency: 10, // webhooks are fast, high concurrency
  });

  webhookWorker.on('failed', (job, err) =>
    console.error(`[Worker] Webhook job ${job?.id} failed:`, err.message)
  );

  console.log('[Workers] Campaign + Webhook workers successfully started.');
  return { campaignWorker, webhookWorker };
};

// Bootstrap function for running worker in its own process cluster
const bootWorker = async () => {
  try {
    await connectDB();
    await connectRedis();
    startWorkers();
  } catch (err) {
    console.error('[Worker Boot Error]:', err);
    process.exit(1);
  }
};

// Run if this file is executed directly (e.g. `node src/worker.js`)
if (require.main === module) {
  bootWorker();
}

module.exports = { startWorkers, bootWorker };
