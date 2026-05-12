const express = require('express');
const router = express.Router();
const { list, add, remove } = require('../controllers/adminAllowlistController');
const { auditLog } = require('../middleware/adminAudit');

// Mounted under /api/admin/allowlist — adminProtect is applied at the parent.
router.get('/', list);
router.post('/', auditLog('admin.allowlist.add'), add);
router.delete('/:id', auditLog('admin.allowlist.remove'), remove);

module.exports = router;
