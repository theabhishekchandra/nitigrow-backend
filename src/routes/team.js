const express = require('express');
const router = express.Router();
const { getTeam, inviteMember, updateRole, removeMember } = require('../controllers/teamController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');

router.use(protect, requireTenant);

router.get('/', requireRole('owner', 'manager'), getTeam);
router.post('/invite', requireRole('owner', 'manager'), inviteMember);
router.patch('/:userId/role', requireRole('owner', 'manager'), updateRole);
router.delete('/:userId', requireRole('owner', 'manager'), removeMember);

module.exports = router;
