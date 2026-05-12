const request = require('supertest');
const { buildTestApp } = require('../helpers/app');
const { createTenant, createUser } = require('../helpers/factories');
const ApiKey = require('../../src/models/ApiKey');
const ChatSession = require('../../src/models/ChatSession');
const Contact = require('../../src/models/Contact');
const Message = require('../../src/models/Message');

let app;
beforeAll(() => { ({ app } = buildTestApp()); });

// Helper that mints an SDK key for a fresh tenant and returns the
// pieces every test needs (the raw key, the tenant, the user).
const seedSdkKey = async ({ allowedDomains = ['acme.in'] } = {}) => {
  const tenant = await createTenant();
  const user = await createUser({ tenantId: tenant._id });
  const { raw, hash, preview } = ApiKey.generateKey({ scope: 'sdk', keyType: 'live' });
  await ApiKey.create({
    tenantId: tenant._id, userId: user._id, name: 'test',
    keyHash: hash, keyPreview: preview, scope: 'sdk', keyType: 'live',
    allowedDomains,
  });
  return { raw, tenant, user };
};

const authed = (req, key) =>
  req.set('X-Nitigrow-Key', key).set('Origin', 'https://acme.in');

describe('POST /api/sdk/chat/start', () => {
  it('returns a session token and contact link', async () => {
    const { raw, tenant } = await seedSdkKey();
    const res = await authed(
      request(app).post('/api/sdk/chat/start').send({
        name: 'Riya', email: 'riya@example.in', pageUrl: 'https://acme.in/products',
      }),
      raw,
    );
    expect(res.status).toBe(201);
    expect(res.body.sessionToken).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.welcome.businessName).toBe(tenant.businessName);

    // A Contact and a ChatSession were created.
    const contact = await Contact.findOne({ tenantId: tenant._id, channel: 'sdk_widget' });
    expect(contact).toBeTruthy();
    expect(contact.email).toBe('riya@example.in');
    const session = await ChatSession.findOne({ tenantId: tenant._id });
    expect(session).toBeTruthy();
    expect(session.status).toBe('active');
  });

  it('rejects bad email', async () => {
    const { raw } = await seedSdkKey();
    const res = await authed(
      request(app).post('/api/sdk/chat/start').send({ email: 'not-an-email' }),
      raw,
    );
    expect(res.status).toBe(400);
  });

  it('reuses an existing contact when same email starts a second session', async () => {
    const { raw, tenant } = await seedSdkKey();
    await authed(request(app).post('/api/sdk/chat/start').send({ email: 'r@example.in' }), raw);
    await authed(request(app).post('/api/sdk/chat/start').send({ email: 'r@example.in' }), raw);
    const contacts = await Contact.find({ tenantId: tenant._id, channel: 'sdk_widget' });
    expect(contacts).toHaveLength(1);
  });
});

describe('POST /api/sdk/chat/message', () => {
  it('persists a Message linked to the session contact', async () => {
    const { raw, tenant } = await seedSdkKey();
    const startRes = await authed(
      request(app).post('/api/sdk/chat/start').send({ email: 'r@example.in' }),
      raw,
    );
    const token = startRes.body.sessionToken;

    const send = await authed(
      request(app).post('/api/sdk/chat/message').send({ sessionToken: token, text: 'Hello' }),
      raw,
    );
    expect(send.status).toBe(201);

    const msgs = await Message.find({ tenantId: tenant._id });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].direction).toBe('inbound');
    expect(msgs[0].content.text).toBe('Hello');
  });

  it('strips HTML to prevent XSS in the agent inbox', async () => {
    const { raw } = await seedSdkKey();
    const { body } = await authed(
      request(app).post('/api/sdk/chat/start').send({}),
      raw,
    );
    await authed(
      request(app).post('/api/sdk/chat/message').send({
        sessionToken: body.sessionToken,
        text: 'Hi <script>alert(1)</script> there',
      }),
      raw,
    );
    const msg = await Message.findOne({});
    expect(msg.content.text).toBe('Hi alert(1) there');
    expect(msg.content.text).not.toMatch(/<script>/);
  });

  it('rejects empty text', async () => {
    const { raw } = await seedSdkKey();
    const { body } = await authed(request(app).post('/api/sdk/chat/start').send({}), raw);
    const res = await authed(
      request(app).post('/api/sdk/chat/message').send({ sessionToken: body.sessionToken, text: '   ' }),
      raw,
    );
    expect(res.status).toBe(400);
  });

  it('rejects an unknown session token', async () => {
    const { raw } = await seedSdkKey();
    const res = await authed(
      request(app).post('/api/sdk/chat/message').send({ sessionToken: 'fake', text: 'hi' }),
      raw,
    );
    expect(res.status).toBe(404);
  });

  it('refuses to send on a closed session', async () => {
    const { raw } = await seedSdkKey();
    const start = await authed(request(app).post('/api/sdk/chat/start').send({}), raw);
    await authed(
      request(app).post('/api/sdk/chat/close').send({ sessionToken: start.body.sessionToken }),
      raw,
    );
    const res = await authed(
      request(app).post('/api/sdk/chat/message').send({ sessionToken: start.body.sessionToken, text: 'hi' }),
      raw,
    );
    expect(res.status).toBe(410);
  });

  it("won't accept another tenant's session token even with a valid key", async () => {
    const a = await seedSdkKey();
    const b = await seedSdkKey();
    const aStart = await authed(request(app).post('/api/sdk/chat/start').send({}), a.raw);
    const res = await authed(
      request(app).post('/api/sdk/chat/message').send({
        sessionToken: aStart.body.sessionToken, text: 'hi',
      }),
      b.raw, // tenant B's key, tenant A's session — must 404
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/sdk/chat/history', () => {
  it('returns messages oldest-first with from labels', async () => {
    const { raw } = await seedSdkKey();
    const start = await authed(request(app).post('/api/sdk/chat/start').send({}), raw);
    const tok = start.body.sessionToken;
    await authed(request(app).post('/api/sdk/chat/message').send({ sessionToken: tok, text: 'one' }), raw);
    await authed(request(app).post('/api/sdk/chat/message').send({ sessionToken: tok, text: 'two' }), raw);

    const res = await authed(request(app).get(`/api/sdk/chat/history?sessionToken=${tok}`), raw);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0].text).toBe('one');
    expect(res.body.messages[0].from).toBe('visitor');
  });
});

describe('POST /api/sdk/chat/close', () => {
  it('marks the session closed and sets closedAt', async () => {
    const { raw, tenant } = await seedSdkKey();
    const start = await authed(request(app).post('/api/sdk/chat/start').send({}), raw);
    const res = await authed(
      request(app).post('/api/sdk/chat/close').send({ sessionToken: start.body.sessionToken }),
      raw,
    );
    expect(res.status).toBe(200);
    const session = await ChatSession.findOne({ tenantId: tenant._id });
    expect(session.status).toBe('closed');
    expect(session.closedAt).toBeInstanceOf(Date);
  });
});
