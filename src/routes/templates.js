const express = require('express');
const router = express.Router();
const { getTemplates, createTemplate, deleteTemplate, syncTemplates, validateTemplateEndpoint } = require('../controllers/templateController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');

router.use(protect, requireTenant);

const readRoles  = requireRole('owner', 'manager', 'campaign_manager', 'sales_agent', 'support_agent');
const writeRoles = requireRole('owner', 'manager', 'campaign_manager');

router.get('/',         readRoles, getTemplates);
router.post('/validate', writeRoles, validateTemplateEndpoint);
router.post('/',        writeRoles, createTemplate);
router.post('/sync',    writeRoles, syncTemplates);
router.delete('/:id',  writeRoles, deleteTemplate);

module.exports = router;
