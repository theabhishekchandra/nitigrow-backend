const express = require('express');
const router = express.Router();
const { listFlows, createFlow, getFlow, updateFlow, toggleStatus, deleteFlow, aiBuildFlow, aiPreviewFlow, listTemplates } = require('../controllers/chatbotFlowController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');

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

module.exports = router;
