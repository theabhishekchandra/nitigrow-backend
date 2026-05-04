const express = require('express');
const router = express.Router();
const { listFlows, createFlow, getFlow, updateFlow, toggleStatus, deleteFlow, aiBuildFlow, aiPreviewFlow, listTemplates } = require('../controllers/chatbotFlowController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');
const FlowRunLog = require('../models/FlowRunLog');

router.use(protect, requireTenant);

const flowRoles = requireRole('owner', 'manager');

router.get('/',              flowRoles, listFlows);
router.post('/',             flowRoles, createFlow);
router.get('/templates',     flowRoles, listTemplates);
router.post('/ai-build',     flowRoles, aiBuildFlow);
router.post('/ai-preview',   flowRoles, aiPreviewFlow);
router.get('/:id',           flowRoles, getFlow);
router.put('/:id',           flowRoles, updateFlow);
router.patch('/:id/status',  flowRoles, toggleStatus);
router.delete('/:id',        flowRoles, deleteFlow);

// GET /api/chatbot-flows/run-logs — execution history
router.get('/run-logs', flowRoles, async (req, res) => {
  try {
    const { flowId, page = 1, limit = 20 } = req.query;
    const query = { tenantId: req.tenantId };
    if (flowId) query.flowId = flowId;

    const [logs, total] = await Promise.all([
      FlowRunLog.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      FlowRunLog.countDocuments(query),
    ]);

    res.json({ data: logs, pagination: { page: Number(page), limit: Number(limit), total } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chatbot-flows/stats — KPI summary across all flows
router.get('/stats', flowRoles, async (req, res) => {
  try {
    const ChatbotFlow = require('../models/ChatbotFlow');
    const tid = req.tenantId;

    const [flows, logStats] = await Promise.all([
      ChatbotFlow.find({ tenantId: tid }),
      FlowRunLog.aggregate([
        { $match: { tenantId: tid } },
        { $group: {
          _id: null,
          totalRuns:    { $sum: 1 },
          completed:    { $sum: { $cond: [{ $eq: ['$status', 'completed']  }, 1, 0] } },
          handedOff:    { $sum: { $cond: [{ $eq: ['$status', 'handed_off']}, 1, 0] } },
          failed:       { $sum: { $cond: [{ $eq: ['$status', 'failed']    }, 1, 0] } },
          avgDurationMs:{ $avg: '$durationMs' },
        }},
      ]),
    ]);

    const s = logStats[0] || { totalRuns:0, completed:0, handedOff:0, failed:0, avgDurationMs:0 };
    res.json({
      activeFlows:  flows.filter(f => f.status === 'active').length,
      totalFlows:   flows.length,
      totalRuns:    s.totalRuns,
      resolvedRate: s.totalRuns > 0 ? Math.round(s.completed / s.totalRuns * 100) : 0,
      handoffRate:  s.totalRuns > 0 ? Math.round(s.handedOff / s.totalRuns * 100) : 0,
      avgDurationMs: Math.round(s.avgDurationMs || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
