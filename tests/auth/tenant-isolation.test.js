
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { buildTestApp } = require('../helpers/app');
const { createTenant, createUser, createContact } = require('../helpers/factories');

let app;

beforeAll(() => {
  ({ app } = buildTestApp());
});

const signAccessToken = (user) =>
  jwt.sign(
    { id: user._id, tenantId: user.tenantId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

describe('Multi-tenant isolation — Contact resource', () => {
  it("PUT /api/contacts/:id from tenant A on tenant B's contact returns 404", async () => {
    const tenantA = await createTenant({ email: 'a2@example.in' });
    const tenantB = await createTenant({ email: 'b2@example.in' });
    const userA = await createUser({ tenantId: tenantA._id, role: 'owner', email: 'ua2@example.in' });
    const contactB = await createContact({ tenantId: tenantB._id, phone: '+919999900002' });

    const tokenA = signAccessToken(userA);

    const res = await request(app)
      .put(`/api/contacts/${contactB._id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(404);
    expect(res.body.name).toBeUndefined();
  });

  it("DELETE /api/contacts/:id from tenant A on tenant B's contact returns 404 and does not delete", async () => {
    const Contact = require('../../src/models/Contact');

    const tenantA = await createTenant({ email: 'a3@example.in' });
    const tenantB = await createTenant({ email: 'b3@example.in' });
    const userA = await createUser({ tenantId: tenantA._id, role: 'owner', email: 'ua3@example.in' });
    const contactB = await createContact({ tenantId: tenantB._id, phone: '+919999900003' });

    const tokenA = signAccessToken(userA);

    const res = await request(app)
      .delete(`/api/contacts/${contactB._id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    const stillThere = await Contact.findById(contactB._id);
    expect(stillThere).toBeTruthy();
  });

  it('GET /api/contacts only lists the calling tenant\'s contacts', async () => {
    const tenantA = await createTenant({ email: 'a4@example.in' });
    const tenantB = await createTenant({ email: 'b4@example.in' });
    const userA = await createUser({ tenantId: tenantA._id, role: 'owner', email: 'ua4@example.in' });

    await createContact({ tenantId: tenantA._id, phone: '+919999900010', name: 'A1' });
    await createContact({ tenantId: tenantA._id, phone: '+919999900011', name: 'A2' });
    await createContact({ tenantId: tenantB._id, phone: '+919999900012', name: 'B1' });

    const tokenA = signAccessToken(userA);
    const res = await request(app)
      .get('/api/contacts')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const names = res.body.contacts.map((c) => c.name).sort();
    expect(names).toEqual(['A1', 'A2']);
  });
});
