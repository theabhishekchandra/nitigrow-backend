
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { buildTestApp } = require('../helpers/app');
const { createAdmin } = require('../helpers/factories');
const Admin = require('../../src/models/Admin');
const { verifyTotp } = require('../../src/controllers/admin2faController');
const { decrypt } = require('../../src/services/encryption');

let app;

beforeAll(() => {
  ({ app } = buildTestApp());
});

// Same base32 alphabet + TOTP algorithm as the controller, mirrored so tests
// compute the *exact* code the controller will accept. Kept local to avoid
// leaking these helpers from the controller export surface.
const BASE32_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
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

const computeTotp = (secretB32, atMs = Date.now()) => {
  const step = Math.floor(atMs / 30000);
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  buf.writeUInt32BE(step & 0xffffffff, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
};

const ADMIN_EMAIL = '2fa@nitigrow.in';
const ADMIN_PASSWORD = 'StrongPass456!';

const adminBearer = (admin) => {
  const token = jwt.sign(
    { id: admin._id, type: 'admin', role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return `Bearer ${token}`;
};

describe('POST /api/admin/2fa/setup', () => {
  it('returns an otpauth URL and a base32 secret', async () => {
    const admin = await createAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const res = await request(app)
      .post('/api/admin/2fa/setup')
      .set('Authorization', adminBearer(admin));

    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(res.body.otpauthUrl).toContain(`secret=${res.body.secret}`);

    const fresh = await Admin.findById(admin._id);
    expect(fresh.totpSecret).toBeTruthy();
    // Should NOT be plain base32 — must be encrypted.
    expect(fresh.totpSecret).not.toBe(res.body.secret);
    expect(decrypt(fresh.totpSecret)).toBe(res.body.secret);
    expect(fresh.twoFactorEnabled).toBe(false);
  });
});

describe('POST /api/admin/2fa/verify', () => {
  let admin;
  let secret;

  beforeEach(async () => {
    admin = await createAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const setupRes = await request(app)
      .post('/api/admin/2fa/setup')
      .set('Authorization', adminBearer(admin));
    secret = setupRes.body.secret;
  });

  it('enables 2FA and returns 10 plaintext recovery codes when the TOTP is correct', async () => {
    const code = computeTotp(secret);
    const res = await request(app)
      .post('/api/admin/2fa/verify')
      .set('Authorization', adminBearer(admin))
      .send({ code });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(Array.isArray(res.body.recoveryCodes)).toBe(true);
    expect(res.body.recoveryCodes).toHaveLength(10);
    // Each plaintext recovery code = 16 hex chars.
    for (const c of res.body.recoveryCodes) expect(c).toMatch(/^[0-9a-f]{16}$/);

    const fresh = await Admin.findById(admin._id);
    expect(fresh.twoFactorEnabled).toBe(true);
    expect(fresh.recoveryCodes).toHaveLength(10);
    // Stored as bcrypt hashes — not plaintext.
    for (const h of fresh.recoveryCodes) expect(h.startsWith('$2')).toBe(true);
  });

  it('returns 401 with an incorrect code', async () => {
    const res = await request(app)
      .post('/api/admin/2fa/verify')
      .set('Authorization', adminBearer(admin))
      .send({ code: '000000' });

    expect(res.status).toBe(401);
    const fresh = await Admin.findById(admin._id);
    expect(fresh.twoFactorEnabled).toBe(false);
  });

  it('returns 400 when code is missing', async () => {
    const res = await request(app)
      .post('/api/admin/2fa/verify')
      .set('Authorization', adminBearer(admin))
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/2fa/recovery/use', () => {
  it('consumes a valid recovery code once', async () => {
    const admin = await createAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const setupRes = await request(app)
      .post('/api/admin/2fa/setup')
      .set('Authorization', adminBearer(admin));
    const verifyRes = await request(app)
      .post('/api/admin/2fa/verify')
      .set('Authorization', adminBearer(admin))
      .send({ code: computeTotp(setupRes.body.secret) });

    const [first, ...rest] = verifyRes.body.recoveryCodes;

    const used = await request(app)
      .post('/api/admin/2fa/recovery/use')
      .set('Authorization', adminBearer(admin))
      .send({ code: first });
    expect(used.status).toBe(200);
    expect(used.body.success).toBe(true);
    expect(used.body.remaining).toBe(9);

    // Reuse — should fail now.
    const reuse = await request(app)
      .post('/api/admin/2fa/recovery/use')
      .set('Authorization', adminBearer(admin))
      .send({ code: first });
    expect(reuse.status).toBe(401);

    // Another unused code still works.
    const second = await request(app)
      .post('/api/admin/2fa/recovery/use')
      .set('Authorization', adminBearer(admin))
      .send({ code: rest[0] });
    expect(second.status).toBe(200);
    expect(second.body.remaining).toBe(8);
  });
});

describe('verifyTotp (pure unit)', () => {
  it('accepts the freshly-generated code and rejects junk', () => {
    // Generate a random 32-char base32 secret.
    const buf = crypto.randomBytes(20);
    let bits = 0, value = 0, secret = '';
    for (const b of buf) {
      value = (value << 8) | b;
      bits += 8;
      while (bits >= 5) {
        secret += BASE32_ALPHA[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) secret += BASE32_ALPHA[(value << (5 - bits)) & 31];

    const code = computeTotp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, '123456')).toBe(false);
    expect(verifyTotp(secret, 'not-numeric')).toBe(false);
    expect(verifyTotp('', code)).toBe(false);
  });
});
