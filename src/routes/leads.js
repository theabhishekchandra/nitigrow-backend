const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');

router.use(protect, requireTenant);

const readRoles  = requireRole('owner', 'manager', 'sales_agent', 'support_agent');
const writeRoles = requireRole('owner', 'manager', 'sales_agent');

// GET /api/leads — list leads with optional ?stage= filter, returns pipeline summary
router.get('/', readRoles, async (req, res) => {
  try {
    const { stage, assignedTo, search } = req.query;
    const query = { tenantId: req.tenantId };
    if (stage) query.stage = stage;
    if (assignedTo) query.assignedTo = assignedTo;
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];

    const [leads, pipeline] = await Promise.all([
      Lead.find(query).populate('assignedTo', 'name').sort({ updatedAt: -1 }),
      Lead.aggregate([
        { $match: { tenantId: req.tenantId } },
        { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
      ]),
    ]);

    const pipelineMap = { new:{count:0,value:0}, warm:{count:0,value:0}, hot:{count:0,value:0}, won:{count:0,value:0}, lost:{count:0,value:0} };
    pipeline.forEach(({ _id, count, value }) => { if (pipelineMap[_id]) pipelineMap[_id] = { count, value }; });

    res.json({ data: leads, pipeline: pipelineMap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads — create lead
router.post('/', writeRoles, async (req, res) => {
  try {
    const lead = await Lead.create({ tenantId: req.tenantId, ...req.body });
    res.status(201).json({ data: lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/leads/:id — full update
router.put('/:id', writeRoles, async (req, res) => {
  try {
    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      req.body,
      { new: true, runValidators: true }
    ).populate('assignedTo', 'name');
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ data: lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id/stage — move kanban stage
router.patch('/:id/stage', writeRoles, async (req, res) => {
  try {
    const { stage } = req.body;
    const allowed = ['new','warm','hot','won','lost'];
    if (!allowed.includes(stage)) return res.status(400).json({ error: `stage must be one of: ${allowed.join(', ')}` });

    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { stage },
      { new: true }
    );
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ data: lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/leads/:id
router.delete('/:id', writeRoles, async (req, res) => {
  try {
    const lead = await Lead.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
