const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const { encrypt, decrypt } = require('../services/encryption');

// --- TOTP (RFC 6238) over HMAC-SHA1, 6 digits, 30s window -------------------
const BASE32_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buf) => {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHA[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHA[(value << (5 - bits)) & 31];
  return out;
};

const base32Decode = (str) => {
  const clean = str.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHA.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

const generateSecret = () => {
  // 20 random bytes → 32-char base32 (TOTP standard size)
  return base32Encode(crypto.randomBytes(20)).slice(0, 32);
};

const totpCode = (secretB32, timeStep) => {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
  buf.writeUInt32BE(timeStep & 0xffffffff, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
};

// Verify against current ±1 window (~±30s) to tolerate clock drift.
const verifyTotp = (secretB32, code) => {
  if (!secretB32 || !code) return false;
  const clean = String(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const step = Math.floor(Date.now() / 30000);
  for (const delta of [-1, 0, 1]) {
    try {
      if (totpCode(secretB32, step + delta) === clean) return true;
    } catch { /* ignore */ }
  }
  return false;
};

// --- Handlers --------------------------------------------------------------

// POST /api/admin/2fa/setup
const setup = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    const secret = generateSecret();
    admin.totpSecret = encrypt(secret);
    admin.twoFactorEnabled = false;
    await admin.save();

    const label = encodeURIComponent(`NitiGrow Admin:${admin.email}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=NitiGrow&algorithm=SHA1&digits=6&period=30`;

    res.json({ secret, otpauthUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/admin/2fa/verify
const verify = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    const admin = await Admin.findById(req.admin._id);
    if (!admin || !admin.totpSecret) return res.status(400).json({ error: '2FA not set up' });

    const secret = decrypt(admin.totpSecret);
    if (!verifyTotp(secret, code)) return res.status(401).json({ error: 'Invalid code' });

    // Generate 10 recovery codes; store bcrypt hashes, return plaintext once.
    const plaintextCodes = Array.from({ length: 10 }, () => crypto.randomBytes(8).toString('hex'));
    const hashed = await Promise.all(plaintextCodes.map((c) => bcrypt.hash(c, 10)));

    admin.twoFactorEnabled = true;
    admin.recoveryCodes = hashed;
    await admin.save();

    res.json({ enabled: true, recoveryCodes: plaintextCodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/admin/2fa/disable
const disable = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const admin = await Admin.findById(req.admin._id);
    if (!admin || !(await admin.matchPassword(password))) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    admin.totpSecret = undefined;
    admin.twoFactorEnabled = false;
    admin.recoveryCodes = [];
    await admin.save();

    res.json({ enabled: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/admin/2fa/recovery/use
const useRecoveryCode = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    const admin = await Admin.findById(req.admin._id);
    if (!admin || !admin.recoveryCodes?.length) {
      return res.status(400).json({ error: 'No recovery codes available' });
    }

    let matchedIdx = -1;
    for (let i = 0; i < admin.recoveryCodes.length; i++) {
      if (await bcrypt.compare(code, admin.recoveryCodes[i])) { matchedIdx = i; break; }
    }
    if (matchedIdx === -1) return res.status(401).json({ error: 'Invalid recovery code' });

    admin.recoveryCodes.splice(matchedIdx, 1);
    await admin.save();

    res.json({ success: true, remaining: admin.recoveryCodes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { setup, verify, disable, useRecoveryCode, verifyTotp };
