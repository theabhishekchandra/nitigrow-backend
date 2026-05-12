const Tenant = require('../../src/models/Tenant');
const User = require('../../src/models/User');
const Admin = require('../../src/models/Admin');
const Contact = require('../../src/models/Contact');

let counter = 0;
const uniq = (prefix) => `${prefix}-${Date.now()}-${++counter}`;

const createTenant = (overrides = {}) =>
  Tenant.create({
    businessName: overrides.businessName || `Biz ${uniq('t')}`,
    email: overrides.email || `${uniq('tenant')}@example.com`,
    phone: overrides.phone || '+919876543210',
    plan: overrides.plan || 'trial',
    status: overrides.status || 'active',
    ...overrides,
  });

const createUser = async ({ tenantId, role = 'owner', email, password = 'Password123!', name = 'Test User', ...rest } = {}) => {
  if (!tenantId) {
    const t = await createTenant();
    tenantId = t._id;
  }
  return User.create({
    tenantId,
    name,
    email: email || `${uniq('user')}@example.com`,
    password,
    role,
    ...rest,
  });
};

const createAdmin = (overrides = {}) =>
  Admin.create({
    name: overrides.name || 'Admin User',
    email: overrides.email || `${uniq('admin')}@example.com`,
    password: overrides.password || 'AdminPass123!',
    role: overrides.role || 'superadmin',
    isActive: overrides.isActive ?? true,
    ...overrides,
  });

const createContact = ({ tenantId, phone, ...rest } = {}) =>
  Contact.create({
    tenantId,
    name: rest.name || 'Contact',
    phone: phone || `+9198765${String(Date.now()).slice(-5)}`,
    optedIn: rest.optedIn ?? true,
    ...rest,
  });

module.exports = { createTenant, createUser, createAdmin, createContact };
