const ChatSession = require('../models/ChatSession');
const Contact = require('../models/Contact');
const Message = require('../models/Message');
const Tenant = require('../models/Tenant');

// All endpoints assume requireSdkKey has run upstream, populating
// `req.tenantId` and `req.sdkKey`.

// Per-session visitor-message throttle. Cheap in-memory bucket since
// sessions are short-lived anyway (closed on tab close).
const SEND_BUCKETS = new Map();
const SEND_WINDOW_MS = 60 * 1000;
const SEND_LIMIT = 30;
const checkSendRate = (sessionId) => {
  const now = Date.now();
  const list = (SEND_BUCKETS.get(sessionId) || []).filter((t) => now - t < SEND_WINDOW_MS);
  if (list.length >= SEND_LIMIT) return false;
  list.push(now);
  SEND_BUCKETS.set(sessionId, list);
  return true;
};

// Resolve the ChatSession for a given raw token, scoped to the calling
// tenant for defence in depth (so a leaked token can't be reused across
// tenants by an attacker who also has another tenant's key).
const findSession = async (token, tenantId) => {
  if (!token || typeof token !== 'string') return null;
  const hash = ChatSession.hashToken(token);
  return ChatSession.findOne({ sessionTokenHash: hash, tenantId });
};

// Best-effort Contact lookup/create for a session. Synthetic phone keeps
// the existing Contact unique index happy and lets the inbox treat SDK
// visitors as just-another-channel contacts.
const getOrCreateContact = async ({ tenantId, sessionTokenRaw, visitor }) => {
  // Reuse by email if the visitor gave one — same person filling the form
  // twice on different sessions lands on the same Contact card.
  if (visitor.email) {
    const existing = await Contact.findOne({ tenantId, email: visitor.email.toLowerCase() });
    if (existing) return existing;
  }
  const syntheticPhone = `sdk:${sessionTokenRaw.slice(0, 16)}`;
  return Contact.create({
    tenantId,
    name: visitor.name || 'Website visitor',
    phone: syntheticPhone,
    email: visitor.email ? visitor.email.toLowerCase() : undefined,
    channel: 'sdk_widget',
    status: 'warm',
    optedIn: !!visitor.email,
    optInSource: visitor.email ? 'sdk_widget' : undefined,
  });
};

// POST /api/sdk/chat/start
const startSession = async (req, res) => {
  try {
    const { name, email, phone, pageUrl, referrer } = req.body || {};
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    const tenant = await Tenant.findById(req.tenantId).lean();
    if (!tenant || tenant.status === 'suspended') {
      return res.status(403).json({ error: 'Tenant not available' });
    }

    const { raw, hash, preview } = ChatSession.generateToken();
    const visitor = {
      name: name ? String(name).slice(0, 120) : undefined,
      email: email ? String(email).slice(0, 200).toLowerCase() : undefined,
      phone: phone ? String(phone).slice(0, 30) : undefined,
    };
    const contact = await getOrCreateContact({
      tenantId: req.tenantId,
      sessionTokenRaw: raw,
      visitor,
    });

    const session = await ChatSession.create({
      tenantId: req.tenantId,
      apiKeyId: req.sdkKey._id,
      contactId: contact._id,
      sessionTokenHash: hash,
      sessionTokenPreview: preview,
      visitor,
      pageUrl: pageUrl ? String(pageUrl).slice(0, 500) : undefined,
      referrer: referrer ? String(referrer).slice(0, 500) : undefined,
      ua: (req.headers['user-agent'] || '').slice(0, 500),
      ip: String(req.ip || '').slice(0, 60),
      keyType: req.sdkKey.keyType || 'live',
    });

    res.status(201).json({
      sessionToken: raw,
      sessionId: String(session._id),
      welcome: {
        businessName: tenant.businessName,
        message: 'Hi! How can we help?',
      },
      keyType: session.keyType,
    });
  } catch (err) {
    console.error('[SDK chat] start error:', err.message);
    res.status(500).json({ error: 'Could not start chat session' });
  }
};

// POST /api/sdk/chat/message
const sendMessage = async (req, res) => {
  try {
    const { sessionToken, text } = req.body || {};
    const session = await findSession(sessionToken, req.tenantId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'closed') {
      return res.status(410).json({ error: 'Session is closed' });
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Empty message' });
    }
    if (text.length > 4000) return res.status(400).json({ error: 'Message too long' });
    if (!checkSendRate(String(session._id))) {
      return res.status(429).json({ error: 'Slow down — too many messages' });
    }

    // Sanitize: strip HTML tags so a malicious payload can't XSS the agent
    // inbox when it renders the message. We keep the original whitespace.
    const clean = String(text)
      .replace(/<[^>]*>/g, '')
      .slice(0, 4000);

    const message = await Message.create({
      tenantId: session.tenantId,
      contactId: session.contactId,
      direction: 'inbound',
      type: 'text',
      content: { text: clean },
      status: 'delivered',
    });

    session.messageCount += 1;
    session.lastActivityAt = new Date();
    await session.save();

    // Push to the tenant's inbox room so any agent currently viewing
    // the inbox sees it live. Also push to the SDK session room — the
    // visitor's other tabs are NOT joined, but agents can echo via the
    // same room downstream once M3 wires the agent-side emit.
    if (global.io) {
      global.io.to(`tenant-${session.tenantId}`).emit('new_message', {
        conversationId: String(session.contactId),
        message: {
          _id: message._id,
          tenantId: message.tenantId,
          contactId: message.contactId,
          direction: 'inbound',
          type: 'text',
          content: message.content,
          createdAt: message.createdAt,
          channel: 'sdk_widget',
        },
      });
    }

    res.status(201).json({
      id: String(message._id),
      createdAt: message.createdAt,
    });
  } catch (err) {
    console.error('[SDK chat] message error:', err.message);
    res.status(500).json({ error: 'Could not send message' });
  }
};

// GET /api/sdk/chat/history?sessionToken=…
const getHistory = async (req, res) => {
  try {
    const session = await findSession(req.query.sessionToken, req.tenantId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const messages = await Message.find({
      tenantId: session.tenantId,
      contactId: session.contactId,
    })
      .sort({ createdAt: 1 })
      .limit(50)
      .lean();

    res.json({
      sessionId: String(session._id),
      status: session.status,
      messages: messages.map((m) => ({
        id: String(m._id),
        from: m.direction === 'inbound' ? 'visitor' : 'agent',
        text: m.content?.text || '',
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error('[SDK chat] history error:', err.message);
    res.status(500).json({ error: 'Could not fetch history' });
  }
};

// POST /api/sdk/chat/close
const closeSession = async (req, res) => {
  try {
    const { sessionToken } = req.body || {};
    const session = await findSession(sessionToken, req.tenantId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'closed') {
      session.status = 'closed';
      session.closedAt = new Date();
      await session.save();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[SDK chat] close error:', err.message);
    res.status(500).json({ error: 'Could not close session' });
  }
};

module.exports = { startSession, sendMessage, getHistory, closeSession };
