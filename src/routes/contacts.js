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
  getOptedOut, eraseContact, getTags,
} = require('../controllers/contactController');
const Segment = require('../models/Segment');

router.use(protect, requireTenant);

const readRoles  = requireRole('owner', 'manager', 'sales_agent', 'support_agent', 'campaign_manager', 'analyst');
const writeRoles = requireRole('owner', 'manager', 'sales_agent');

router.get('/',            readRoles, getContacts);
router.get('/tags',        readRoles, getTags);
router.get('/export',      readRoles, exportContacts);
router.get('/opted-out',   requireRole('owner', 'manager'), getOptedOut);
router.post('/',           writeRoles, validate(schemas.createContact), createContact);
router.put('/:id',         writeRoles, validate(schemas.updateContact), updateContact);
router.delete('/:id',      writeRoles, deleteContact);
router.delete('/:id/erase', requireRole('owner'), eraseContact); // DPDP — owner only
router.post('/import',     writeRoles, upload.single('file'), importContacts);

// GET /api/contacts/segments — list saved segments with contact counts
router.get('/segments', readRoles, async (req, res) => {
  try {
    const Contact = require('../models/Contact');
    const tid = req.tenantId;

    // System segments (always returned)
    const [all, active, optedOut, hot, vip] = await Promise.all([
      Contact.countDocuments({ tenantId: tid }),
      Contact.countDocuments({ tenantId: tid, conversationStatus: 'open' }),
      Contact.countDocuments({ tenantId: tid, optedOut: true }),
      Contact.countDocuments({ tenantId: tid, status: 'hot' }),
      Contact.countDocuments({ tenantId: tid, tags: 'vip' }),
    ]);

    const systemSegments = [
      { _id: 'all',      name: 'All contacts',  count: all,      isSystem: true },
      { _id: 'active',   name: 'Active',        count: active,   isSystem: true },
      { _id: 'hot',      name: 'Hot leads',     count: hot,      isSystem: true },
      { _id: 'vip',      name: 'VIP',           count: vip,      isSystem: true },
      { _id: 'optedOut', name: 'Opted out',     count: optedOut, isSystem: true },
    ];

    const custom = await Segment.find({ tenantId: tid }).sort({ createdAt: -1 });
    res.json({ data: [...systemSegments, ...custom] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contacts/segments — create saved segment
router.post('/segments', writeRoles, async (req, res) => {
  try {
    const { name, description, filters } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const segment = await Segment.create({ tenantId: req.tenantId, name, description, filters: filters || [] });
    res.status(201).json({ data: segment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/contacts/:id/tags — add or remove tags on a contact
router.patch('/:id/tags', writeRoles, async (req, res) => {
  try {
    const Contact = require('../models/Contact');
    const { add = [], remove = [] } = req.body;
    const update = {};
    if (add.length)    update.$addToSet = { tags: { $each: add } };
    if (remove.length) update.$pull     = { tags: { $in: remove } };
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Provide add or remove arrays' });

    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      update,
      { new: true }
    );
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json({ data: contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
