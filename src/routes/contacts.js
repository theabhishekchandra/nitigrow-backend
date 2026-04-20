const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
const { protect, requireRole } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');
const { validate, schemas } = require('../middleware/validate');
const {
  getContacts, createContact, updateContact,
  deleteContact, importContacts, exportContacts,
  getOptedOut, eraseContact,
} = require('../controllers/contactController');

router.use(protect, requireTenant);

const readRoles  = requireRole('owner', 'manager', 'sales_agent', 'support_agent', 'campaign_manager', 'analyst');
const writeRoles = requireRole('owner', 'manager', 'sales_agent');

router.get('/',            readRoles, getContacts);
router.get('/export',      readRoles, exportContacts);
router.get('/opted-out',   requireRole('owner', 'manager'), getOptedOut);
router.post('/',           writeRoles, validate(schemas.createContact), createContact);
router.put('/:id',         writeRoles, validate(schemas.updateContact), updateContact);
router.delete('/:id',      writeRoles, deleteContact);
router.delete('/:id/erase', requireRole('owner'), eraseContact); // DPDP — owner only
router.post('/import',     writeRoles, upload.single('file'), importContacts);

module.exports = router;
