const express = require('express');
const router = express.Router();
const {
  getCampaigns, getCampaign, createCampaign, launchCampaign, cancelCampaign, deleteCampaign, estimateCampaign,
} = require('../controllers/campaignController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');
const { validate, schemas } = require('../middleware/validate');

router.use(protect, requireTenant);

const campaignRoles = requireRole('owner', 'manager', 'campaign_manager');

router.get('/',            campaignRoles, getCampaigns);
router.post('/estimate',   campaignRoles, estimateCampaign);
router.post('/',           campaignRoles, validate(schemas.createCampaign), createCampaign);
router.get('/:id',         campaignRoles, getCampaign);
router.post('/:id/launch', campaignRoles, launchCampaign);
router.post('/:id/cancel', campaignRoles, cancelCampaign);
router.delete('/:id',      campaignRoles, deleteCampaign);

module.exports = router;
