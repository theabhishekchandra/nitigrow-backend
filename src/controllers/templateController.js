const axios = require('axios');
const Template = require('../models/Template');
const Tenant = require('../models/Tenant');
const { validateTemplate: runValidation } = require('../utils/templateValidator');

const BASE_URL = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v19.0';

const getTemplates = async (req, res) => {
  try {
    const { status } = req.query;
    const query = { tenantId: req.tenantId };
    if (status) query.status = status;
    const templates = await Template.find(query).sort({ createdAt: -1 });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const createTemplate = async (req, res) => {
  try {
    const { name, category, language, components } = req.body;

    // Validate against Meta rules before submitting
    const validation = runValidation({ name, category, language, components });
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Template validation failed',
        validation,
      });
    }

    const template = await Template.create({ tenantId: req.tenantId, name, category, language, components });

    // Submit to Meta
    const tenant = await Tenant.findById(req.tenantId);
    if (tenant?.accessToken && tenant?.wabaId) {
      try {
        const response = await axios.post(
          `${BASE_URL}/${tenant.wabaId}/message_templates`,
          { name, category, language, components },
          { headers: { Authorization: `Bearer ${tenant.accessToken}` } }
        );
        template.metaTemplateId = response.data.id;
        template.status = 'PENDING';
        await template.save();
      } catch (metaErr) {
        template.status = 'REJECTED';
        template.rejectionReason = metaErr.response?.data?.error?.message || 'Meta submission failed';
        await template.save();
      }
    }

    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const template = await Template.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    // Delete from Meta too
    const tenant = await Tenant.findById(req.tenantId);
    if (tenant?.accessToken && tenant?.wabaId && template.metaTemplateId) {
      await axios.delete(`${BASE_URL}/${tenant.wabaId}/message_templates?name=${template.name}`, {
        headers: { Authorization: `Bearer ${tenant.accessToken}` },
      }).catch(() => {}); // Don't fail if Meta delete fails
    }

    res.json({ message: 'Template deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Sync template statuses from Meta
const syncTemplates = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant?.accessToken || !tenant?.wabaId) {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    const response = await axios.get(`${BASE_URL}/${tenant.wabaId}/message_templates`, {
      headers: { Authorization: `Bearer ${tenant.accessToken}` },
    });

    for (const metaTemplate of response.data.data || []) {
      await Template.findOneAndUpdate(
        { tenantId: req.tenantId, name: metaTemplate.name },
        { status: metaTemplate.status, rejectionReason: metaTemplate.rejected_reason || '' },
        { upsert: false }
      );
    }

    res.json({ message: 'Templates synced', count: response.data.data?.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Validate template without creating ──────────────────────────────────────
const validateTemplateEndpoint = async (req, res) => {
  try {
    const { name, category, language, components } = req.body;
    const result = runValidation({ name, category, language, components });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Update + re-submit template ─────────────────────────────────────────────
const updateTemplate = async (req, res) => {
  try {
    const { name, category, language, components } = req.body;

    const template = await Template.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const validation = runValidation({ name, category, language, components });
    if (!validation.valid) return res.status(400).json({ error: 'Validation failed', validation });

    Object.assign(template, { name, category, language, components, status: 'PENDING', rejectionReason: '' });
    await template.save();

    // Re-submit to Meta
    const tenant = await Tenant.findById(req.tenantId);
    if (tenant?.accessToken && tenant?.wabaId) {
      try {
        const response = await axios.post(
          `${BASE_URL}/${tenant.wabaId}/message_templates`,
          { name, category, language, components },
          { headers: { Authorization: `Bearer ${tenant.accessToken}` } }
        );
        template.metaTemplateId = response.data.id;
        await template.save();
      } catch (metaErr) {
        template.status = 'REJECTED';
        template.rejectionReason = metaErr.response?.data?.error?.message || 'Meta re-submission failed';
        await template.save();
      }
    }

    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getTemplates, createTemplate, updateTemplate, deleteTemplate, syncTemplates, validateTemplateEndpoint };
