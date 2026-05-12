const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const ApiKey = require('../../src/models/ApiKey');
const { requireSdkKey, cacheInvalidate } = require('../../src/middleware/sdkKeyAuth');
const { createTenant, createUser } = require('../helpers/factories');

// Spin up a minimal Express app that mounts only the SDK auth middleware
// behind a single test endpoint. We don't need the full app here — we're
// asserting middleware behaviour in isolation.
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.get('/_test/protected', requireSdkKey, (req, res) =>
    res.json({ tenantId: String(req.tenantId), keyId: String(req.sdkKey._id) }),
  );
  return app;
};

const createSdkKey = async (overrides = {}) => {
  const tenant = await createTenant();
  const user = await createUser({ tenantId: tenant._id });
  const { raw, hash, preview } = ApiKey.generateKey({ scope: 'sdk', keyType: 'live' });
  const key = await ApiKey.create({
    tenantId: tenant._id,
    userId: user._id,
    name: 'test',
    keyHash: hash,
    keyPreview: preview,
    scope: 'sdk',
    keyType: 'live',
    allowedDomains: ['acme.in'],
    ...overrides,
  });
  return { raw, key, tenant };
};

describe('SDK key auth middleware', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  it('rejects missing key', async () => {
    const res = await request(app).get('/_test/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/API key required/i);
  });

  it('rejects unknown key', async () => {
    const res = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', 'niti_sdk_live_fake')
      .set('Origin', 'https://acme.in');
    expect(res.status).toBe(401);
  });

  it('rejects server-scope key on SDK endpoint', async () => {
    const tenant = await createTenant();
    const user = await createUser({ tenantId: tenant._id });
    const { raw, hash } = ApiKey.generateKey({ scope: 'server' });
    await ApiKey.create({
      tenantId: tenant._id, userId: user._id, name: 'srv',
      keyHash: hash, scope: 'server',
    });
    const res = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Origin', 'https://acme.in');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/SDK-scope/i);
  });

  it('rejects revoked key (and cache flushes on revoke)', async () => {
    const { raw, key } = await createSdkKey();
    // First call to populate cache.
    let res = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Origin', 'https://acme.in');
    expect(res.status).toBe(200);

    // Revoke + invalidate cache (simulates the settings DELETE handler).
    await ApiKey.updateOne({ _id: key._id }, { isActive: false });
    cacheInvalidate(key.keyHash);

    res = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Origin', 'https://acme.in');
    expect(res.status).toBe(401);
  });

  it('rejects missing Origin/Referer', async () => {
    const { raw } = await createSdkKey();
    const res = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Origin/i);
  });

  it('rejects unauthorised origin', async () => {
    const { raw } = await createSdkKey({ allowedDomains: ['acme.in'] });
    const res = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Origin', 'https://attacker.in');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it('accepts exact domain match', async () => {
    const { raw, tenant } = await createSdkKey({ allowedDomains: ['acme.in'] });
    const res = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Origin', 'https://acme.in');
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(String(tenant._id));
  });

  it('accepts wildcard subdomain match', async () => {
    const { raw } = await createSdkKey({ allowedDomains: ['*.acme.in'] });
    const ok = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Origin', 'https://shop.acme.in');
    expect(ok.status).toBe(200);
  });

  it('wildcard subdomain does NOT match a different domain', async () => {
    const { raw } = await createSdkKey({ allowedDomains: ['*.acme.in'] });
    const bad = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Origin', 'https://acmein.com'); // looks similar, different domain
    expect(bad.status).toBe(403);
  });

  it('wildcard does NOT match the apex itself', async () => {
    // *.acme.in matches shop.acme.in but not acme.in. Add apex explicitly.
    const { raw } = await createSdkKey({ allowedDomains: ['*.acme.in'] });
    const res = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Origin', 'https://acme.in');
    expect(res.status).toBe(403);
  });

  it('rejects empty allowedDomains list', async () => {
    const { raw } = await createSdkKey({ allowedDomains: [] });
    const res = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Origin', 'https://acme.in');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/No allowed domains/i);
  });

  it('falls back to Referer when Origin is absent', async () => {
    const { raw } = await createSdkKey({ allowedDomains: ['acme.in'] });
    const res = await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Referer', 'https://acme.in/some/path');
    expect(res.status).toBe(200);
  });

  it('bumps lastUsedAt + usageCount on success', async () => {
    const { raw, key } = await createSdkKey();
    await request(app)
      .get('/_test/protected')
      .set('X-Nitigrow-Key', raw)
      .set('Origin', 'https://acme.in');
    // Bump is fire-and-forget — give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    const fresh = await ApiKey.findById(key._id).lean();
    expect(fresh.usageCount).toBeGreaterThanOrEqual(1);
    expect(fresh.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe('ApiKey.generateKey', () => {
  it('produces the right prefix per scope', () => {
    const sdk = ApiKey.generateKey({ scope: 'sdk', keyType: 'live' });
    const test = ApiKey.generateKey({ scope: 'sdk', keyType: 'test' });
    const srv = ApiKey.generateKey({ scope: 'server' });
    expect(sdk.raw.startsWith('niti_sdk_live_')).toBe(true);
    expect(test.raw.startsWith('niti_sdk_test_')).toBe(true);
    expect(srv.raw.startsWith('niti_') && !srv.raw.includes('sdk')).toBe(true);
  });

  it('hash matches sha256 of raw', () => {
    const { raw, hash } = ApiKey.generateKey({ scope: 'sdk' });
    const expected = crypto.createHash('sha256').update(raw).digest('hex');
    expect(hash).toBe(expected);
  });
});

describe('ApiKey.matchesDomain', () => {
  it('case-insensitive exact match', () => {
    expect(ApiKey.matchesDomain('Acme.IN', ['acme.in'])).toBe(true);
  });
  it('rejects empty entries', () => {
    expect(ApiKey.matchesDomain('acme.in', ['', '  '])).toBe(false);
  });
});
