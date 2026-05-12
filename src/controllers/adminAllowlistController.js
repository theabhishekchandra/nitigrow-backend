const AdminAllowlist = require('../models/AdminAllowlist');
const { cidrMatch, ipv4ToInt } = require('../middleware/ipAllowlist');

// GET /api/admin/allowlist — list entries for the current admin.
const list = async (req, res) => {
  try {
    const entries = await AdminAllowlist.find({ adminId: req.admin._id })
      .sort({ addedAt: -1 })
      .populate('addedBy', 'name email')
      .lean();
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Validate a CIDR string (IPv4 only). Returns a normalised string or null.
const normaliseCidr = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // Accept bare IPv4 — treat as /32.
  const withMask = trimmed.includes('/') ? trimmed : `${trimmed}/32`;
  const [base, maskStr] = withMask.split('/');
  const mask = Number(maskStr);
  if (!Number.isInteger(mask) || mask < 0 || mask > 32) return null;
  if (ipv4ToInt(base) === null) return null;
  // Sanity self-check — should match itself.
  if (!cidrMatch(base, withMask)) return null;
  return withMask;
};

// POST /api/admin/allowlist — add a new entry.
const add = async (req, res) => {
  try {
    const { label, cidr } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: 'Label required' });
    const normalised = normaliseCidr(cidr);
    if (!normalised) return res.status(400).json({ error: 'Invalid IPv4 CIDR' });

    const entry = await AdminAllowlist.create({
      adminId: req.admin._id,
      label: label.trim(),
      cidr: normalised,
      addedBy: req.admin._id,
      addedAt: new Date(),
    });
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/admin/allowlist/:id — remove an entry.
const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await AdminAllowlist.findOneAndDelete({ _id: id, adminId: req.admin._id });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { list, add, remove };
