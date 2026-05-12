
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { buildTestApp } = require('../helpers/app');
const Tenant = require('../../src/models/Tenant');
const User = require('../../src/models/User');

let app;

beforeAll(() => {
  ({ app } = buildTestApp());
});

const validRegister = {
  businessName: 'Acme Traders',
  email: 'owner@acme.in',
  password: 'StrongPass123!',
  phone: '+919876543210',
};

const extractRefreshCookie = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  return setCookie.find((c) => c.startsWith('refreshToken='));
};

describe('POST /api/auth/register', () => {
  it('creates a tenant and owner user, returns access token + refresh cookie', async () => {
    const res = await request(app).post('/api/auth/register').send(validRegister);

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe('owner@acme.in');
    expect(res.body.user.role).toBe('owner');

    const refreshCookie = extractRefreshCookie(res);
    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie).toMatch(/HttpOnly/i);

    const tenant = await Tenant.findOne({ email: 'owner@acme.in' });
    expect(tenant).toBeTruthy();
    expect(tenant.businessName).toBe('Acme Traders');

    const user = await User.findOne({ email: 'owner@acme.in' });
    expect(user).toBeTruthy();
    expect(String(user.tenantId)).toBe(String(tenant._id));
    expect(user.role).toBe('owner');

    // Access token must embed tenantId for fast-path auth middleware.
    const decoded = jwt.verify(res.body.accessToken, process.env.JWT_SECRET);
    expect(String(decoded.tenantId)).toBe(String(tenant._id));
  });

  it('rejects duplicate email', async () => {
    await request(app).post('/api/auth/register').send(validRegister);
    const dup = await request(app).post('/api/auth/register').send(validRegister);
    expect(dup.status).toBe(400);
  });

  it('rejects an invalid password (validation)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validRegister, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('POST /api/auth/login', () => {
  it('returns access token + refresh cookie on valid credentials', async () => {
    await request(app).post('/api/auth/register').send(validRegister);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validRegister.email, password: validRegister.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(extractRefreshCookie(res)).toBeTruthy();
  });

  it('returns 401 on bad password', async () => {
    await request(app).post('/api/auth/register').send(validRegister);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validRegister.email, password: 'WrongPass123!' });

    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('returns 401 on unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@nowhere.in', password: 'WrongPass123!' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh (token rotation)', () => {
  // /api/auth/refresh is CSRF-protected (double-submit cookie pattern).
  // Each call must first hit /api/auth/csrf to get { csrfToken } + the niti-csrf cookie,
  // then send both back with the refresh request.
  const fetchCsrf = async (extraCookies = []) => {
    const res = await request(app).get('/api/auth/csrf').set('Cookie', extraCookies);
    const csrfCookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('niti-csrf='));
    return { token: res.body.csrfToken, cookie: csrfCookie };
  };

  it('issues a new access token and rotates the refresh cookie', async () => {
    const reg = await request(app).post('/api/auth/register').send(validRegister);
    const firstRefresh = extractRefreshCookie(reg);
    expect(firstRefresh).toBeTruthy();

    // Sleep 1.1s so the JWT `iat` claim differs and the rotated token is distinct.
    await new Promise((r) => setTimeout(r, 1100));

    const { token, cookie: csrfCookie } = await fetchCsrf([firstRefresh]);
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [firstRefresh, csrfCookie].filter(Boolean))
      .set('X-CSRF-Token', token || '');

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const newRefresh = extractRefreshCookie(res);
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(firstRefresh);
  });

  it('returns 401 when no refresh cookie is sent', async () => {
    const { token, cookie: csrfCookie } = await fetchCsrf();
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', csrfCookie ? [csrfCookie] : [])
      .set('X-CSRF-Token', token || '');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid refresh token', async () => {
    const { token, cookie: csrfCookie } = await fetchCsrf(['refreshToken=not-a-jwt']);
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=not-a-jwt', csrfCookie].filter(Boolean))
      .set('X-CSRF-Token', token || '');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('requires a JWT', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns user + tenant when authenticated', async () => {
    const reg = await request(app).post('/api/auth/register').send(validRegister);
    const token = reg.body.accessToken;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('owner@acme.in');
    expect(res.body.tenant.businessName).toBe('Acme Traders');
    expect(res.body.tenant.accessToken).toBeUndefined();
  });

  it('rejects an obviously invalid bearer token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });
});
