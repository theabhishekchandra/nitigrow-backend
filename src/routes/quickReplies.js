const express = require('express');
const router = express.Router();
const { list, create, update, remove, search } = require('../controllers/quickReplyController');
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');

router.use(protect, requireTenant);

// All inbox-eligible roles can read/search quick replies
const readRoles = requireRole('owner', 'manager', 'sales_agent', 'support_agent');
// Only owner/manager can create/edit/delete
const writeRoles = requireRole('owner', 'manager');

router.get('/',        readRoles, list);
router.get('/search',  readRoles, search);
router.post('/',       writeRoles, create);
router.put('/:id',     writeRoles, update);
router.delete('/:id',  writeRoles, remove);

module.exports = router;
