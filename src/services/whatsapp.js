const axios = require('axios');
const CircuitBreaker = require('opossum');
const Tenant = require('../models/Tenant');
const Contact = require('../models/Contact');
const Message = require('../models/Message');
const { decrypt } = require('./encryption');
const { parseWhatsAppError, isOptOutError, isInvalidContactError } = require('../utils/whatsappErrors');

// ─── Dev/Mock Mode ────────────────────────────────────────────────────────────
// Set USE_MOCK=true in .env to bypass all Meta API calls.
// The UI works fully with simulated message IDs.
// Switch to USE_MOCK=false (or remove it) when real WhatsApp credentials are ready.
const USE_MOCK = process.env.USE_MOCK === 'true';

const mockSendMessage = (to, type = 'text') => {
  const id = `mock_wamid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.info(`[WhatsApp MOCK] Simulated ${type} message → ${to} | ID: ${id}`);
  // TODO: Replace with real Meta API call once WHATSAPP_API_URL and tenant tokens are configured
  return {
    messaging_product: 'whatsapp',
    contacts: [{ input: to, wa_id: to.replace('+', '') }],
    messages: [{ id }],
  };
};

const BASE_URL = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v19.0';

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
// Opens after 5 failures in 10s, stays open 30s before half-open probe
const metaCircuitBreaker = new CircuitBreaker(
  async (fn) => fn(),
  { timeout: 10000, errorThresholdPercentage: 50, resetTimeout: 30000, volumeThreshold: 5, name: 'meta-whatsapp' }
);

metaCircuitBreaker.on('open',     () => console.warn('[CB] Meta API circuit OPEN — calls blocked for 30s'));
metaCircuitBreaker.on('halfOpen', () => console.info('[CB] Meta API circuit HALF-OPEN — probing'));
metaCircuitBreaker.on('close',    () => console.info('[CB] Meta API circuit CLOSED — normal operation'));

// ─── Token helper ─────────────────────────────────────────────────────────────
const getToken = (tenant) => {
  if (!tenant.accessToken) throw new Error('WhatsApp not connected');
  try { return decrypt(tenant.accessToken); }
  catch { throw new Error('Access token decryption failed — reconnect WhatsApp'); }
};

const getClient = (accessToken) => axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  timeout: 10000,
});

// ─── Core send function ───────────────────────────────────────────────────────
const sendMessage = async (tenantId, to, payload) => {
  // TODO: Remove mock guard once real WhatsApp Business API is connected
  if (USE_MOCK) return mockSendMessage(to, payload.type);

  const tenant = await Tenant.findById(tenantId);
  if (!tenant?.phoneNumberId) throw new Error('WhatsApp not connected for this account');

  const token = getToken(tenant);
  const client = getClient(token);
  const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload };

  try {
    const response = await metaCircuitBreaker.fire(() =>
      client.post(`/${tenant.phoneNumberId}/messages`, body)
    );
    return response.data;
  } catch (err) {
    if (err.message === 'Breaker is open') {
      throw new Error('WhatsApp API temporarily unavailable — please retry in 30 seconds');
    }
    const parsed = parseWhatsAppError(err);

    if (isOptOutError(parsed.code)) {
      await Contact.findOneAndUpdate({ tenantId, phone: to }, { optedIn: false, optedOut: true, optOutDate: new Date() });
    }
    if (isInvalidContactError(parsed.code)) {
      await Contact.findOneAndUpdate({ tenantId, phone: to }, { blocked: true });
    }

    const error = new Error(parsed.msg);
    error.waCode = parsed.code;
    error.retry = parsed.retry;
    throw error;
  }
};

// ─── 24h window check ─────────────────────────────────────────────────────────
const checkAndRefreshWindow = async (tenantId, contactPhone, messageType = 'text') => {
  if (messageType === 'template') return; // Templates bypass window check
  if (USE_MOCK) return; // Skip window check in mock mode

  const contact = await Contact.findOne({ tenantId, phone: contactPhone });
  if (!contact) return;

  if (contact.windowExpiresAt && contact.windowExpiresAt < new Date()) {
    throw new Error('24h messaging window closed for this contact. Send a template to re-open it.');
  }
};

// ─── High-level senders ───────────────────────────────────────────────────────
const sendText = async (tenantId, to, text) => {
  await checkAndRefreshWindow(tenantId, to, 'text');
  return sendMessage(tenantId, to, { type: 'text', text: { body: text, preview_url: false } });
};

const sendImage = async (tenantId, to, imageUrl, caption = '') => {
  await checkAndRefreshWindow(tenantId, to, 'image');
  return sendMessage(tenantId, to, { type: 'image', image: { link: imageUrl, caption } });
};

const sendDocument = async (tenantId, to, docUrl, filename) => {
  await checkAndRefreshWindow(tenantId, to, 'document');
  return sendMessage(tenantId, to, { type: 'document', document: { link: docUrl, filename } });
};

const sendTemplate = (tenantId, to, templateName, languageCode = 'en', components = []) =>
  sendMessage(tenantId, to, {
    type: 'template',
    template: { name: templateName, language: { code: languageCode }, components },
  });

const sendButtons = async (tenantId, to, bodyText, buttons) => {
  await checkAndRefreshWindow(tenantId, to, 'interactive');
  return sendMessage(tenantId, to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((btn, i) => ({
          type: 'reply',
          reply: { id: `btn_${i}`, title: btn },
        })),
      },
    },
  });
};

const sendList = async (tenantId, to, bodyText, buttonLabel, sections) => {
  await checkAndRefreshWindow(tenantId, to, 'interactive');
  return sendMessage(tenantId, to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonLabel, sections },
    },
  });
};

const markAsRead = async (tenantId, messageId) => {
  if (USE_MOCK) return; // TODO: implement when real API connected
  const tenant = await Tenant.findById(tenantId);
  if (!tenant?.phoneNumberId) return;
  const token = getToken(tenant);
  const client = getClient(token);
  await client.post(`/${tenant.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp', status: 'read', message_id: messageId,
  }).catch(() => {}); // best-effort
};

const saveAndEmit = async (tenantId, contactId, type, content, waMessageId, sentBy = null) => {
  const message = await Message.create({
    tenantId, contactId, direction: 'outbound',
    type, content, waMessageId: waMessageId || `mock_${Date.now()}`, status: 'sent', sentBy,
  });
  if (global.io) {
    global.io.to(`tenant-${tenantId}`).emit('message_sent', { contactId, message });
  }
  return message;
};

module.exports = {
  sendText, sendImage, sendDocument, sendTemplate, sendButtons, sendList,
  markAsRead, saveAndEmit, metaCircuitBreaker, USE_MOCK,
};
