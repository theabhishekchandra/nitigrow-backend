
const request = require('supertest');
const { buildTestApp } = require('../helpers/app');
const { createAdmin } = require('../helpers/factories');
const Admin = require('../../src/models/Admin');

let app;

beforeAll(() => {
  ({ app } = buildTestApp());
});

const ADMIN_EMAIL = 'super@nitigrow.in';
const ADMIN_PASSWORD = 'CorrectHorseBattery42';

const seedAdmin = () =>
  createAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'superadmin' });

// Sequential, not parallel — login mutates failedLoginCount, parallel reads race.
const tryWrongPassword = async (n = 1) => {
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(
      // eslint-disable-next-line no-await-in-loop
      await request(app).post('/api/admin/login').send({ email: ADMIN_EMAIL, password: 'WrongPass!' })
    );
  }
  return results;
};

describe('POST /api/admin/login', () => {
  beforeEach(async () => {
    await seedAdmin();
  });

  it('succeeds with correct credentials when 2FA is disabled', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe(ADMIN_EMAIL);
    expect(res.body.user.role).toBe('superadmin');
  });

  it('returns 401 on wrong password without locking on the first attempt', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ email: ADMIN_EMAIL, password: 'WrongPass!' });
    expect(res.status).toBe(401);
  });

  it('locks the account after 5 failed attempts (returns 423 with Retry-After)', async () => {
    await tryWrongPassword(5); // bumps counter to 5 → locks

    // 6th attempt — should be 423 before bcrypt even runs.
    const res = await request(app)
      .post('/api/admin/login')
      .send({ email: ADMIN_EMAIL, password: 'WrongPass!' });

    expect(res.status).toBe(423);
    expect(res.headers['retry-after']).toBeTruthy();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  it('correct password during lockout still returns 423', async () => {
    await tryWrongPassword(5);

    const res = await request(app)
      .post('/api/admin/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(res.status).toBe(423);
  });

  it('lockout expires after time travel and correct password works again', async () => {
    await tryWrongPassword(5);

    // Move lockedUntil into the past.
    await Admin.updateOne({ email: ADMIN_EMAIL }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });

    const res = await request(app)
      .post('/api/admin/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('rejects missing email/password with 400', async () => {
    const res = await request(app).post('/api/admin/login').send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 for an unknown admin email (does not leak existence)', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ email: 'ghost@nitigrow.in', password: 'whatever' });
    expect(res.status).toBe(401);
  });
});
