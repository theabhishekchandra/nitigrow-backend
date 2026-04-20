const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const Link = require('../models/Link');
const Review = require('../models/Review');
const Contact = require('../models/Contact');
// In a real integration, we'd use axios to call endpoints like MSG91 or Meta's WA verification endpoint.
// const axios = require('axios');

// --- QR Code Generator ---
const generateQRCode = async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'WhatsApp number is required' });

    const whatsappUrl = `https://wa.me/${phoneNumber.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message || '')}`;
    const qrDataUrl = await QRCode.toDataURL(whatsappUrl);
    
    res.json({ qrCodeUrl: qrDataUrl, link: whatsappUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Link Shortener ---
const shortenLink = async (req, res) => {
  try {
    const { originalUrl, campaignId } = req.body;
    if (!originalUrl) return res.status(400).json({ error: 'Original URL is required' });

    const shortCode = uuidv4().substring(0, 8);
    const link = await Link.create({
      tenantId: req.tenantId,
      campaignId,
      originalUrl,
      shortCode
    });

    const redirectUrl = `https://go.nitigrow.in/${shortCode}`;
    res.status(201).json({ ...link.toJSON(), redirectUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const handleRedirect = async (req, res) => {
  try {
    const { shortCode } = req.params;
    const link = await Link.findOne({ shortCode });
    if (!link) return res.status(404).send('Link not found');

    // Asynchronously log click
    link.totalClicks += 1;
    await link.save();

    res.redirect(link.originalUrl);
  } catch (err) {
    res.status(500).send('An error occurred');
  }
};

// --- Bulk Number Verification ---
const verifyNumbersBulk = async (req, res) => {
  try {
    const { numbers } = req.body; // Array of strings
    if (!numbers || !Array.isArray(numbers)) return res.status(400).json({ error: 'Provide an array of numbers' });

    // Mock representation of an external check (e.g. Meta API Check or TrueCaller routing layer)
    const verified = [];
    const invalid = [];

    numbers.forEach(num => {
      // Dummy logic: typically would await a check API
      if (num.length >= 10) verified.push(num);
      else invalid.push(num);
    });

    res.json({ verified, invalid, totalTested: numbers.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Review Automation ---
const triggerReviewRequest = async (req, res) => {
  try {
    const { contactId } = req.body;
    const contact = await Contact.findOne({ _id: contactId, tenantId: req.tenantId });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // Queue logic or wait logic here. We dispatch immediately for MVP.
    const review = await Review.create({
      tenantId: req.tenantId,
      contactId: contact._id
    });

    res.status(201).json({ message: 'Review request triggered successfully', reviewId: review._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  generateQRCode,
  shortenLink,
  handleRedirect,
  verifyNumbersBulk,
  triggerReviewRequest
};
