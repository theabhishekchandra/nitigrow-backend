const ChatbotFlow = require('../models/ChatbotFlow');

// GET /api/chatbot-flows
const listFlows = async (req, res) => {
  try {
    const flows = await ChatbotFlow.find({ tenantId: req.tenantId }).sort({ createdAt: -1 });
    res.json(flows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/chatbot-flows
const createFlow = async (req, res) => {
  try {
    const { name, description, trigger, nodes, startNode } = req.body;
    if (!name) return res.status(400).json({ error: 'Flow name is required' });

    const flow = await ChatbotFlow.create({
      tenantId: req.tenantId,
      name, description,
      trigger: trigger || { type: 'keyword', keywords: [] },
      nodes: nodes || [],
      startNode: startNode || null,
      status: 'draft',
    });
    res.status(201).json(flow);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/chatbot-flows/:id
const getFlow = async (req, res) => {
  try {
    const flow = await ChatbotFlow.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(flow);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// PUT /api/chatbot-flows/:id
const updateFlow = async (req, res) => {
  try {
    const { name, description, trigger, nodes, startNode, status } = req.body;
    const flow = await ChatbotFlow.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { name, description, trigger, nodes, startNode, status },
      { new: true, runValidators: true }
    );
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(flow);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// PATCH /api/chatbot-flows/:id/status
const toggleStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive', 'draft'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const flow = await ChatbotFlow.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { status },
      { new: true }
    );
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(flow);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// DELETE /api/chatbot-flows/:id
const deleteFlow = async (req, res) => {
  try {
    const flow = await ChatbotFlow.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json({ message: 'Flow deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/chatbot-flows/ai-build — AI generates a flow from description
const aiBuildFlow = async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: 'Description is required' });

    const { generateFlowFromDescription } = require('../services/aiFlowBuilder');
    const flowData = await generateFlowFromDescription(description);

    // Auto-save as draft
    const saved = await ChatbotFlow.create({
      tenantId: req.tenantId,
      ...flowData,
      status: 'draft',
    });

    res.status(201).json(saved);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/chatbot-flows/ai-preview — preview without saving
const aiPreviewFlow = async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: 'Description is required' });

    const { generateFlowFromDescription } = require('../services/aiFlowBuilder');
    const flowData = await generateFlowFromDescription(description);
    res.json(flowData);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/chatbot-flows/templates — list available AI templates
const listTemplates = async (req, res) => {
  const { FLOW_TEMPLATES } = require('../services/aiFlowBuilder');
  const templates = Object.entries(FLOW_TEMPLATES).map(([key, val]) => ({
    id: key,
    name: val.name,
    description: val.description,
    nodeCount: val.nodes.length,
    triggerType: val.trigger.type,
  }));
  res.json(templates);
};

module.exports = { listFlows, createFlow, getFlow, updateFlow, toggleStatus, deleteFlow, aiBuildFlow, aiPreviewFlow, listTemplates };
