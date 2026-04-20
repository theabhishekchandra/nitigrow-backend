const Campaign = require('../models/Campaign');
const Template = require('../models/Template');
const Contact = require('../models/Contact');
const Tenant = require('../models/Tenant');
const { sendTemplate } = require('../services/whatsapp');
const { parseWhatsAppError, isOptOutError } = require('../utils/whatsappErrors');
const { enqueueCampaign, enqueueScheduledCampaign } = require('../services/queue');

const getCampaigns = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = { tenantId: req.tenantId };
    if (status) query.status = status;
    const [campaigns, total] = await Promise.all([
      Campaign.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit)),
      Campaign.countDocuments(query),
    ]);
    res.json({ campaigns, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const createCampaign = async (req, res) => {
  try {
    const { name, templateId, language, audience, components, variableMap, scheduledAt } = req.body;

    const template = await Template.findOne({ _id: templateId, tenantId: req.tenantId });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    if (template.status !== 'APPROVED') return res.status(400).json({ error: 'Template must be APPROVED before use' });

    const campaign = await Campaign.create({
      tenantId: req.tenantId,
      name,
      templateId,
      templateName: template.name,
      language: language || template.language,
      audience: audience || { type: 'all' },
      components: components || [],
      variableMap: variableMap || {},
      scheduledAt: scheduledAt || null,
      status: scheduledAt ? 'scheduled' : 'draft',
      createdBy: req.user._id,
    });

    // If scheduled, enqueue a delayed job immediately
    if (scheduledAt) {
      await enqueueScheduledCampaign(campaign._id.toString(), req.tenantId.toString(), scheduledAt);
    }

    res.status(201).json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const launchCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      return res.status(400).json({ error: `Cannot launch campaign in ${campaign.status} status` });
    }

    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant?.accessToken || !tenant?.phoneNumberId) {
      return res.status(400).json({ error: 'WhatsApp not connected. Go to Settings → Connect WhatsApp first.' });
    }

    // Quick audience count (don't load all contacts yet — worker does that)
    const contactQuery = { tenantId: req.tenantId, optedIn: true, blocked: { $ne: true } };
    if (campaign.audience.type === 'tag' && campaign.audience.tags?.length) {
      contactQuery.tags = { $in: campaign.audience.tags };
    } else if (campaign.audience.type === 'manual' && campaign.audience.contactIds?.length) {
      contactQuery._id = { $in: campaign.audience.contactIds };
    }
    const total = await Contact.countDocuments(contactQuery);
    if (!total) return res.status(400).json({ error: 'No opted-in contacts found for this audience' });

    campaign.status = 'running';
    campaign.startedAt = new Date();
    campaign.stats.total = total;
    await campaign.save();

    // Enqueue to BullMQ — worker handles actual sending
    await enqueueCampaign(campaign._id.toString(), req.tenantId.toString());

    res.json({ message: 'Campaign queued for sending', total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Builds personalized components for a single contact by substituting variableMap fields.
 * variableMap: { "1": "name", "2": "phone", "3": "customField:budget" }
 * If no variableMap, returns the static campaign.components unchanged.
 */
const buildContactComponents = (campaign, contact) => {
  if (!campaign.variableMap || campaign.variableMap.size === 0) return campaign.components;

  // Deep-clone components to avoid mutation across contacts
  const comps = JSON.parse(JSON.stringify(campaign.components || []));

  comps.forEach(comp => {
    if (!Array.isArray(comp.parameters)) return;
    comp.parameters.forEach(param => {
      if (param.type !== 'text' || !param.text) return;
      // Replace {{N}} placeholders using variableMap
      param.text = param.text.replace(/\{\{(\d+)\}\}/g, (_, pos) => {
        const field = campaign.variableMap.get(pos);
        if (!field) return `{{${pos}}}`;
        if (field.startsWith('customField:')) {
          return contact.customFields?.get(field.slice(12)) || '';
        }
        return contact[field] ?? '';
      });
    });
  });

  return comps;
};

/**
 * Campaign worker processor — called by BullMQ worker in index.js
 * Handles pacing, daily limit enforcement, opt-out detection, variable substitution
 */
const processCampaignJob = async (job) => {
  const { campaignId, tenantId } = job.data;

  const campaign = await Campaign.findById(campaignId);
  if (!campaign || campaign.status === 'cancelled') {
    console.log(`[Campaign] Job ${campaignId} skipped — not found or cancelled`);
    return;
  }

  const tenant = await Tenant.findById(tenantId);
  if (!tenant?.accessToken || !tenant?.phoneNumberId) {
    await Campaign.updateOne({ _id: campaignId }, { status: 'failed', failReason: 'WhatsApp not connected' });
    throw new Error('WhatsApp not connected');
  }

  const contactQuery = { tenantId, optedIn: true, blocked: { $ne: true } };
  if (campaign.audience.type === 'tag' && campaign.audience.tags?.length) {
    contactQuery.tags = { $in: campaign.audience.tags };
  } else if (campaign.audience.type === 'manual' && campaign.audience.contactIds?.length) {
    contactQuery._id = { $in: campaign.audience.contactIds };
  }

  // Select all fields needed for variable substitution
  const contacts = await Contact.find(contactQuery).select('phone name email customFields').lean();
  await Campaign.updateOne({ _id: campaignId }, { 'stats.total': contacts.length });

  let sent = 0, failed = 0;
  const BATCH_SIZE = 50;
  const DELAY_MS = 200; // ~5 msg/s — safe under Meta 80/s Tier 1 limit

  for (let i = 0; i < contacts.length; i++) {
    if (i % BATCH_SIZE === 0) {
      const fresh = await Campaign.findById(campaignId).select('status').lean();
      if (fresh?.status === 'cancelled') break;

      // Enforce daily messaging limit before each batch
      await tenant.reload?.();
      const freshTenant = await Tenant.findById(tenantId).select('dailyMsgCount dailyLimit dailyCountResetAt').lean();
      if (freshTenant && !tenant.canSendMessages.call(freshTenant, BATCH_SIZE)) {
        await Campaign.updateOne({ _id: campaignId }, {
          status: 'failed',
          failReason: `Daily message limit reached (${freshTenant.dailyLimit}/day). Resume tomorrow.`,
          'stats.sent': sent, 'stats.failed': failed,
        });
        if (global.io) global.io.to(`tenant-${tenantId}`).emit('campaign_paused', { campaignId, reason: 'daily_limit' });
        console.warn(`[Campaign] "${campaign.name}" paused — daily limit reached`);
        return;
      }

      await Campaign.updateOne({ _id: campaignId }, { 'stats.sent': sent, 'stats.failed': failed });
      await job.updateProgress(Math.round((i / contacts.length) * 100));
    }

    const contact = contacts[i];
    const personalizedComponents = buildContactComponents(campaign, contact);

    try {
      await sendTemplate(tenantId, contact.phone, campaign.templateName, campaign.language, personalizedComponents);
      sent++;
      await Tenant.updateOne({ _id: tenantId }, { $inc: { dailyMsgCount: 1 } });
    } catch (err) {
      failed++;
      if (err.waCode && isOptOutError(err.waCode)) {
        await Contact.updateOne({ tenantId, phone: contact.phone }, { optedIn: false, optedOut: true, optOutDate: new Date() });
      }
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  campaign.stats.sent = sent;
  campaign.stats.failed = failed;
  campaign.status = 'completed';
  campaign.completedAt = new Date();
  await campaign.save();

  if (global.io) {
    global.io.to(`tenant-${tenantId}`).emit('campaign_completed', {
      campaignId: campaign._id,
      stats: campaign.stats,
    });
  }

  console.log(`[Campaign] "${campaign.name}" done — sent: ${sent}, failed: ${failed}`);
};

const cancelCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId, status: { $in: ['draft', 'scheduled', 'running'] } },
      { status: 'cancelled' },
      { new: true }
    );
    if (!campaign) return res.status(404).json({ error: 'Campaign not found or cannot be cancelled' });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: { $in: ['draft', 'cancelled'] },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found or cannot be deleted' });
    res.json({ message: 'Campaign deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getCampaigns, getCampaign, createCampaign, launchCampaign, cancelCampaign, deleteCampaign, processCampaignJob };
