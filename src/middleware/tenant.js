// Ensures tenantId is always present on every request — critical for multi-tenancy
const requireTenant = (req, res, next) => {
  if (!req.tenantId) {
    return res.status(403).json({ error: 'Tenant context missing' });
  }
  next();
};

module.exports = { requireTenant };
