const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const adminProtect = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authorized' });

  try {
    const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ error: 'Admin access only' });

    const admin = await Admin.findById(decoded.id).select('-password');
    if (!admin || !admin.isActive) return res.status(401).json({ error: 'Admin account not found or inactive' });

    req.admin = admin;
    // Surface decoded claims (incl. jti) for session-aware handlers.
    // NOTE: We don't yet enforce jti ∈ admin.sessions[] here — follow-up if we want hard revoke.
    req.user = { id: decoded.id, role: decoded.role, jti: decoded.jti };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = { adminProtect };
