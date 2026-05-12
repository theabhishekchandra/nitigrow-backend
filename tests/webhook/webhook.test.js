
const crypto = require('crypto');
const request = require('supertest');

// The webhook controller hands the payload to the BullMQ queue. We don't
// want tests to require a running Redis — stub the queue out before the app
// is built so the require graph picks up the mock.
vi.mock('../../src/services/queue', () => ({
  enqueueWebhook: vi.fn().mockResolvedValue(undefined),
  campaignQueue: null,
  webhookQueue: null,
  notifQueue: null,
  campaignQueueEvents: null,
  connection: {},
  getQueueStats: vi.fn().mockResolvedValue(null),
  CAMPAIGN_JOB: 'send_campaign',
  WEBHOOK_JOB: 'process_webhook',
}));

const { buildTestApp } = require('../helpers/app');

let app;

beforeAll(() => {
  ({ app } = buildTestApp());
});

const META_APP_SECRET = process.env.META_APP_SECRET; // set in tests/setup.js

const signBody = (rawBody) =>
  'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex');

describe('POST /api/webhook/whatsapp signature verification', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'tenant-x', changes: [{ value: { metadata: { phone_number_id: 'pn-x' } } }] }],
  };

  it('returns 200 with a valid X-Hub-Signature-256', async () => {
    const raw = JSON.stringify(payload);
    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(raw))
      .send(raw);

    expect(res.status).toBe(200);
  });

  it('returns 403 with an invalid signature', async () => {
    const raw = JSON.stringify(payload);
    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=deadbeef')
      .send(raw);

    expect(res.status).toBe(403);
  });

  it('returns 403 when the signature header is missing', async () => {
    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(403);
  });

  it('returns 404 when object is not whatsapp_business_account', async () => {
    const odd = { object: 'page', entry: [] };
    const raw = JSON.stringify(odd);
    const res = await request(app)
      .post('/api/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(raw))
      .send(raw);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/webhook/whatsapp verification handshake', () => {
  it('echoes the challenge on a valid subscribe handshake', async () => {
    const res = await request(app).get('/api/webhook/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': process.env.WEBHOOK_VERIFY_TOKEN,
      'hub.challenge': '12345',
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('12345');
  });

  it('returns 403 when the verify token is wrong', async () => {
    const res = await request(app).get('/api/webhook/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': '12345',
    });
    expect(res.status).toBe(403);
  });
});
