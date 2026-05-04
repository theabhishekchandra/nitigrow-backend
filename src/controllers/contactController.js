const Contact = require('../models/Contact');
const Tenant  = require('../models/Tenant');
const Papa    = require('papaparse');

// ─── List contacts with search + pagination ────────────────────────────────
const getContacts = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, tag, status } = req.query;
    const query = { tenantId: req.tenantId };

    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
    if (tag) query.tags = tag;
    if (status) query.status = status;

    const contacts = await Contact.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Contact.countDocuments(query);
    res.json({ contacts, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Create single contact ─────────────────────────────────────────────────
const createContact = async (req, res) => {
  try {
    const contact = await Contact.create({ ...req.body, tenantId: req.tenantId });
    res.status(201).json(contact);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Phone number already exists' });
    res.status(500).json({ error: err.message });
  }
};

// ─── Update contact ─────────────────────────────────────────────────────────
const updateContact = async (req, res) => {
  try {
    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      req.body,
      { new: true }
    );
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(contact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Delete contact ─────────────────────────────────────────────────────────
const deleteContact = async (req, res) => {
  try {
    const contact = await Contact.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json({ message: 'Contact deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── CSV Import ─────────────────────────────────────────────────────────────
// Accepts multipart file OR JSON body with csvText
// CSV columns: name,phone,email,tags  (tags = comma or pipe separated)
const importContacts = async (req, res) => {
  try {
    let csvText = '';

    // If multer uploaded a file
    if (req.file) {
      csvText = req.file.buffer.toString('utf-8');
    } else if (req.body.csvText) {
      csvText = req.body.csvText;
    } else {
      return res.status(400).json({ error: 'No CSV file or csvText provided' });
    }

    // Parse CSV
    const parsed = Papa.parse(csvText.trim(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
    });

    if (!parsed.data || parsed.data.length === 0) {
      return res.status(400).json({ error: 'CSV is empty or has no data rows' });
    }

    // Check plan contact limit
    const tenant = await Tenant.findById(req.tenantId);
    const usageCheck = tenant.checkUsage('contacts');
    const currentCount = await Contact.countDocuments({ tenantId: req.tenantId });
    const planLimit = usageCheck.limit;

    const results = { imported: 0, skipped: 0, duplicates: 0, errors: [] };

    // Normalize phone: ensure starts with +
    const normalizePhone = (p) => {
      if (!p) return null;
      p = p.toString().replace(/[\s\-()]/g, '');
      if (!p.startsWith('+')) p = '+' + p;
      return p;
    };

    // Validate phone: basic E.164 check
    const isValidPhone = (p) => /^\+[1-9]\d{6,14}$/.test(p);

    // Get existing phones for dedup
    const existingPhones = new Set(
      (await Contact.find({ tenantId: req.tenantId }).select('phone').lean())
        .map(c => c.phone)
    );

    const toInsert = [];

    for (let i = 0; i < parsed.data.length; i++) {
      const row = parsed.data[i];
      const rowNum = i + 2; // +2 for header + 0-index

      // Find phone column (flexible naming)
      const phone = normalizePhone(row.phone || row.phone_number || row.mobile || row.whatsapp || '');
      const name  = (row.name || row.full_name || row.contact_name || '').trim();

      if (!phone) {
        results.errors.push({ row: rowNum, reason: 'Missing phone number' });
        results.skipped++;
        continue;
      }

      if (!isValidPhone(phone)) {
        results.errors.push({ row: rowNum, phone, reason: 'Invalid phone format (need E.164 like +919876543210)' });
        results.skipped++;
        continue;
      }

      if (existingPhones.has(phone)) {
        results.duplicates++;
        continue;
      }

      // Check limit
      if (planLimit !== -1 && (currentCount + toInsert.length) >= planLimit) {
        results.errors.push({ row: rowNum, reason: `Contact limit reached (${planLimit}). Upgrade your plan.` });
        results.skipped += (parsed.data.length - i);
        break;
      }

      // Parse tags
      let tags = [];
      const rawTags = row.tags || row.tag || row.labels || '';
      if (rawTags) {
        tags = rawTags.split(/[,|;]/).map(t => t.trim()).filter(Boolean);
      }

      toInsert.push({
        tenantId: req.tenantId,
        name: name || phone,
        phone,
        email: (row.email || '').trim() || undefined,
        tags,
        optedIn: true,
      });

      existingPhones.add(phone); // prevent within-file dupes
    }

    // Bulk insert
    if (toInsert.length > 0) {
      await Contact.insertMany(toInsert, { ordered: false }).catch(err => {
        // Some dupes may still fail on unique index — count them
        if (err.writeErrors) {
          results.duplicates += err.writeErrors.length;
          results.imported = toInsert.length - err.writeErrors.length;
        }
      });
      if (results.imported === 0) results.imported = toInsert.length;

      // Update tenant contact count
      await tenant.incrementUsage('contacts', results.imported);
    }

    res.json({
      message: `Imported ${results.imported} contacts`,
      ...results,
      totalRows: parsed.data.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── CSV Export ──────────────────────────────────────────────────────────────
const exportContacts = async (req, res) => {
  try {
    const { tag, status } = req.query;
    const query = { tenantId: req.tenantId };
    if (tag) query.tags = tag;
    if (status) query.status = status;

    const contacts = await Contact.find(query)
      .select('name phone email tags status optedIn createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const csvData = contacts.map(c => ({
      name: c.name || '',
      phone: c.phone || '',
      email: c.email || '',
      tags: (c.tags || []).join(', '),
      status: c.status || 'active',
      opted_in: c.optedIn ? 'Yes' : 'No',
      created_at: c.createdAt ? new Date(c.createdAt).toISOString().split('T')[0] : '',
    }));

    const csv = Papa.unparse(csvData);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=contacts_${Date.now()}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Opted-out contacts list (DPDP compliance audit) ─────────────────────────
const getOptedOut = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const query = { tenantId: req.tenantId, optedOut: true };
    const [contacts, total] = await Promise.all([
      Contact.find(query)
        .select('name phone optOutDate optInSource createdAt')
        .sort({ optOutDate: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Contact.countDocuments(query),
    ]);
    res.json({ contacts, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── DPDP right to erasure — permanently remove contact + all message history ─
const eraseContact = async (req, res) => {
  try {
    const Message = require('../models/Message');
    const contact = await Contact.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    await Promise.all([
      Message.deleteMany({ tenantId: req.tenantId, contactId: contact._id }),
      Contact.deleteOne({ _id: contact._id }),
    ]);

    res.json({ message: 'Contact and all associated data permanently erased (DPDP compliance)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Get all unique tags for tenant ───────────────────────────────────────
const getTags = async (req, res) => {
  try {
    const tags = await Contact.distinct('tags', { tenantId: req.tenantId });
    res.json({ tags: tags.filter(Boolean).sort() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getContacts, createContact, updateContact, deleteContact, importContacts, exportContacts, getOptedOut, eraseContact, getTags };
