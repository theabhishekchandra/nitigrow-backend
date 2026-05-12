const crypto = require('crypto');
const Contact = require('../models/Contact');
const Message = require('../models/Message');
const Tenant = require('../models/Tenant');
const WebhookReceipt = require('../models/WebhookReceipt');
const { enqueueWebhook } = require('../services/queue');
const { analyzeSentiment } = require('../services/aiService');
const { tryExecuteFlow } = require('../services/flowExecutor');

// Meta webhook verification (GET)
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
};

// HMAC-SHA256 signature verification — prevents spoofed webhooks
const verifySignature = (rawBody, signature) => {
  if (!signature) return false;
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true; // skip in development if not configured
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
};

// Receive webhook — return 200 immediately, process in background queue
const receiveWebhook = (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const rawBody = req.rawBody; // set by express raw body middleware in index.js

  if (!verifySignature(rawBody, signature)) {
    return res.sendStatus(403);
  }

  const body = req.body;
  if (body.object !== 'whatsapp_business_account') return res.sendStatus(404);

  // Respond 200 immediately — Meta requires this within 20s
  res.sendStatus(200);

  // Process asynchronously via queue
  enqueueWebhook(body).catch((err) =>
    console.error('[Webhook] Failed to enqueue payload:', err.message),
  );
};

// Actual processing — called by BullMQ worker
const processWebhookPayload = async (payload) => {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;

      // --- Incoming messages ---
      for (const msg of value.messages || []) {
        // Replay protection — record the messageId in a Mongo-TTL collection.
        // On duplicate-key error we know we've already processed this id
        // within the last 48h, so we skip it. No Redis dependency.
        if (msg.id) {
          try {
            await WebhookReceipt.create({ messageId: msg.id });
          } catch (err) {
            if (err && err.code === 11000) {
              console.log('[Webhook] duplicate messageId — skipping:', msg.id);
              continue;
            }
            console.error('[Webhook] receipt insert failed (continuing):', err.message);
            // Fall through — better to risk a duplicate than drop a real message
            // if the receipts collection is misbehaving.
          }
        }
        await processIncomingMessage(value.metadata, msg).catch((err) =>
          console.error('[Webhook] processIncomingMessage error:', err.message),
        );
      }

      // --- Status updates ---
      for (const status of value.statuses || []) {
        await processStatusUpdate(status).catch((err) =>
          console.error('[Webhook] processStatusUpdate error:', err.message),
        );
      }
    }
  }
};

const processIncomingMessage = async (metadata, msg) => {
  const phoneNumberId = metadata.phone_number_id;
  const tenant = await Tenant.findOne({ phoneNumberId });
  if (!tenant) return;

  const windowExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Upsert contact — update window + BSUID if provided
  const contactUpdate = {
    tenantId: tenant._id,
    phone: msg.from,
    lastContactedAt: new Date(),
    windowExpiresAt,
    windowType: 'customer_initiated',
    optedOut: false, // they messaged us = implicit opt-in signal
  };
  // BSUID from identity field (available when customer has shared it)
  if (msg.identity?.hash) contactUpdate.bsuid = msg.identity.hash;
  if (msg.contacts?.[0]?.profile?.name) contactUpdate.name = msg.contacts[0].profile.name;

  const contact = await Contact.findOneAndUpdate(
    { tenantId: tenant._id, phone: msg.from },
    { $set: contactUpdate },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Extract content based on message type
  let content;
  let mediaUrl = null;
  switch (msg.type) {
    case 'text':
      content = msg.text?.body || '';
      break;
    case 'image':
      content = msg.image?.caption || '';
      mediaUrl = msg.image?.id;
      break;
    case 'audio':
      content = '[Audio message]';
      mediaUrl = msg.audio?.id;
      break;
    case 'video':
      content = msg.video?.caption || '[Video]';
      mediaUrl = msg.video?.id;
      break;
    case 'document':
      content = msg.document?.filename || '[Document]';
      mediaUrl = msg.document?.id;
      break;
    case 'location':
      content = `Location: ${msg.location?.latitude},${msg.location?.longitude}`;
      break;
    case 'button':
      content = msg.button?.text || '';
      break;
    case 'interactive':
      content = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
      break;
    default:
      content = `[${msg.type}]`;
  }

  const savedMessage = await Message.create({
    tenantId: tenant._id,
    contactId: contact._id,
    direction: 'inbound',
    type: msg.type,
    content,
    mediaUrl,
    waMessageId: msg.id,
    status: 'delivered',
    receivedAt: msg.timestamp ? new Date(parseInt(msg.timestamp) * 1000) : new Date(),
  });

  if (global.io) {
    global.io.to(`tenant-${tenant._id}`).emit('new_message', {
      contactId: contact._id,
      contact: { _id: contact._id, name: contact.name, phone: contact.phone },
      message: { type: msg.type, content, waMessageId: msg.id },
    });
  }

  // ─── Chatbot Flow Executor ──────────────────────────────────────────────
  // Runs immediately after message saved — if a flow matches, it auto-replies.
  // Non-blocking — errors are caught internally.
  tryExecuteFlow(tenant._id, contact, content).catch((err) =>
    console.error('[Webhook] Flow executor error:', err.message),
  );

  // ─── Async Sentiment Analysis ─────────────────────────────────────────────
  // Runs AFTER the message is saved and socket is emitted — zero perceived latency
  if (msg.type === 'text' && content) {
    analyzeSentiment(content)
      .then(async (sentiment) => {
        if (!sentiment || sentiment === 'neutral') return; // skip neutral — no alert needed
        await Message.updateOne({ _id: savedMessage._id }, { sentiment });

        // Emit sentiment update so inbox UI can update the conversation row emoji in real-time
        if (global.io) {
          global.io.to(`tenant-${tenant._id}`).emit('sentiment_update', {
            contactId: contact._id,
            messageId: savedMessage._id,
            sentiment,
          });
        }

        // Log for monitoring — frustrated/angry triggers agent notification
        if (['frustrated', 'angry'].includes(sentiment)) {
          console.warn(
            `[Sentiment] 🚨 ${sentiment.toUpperCase()} customer: tenant=${tenant._id} contact=${contact._id}`,
          );
        }
      })
      .catch((err) => console.error('[Sentiment] async error:', err.message));
  }
}; // end processIncomingMessage

const processStatusUpdate = async (status) => {
  const update = {
    status: status.status,
    ...(status.timestamp && {
      [`${status.status}At`]: new Date(parseInt(status.timestamp) * 1000),
    }),
  };

  if (status.errors?.[0]) {
    update.failReason = status.errors[0].message;
    update.failCode = status.errors[0].code;
  }

  const message = await Message.findOneAndUpdate({ waMessageId: status.id }, update, { new: true });

  if (message && global.io) {
    global.io.to(`tenant-${message.tenantId}`).emit('message_status', {
      waMessageId: status.id,
      status: status.status,
    });
  }
};

module.exports = { verifyWebhook, receiveWebhook, processWebhookPayload };
