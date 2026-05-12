const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const adminProtect = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authorized' });

  try {
    const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ error: 'Admin access only' });

    const admin = await Admin.findById(decoded.id).select('-password');
    if (!admin || !admin.isActive)
      return res.status(401).json({ error: 'Admin account not found or inactive' });

    // Hard jti enforcement — if the session was revoked from admin.sessions[],
    // the token must no longer work even if it hasn't expired yet.
    if (decoded.jti) {
      const session = admin.sessions?.find((s) => s.jti === decoded.jti);
      if (!session) return res.status(401).json({ error: 'Session revoked' });

      // Touch lastSeenAt via positional update — avoids a refetch + double-save round-trip.
      Admin.updateOne(
        { _id: admin._id },
        { $set: { 'sessions.$[el].lastSeenAt': new Date() } },
        { arrayFilters: [{ 'el.jti': decoded.jti }] },
      ).catch((err) => console.error('[adminAuth] lastSeenAt update failed:', err.message));
    }

    req.admin = admin;
    // Surface decoded claims (incl. jti) for session-aware handlers.
    req.user = { id: decoded.id, role: decoded.role, jti: decoded.jti };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = { adminProtect };
