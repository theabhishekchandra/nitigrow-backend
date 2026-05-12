const ContactSubmission = require('../models/ContactSubmission');

// Cheap email validator — RFC compliance handled by Mongoose lowercase + trim;
// this rejects only the obviously-broken cases without an external lib.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-IP throttle: 3 submissions per 10 min. Stored in memory; resets on restart.
const RATE_BUCKET = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 3;
const checkRate = (ip) => {
  const now = Date.now();
  const list = (RATE_BUCKET.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) return false;
  list.push(now);
  RATE_BUCKET.set(ip, list);
  return true;
};

// Best-effort email/Slack notification. Each channel is a no-op if its env
// var isn't set — the submission still lands in Mongo for admin triage.
const sendNotification = async (doc) => {
  const lines = [
    `New ${doc.topic} from ${doc.name}`,
    doc.businessName && `Business: ${doc.businessName}`,
    `Email: ${doc.email}`,
    doc.phone && `Phone: ${doc.phone}`,
    '',
    doc.message || '(no message)',
  ]
    .filter(Boolean)
    .join('\n');

  if (process.env.SLACK_LEADS_WEBHOOK) {
    const axios = require('axios');
    await axios.post(process.env.SLACK_LEADS_WEBHOOK, { text: lines }).catch(() => {});
  }

  if (process.env.RESEND_API_KEY && process.env.LEADS_NOTIFY_EMAIL) {
    const axios = require('axios');
    await axios
      .post(
        'https://api.resend.com/emails',
        {
          from: 'NitiGrow <leads@nitigrow.in>',
          to: process.env.LEADS_NOTIFY_EMAIL,
          subject: `[Lead] ${doc.topic} · ${doc.businessName || doc.name}`,
          text: lines,
        },
        {
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        },
      )
      .catch(() => {});
  }
};

// POST /api/contact — public marketing form
const submitContact = async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || '';
    if (ip && !checkRate(ip)) {
      return res
        .status(429)
        .json({ error: 'Too many submissions. Please try again in a few minutes.' });
    }

    const { name, email, phone, businessName, topic, message } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Please provide your name.' });
    }
    if (!email || !EMAIL_RE.test(String(email))) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    if ((message || '').length > 4000) {
      return res.status(400).json({ error: 'Message is too long.' });
    }

    const doc = await ContactSubmission.create({
      name: String(name).slice(0, 120),
      email: String(email).slice(0, 200),
      phone: phone ? String(phone).slice(0, 30) : undefined,
      businessName: businessName ? String(businessName).slice(0, 200) : undefined,
      topic: topic || 'other',
      message: message ? String(message).slice(0, 4000) : undefined,
      source: 'landing',
      ua: (req.headers['user-agent'] || '').slice(0, 500),
      ip: String(ip).slice(0, 60),
    });

    sendNotification(doc).catch((err) =>
      console.error('[Contact] notification failed:', err.message),
    );

    res.status(201).json({
      ok: true,
      id: doc._id,
      message: "Thanks! We've got your note and will reply within an hour during business hours.",
    });
  } catch (err) {
    console.error('[Contact] submit error:', err.message);
    res.status(500).json({ error: 'Could not submit. Please WhatsApp or email us instead.' });
  }
};

// GET /api/admin/contact-submissions — admin list
const listSubmissions = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const skip = parseInt(req.query.skip, 10) || 0;
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.topic) q.topic = req.query.topic;

    const [data, total] = await Promise.all([
      ContactSubmission.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ContactSubmission.countDocuments(q),
    ]);
    res.json({ data, total, limit, skip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/admin/contact-submissions/:id
const updateSubmission = async (req, res) => {
  try {
    const { status, notes } = req.body || {};
    const update = {};
    if (status) update.status = status;
    if (notes !== undefined) update.notes = notes;
    const doc = await ContactSubmission.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { submitContact, listSubmissions, updateSubmission };
