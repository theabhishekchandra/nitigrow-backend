const AdminAllowlist = require('../models/AdminAllowlist');

// ── IPv4 CIDR matcher ────────────────────────────────────────────────────────
// Tiny self-contained matcher — we don't want an `ipaddr.js` dependency for
// this single check. Accepts either a bare IPv4 ("203.0.113.5") or a CIDR
// ("203.0.113.0/24"). Returns false for anything malformed or for IPv6.
const ipv4ToInt = (ip) => {
  // Strip any IPv4-mapped IPv6 prefix Express may surface (e.g. ::ffff:1.2.3.4)
  const cleaned = String(ip || '')
    .replace(/^::ffff:/i, '')
    .trim();
  const parts = cleaned.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  // Force unsigned 32-bit. Multiplication keeps us above bit-shift's signed range.
  return n >>> 0;
};

const cidrMatch = (ip, cidr) => {
  if (!cidr) return false;
  const [base, maskStr] = String(cidr).split('/');
  const mask = maskStr === undefined ? 32 : Number(maskStr);
  if (!Number.isInteger(mask) || mask < 0 || mask > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;

  if (mask === 0) return true; // 0.0.0.0/0 matches everything
  // Build mask as unsigned int — avoid `<< 32` UB on the 32-bit edge case.
  const maskInt = mask === 32 ? 0xffffffff : ~((1 << (32 - mask)) - 1) >>> 0;
  return (ipInt & maskInt) === (baseInt & maskInt);
};

// Express middleware: guards all admin routes.
// - If req.admin has 0 allowlist entries → open (pass through).
// - If req.admin has ≥1 entry → request IP must match at least one CIDR.
// Relies on adminProtect populating req.admin upstream.
const ipAllowlist = async (req, res, next) => {
  try {
    if (!req.admin?._id) return next(); // no admin context — skip (other middleware will reject).

    const entries = await AdminAllowlist.find({ adminId: req.admin._id }).lean();
    if (!entries || entries.length === 0) return next(); // bypass when empty.

    const ip = req.ip;
    const hit = entries.some((e) => cidrMatch(ip, e.cidr));
    if (!hit) return res.status(403).json({ error: 'Forbidden — IP not allowlisted' });

    next();
  } catch (err) {
    console.error('[ipAllowlist] check failed:', err.message);
    res.status(500).json({ error: 'IP allowlist check failed' });
  }
};

module.exports = { ipAllowlist, cidrMatch, ipv4ToInt };
